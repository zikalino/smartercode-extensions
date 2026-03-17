import * as https from 'https';
import { execFile } from 'child_process';
import * as path from 'path';
import { GraphModel } from './git-graph-types';

export type GitGraphDataSource = 'local' | 'remote' | 'sample';

export interface GitGraphFilter {
  uri: string;
  source: GitGraphDataSource;
  localPath?: string;
  remoteUrl?: string;
  branches: string[];
  files: string[];
  commitRange?: string;
}

export interface GitDataProvider {
  readonly kind: string;
  canHandle(filter: GitGraphFilter): boolean;
  getGraphSlice(filter: GitGraphFilter): Promise<GraphModel>;
}

const MERGE_PARENT_BRANCH_PREFIX = 'merge-parent/';

function splitCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function encodeCsv(values: string[]): string {
  return values.join(',');
}

export function parseGitGraphUri(uri: string): GitGraphFilter {
  const fallback: GitGraphFilter = {
    uri,
    source: 'local',
    branches: [],
    files: []
  };

  if (!uri.startsWith('gitgraph://')) {
    return fallback;
  }

  const withoutPrefix = uri.slice('gitgraph://'.length);
  const [sourceAndTarget, query = ''] = withoutPrefix.split('?');
  const firstSlash = sourceAndTarget.indexOf('/');
  const sourcePart = firstSlash >= 0 ? sourceAndTarget.slice(0, firstSlash) : sourceAndTarget;
  const targetPart = firstSlash >= 0 ? sourceAndTarget.slice(firstSlash + 1) : '';
  const source: GitGraphDataSource = sourcePart === 'remote' ? 'remote' : sourcePart === 'sample' ? 'sample' : 'local';

  const params = new URLSearchParams(query);
  const branches = splitCsv(params.get('branches') ?? undefined);
  const files = splitCsv(params.get('files') ?? undefined);

  return {
    uri,
    source,
    localPath: source === 'local' ? decodeURIComponent(targetPart) : undefined,
    remoteUrl: source === 'remote' ? decodeURIComponent(targetPart) : undefined,
    branches,
    files,
    commitRange: params.get('range') ?? undefined
  };
}

export function buildGitGraphUri(filter: GitGraphFilter): string {
  const source = filter.source === 'remote' ? 'remote' : filter.source === 'sample' ? 'sample' : 'local';
  const target = source === 'remote'
    ? (filter.remoteUrl ?? '')
    : source === 'sample'
      ? ''
      : (filter.localPath ?? '');
  const params = new URLSearchParams();

  if (filter.branches.length > 0) {
    params.set('branches', encodeCsv(filter.branches));
  }
  if (filter.files.length > 0) {
    params.set('files', encodeCsv(filter.files));
  }
  if (filter.commitRange && filter.commitRange.trim().length > 0) {
    params.set('range', filter.commitRange.trim());
  }

  const query = params.toString();
  return `gitgraph://${source}/${encodeURIComponent(target)}${query ? `?${query}` : ''}`;
}

export class LocalGitDataProvider implements GitDataProvider {
  public readonly kind = 'local';

  canHandle(filter: GitGraphFilter): boolean {
    return filter.source === 'local';
  }

  async getGraphSlice(filter: GitGraphFilter): Promise<GraphModel> {
    const repoRoot = await resolveRepositoryRoot(filter.localPath);
    const fileSpecs = normalizeFileSpecs(filter.files);
    const availableBranchNames = await listLocalBranches(repoRoot);
    const requestedMergeParentRefs = filter.branches
      .map((name) => parseMergeParentBranchRef(name))
      .filter((name): name is string => Boolean(name));
    const requestedRealBranches = filter.branches.filter((name) => !isMergeParentBranchName(name));
    const branchNames = requestedRealBranches.length > 0 ? requestedRealBranches : availableBranchNames;
    const commitRows = await listLocalCommits(repoRoot, filter.commitRange, fileSpecs);
    let tagsByCommitSha = new Map<string, string[]>();
    try {
      tagsByCommitSha = await listLocalTagsByCommitSha(repoRoot);
    } catch {
      tagsByCommitSha = new Map<string, string[]>();
    }
    let fullChildMap = new Map<string, string[]>();
    try {
      fullChildMap = await listLocalChildMap(repoRoot, filter.commitRange, fileSpecs);
    } catch {
      // Hidden-child indicators are best-effort. If this scan is too expensive,
      // continue with parent links only instead of failing the entire slice load.
      fullChildMap = new Map<string, string[]>();
    }

    let headSha: string | undefined;
    try {
      const raw = await runGit(repoRoot, ['rev-parse', 'HEAD']);
      headSha = shortSha(raw.trim());
    } catch {
      // Empty repo or detached HEAD with no commits — skip.
    }

    if (commitRows.length === 0) {
      throw new Error('No commits found for the selected local filter.');
    }

    const included = new Set(commitRows.map((row) => row.sha));
    const branchMembership = await buildBranchMembership(repoRoot, availableBranchNames, fileSpecs);
    const mergeParentMembership = await buildMergeParentMembership(repoRoot, requestedMergeParentRefs, fileSpecs);
    mergeParentMembership.forEach((membershipSet, branchName) => {
      branchMembership.set(branchName, membershipSet);
    });
    const syntheticBranchNames = Array.from(mergeParentMembership.keys());
    const allBranchNames = availableBranchNames.concat(syntheticBranchNames);
    const preferredBranchNames = filter.branches.length > 0
      ? orderPreferredBranches(filter.branches)
      : branchNames;

    const mergeSecondParentPairs = Array.from(new Set(
      commitRows
        .filter((row) => row.parents.length > 1)
        .map((row) => `${row.parents[0]}|${row.parents[1]}`)
    ));
    const mergeParentBranchesByPair = new Map<string, string[]>();
    await Promise.all(mergeSecondParentPairs.map(async (pairKey) => {
      const [firstParentSha, secondParentSha] = pairKey.split('|');
      try {
        const branches = await listLocalLikelySourceBranchesForSecondParent(repoRoot, secondParentSha, firstParentSha);
        mergeParentBranchesByPair.set(pairKey, branches);
      } catch {
        mergeParentBranchesByPair.set(pairKey, []);
      }
    }));

    let defaultActiveBranchNames: string[] = [];
    if (filter.branches.length === 0) {
      try {
        const currentBranchName = (await runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
        if (currentBranchName && currentBranchName !== 'HEAD') {
          defaultActiveBranchNames = [currentBranchName];
        }
      } catch {
        defaultActiveBranchNames = [];
      }
    }
    const activeBranches = new Set(requestedRealBranches.length > 0 ? requestedRealBranches : defaultActiveBranchNames);

    const commits = commitRows.map((row) => ({
      hiddenMergeBranches: (() => {
        if (row.parents.length < 2) {
          return [];
        }

        const pairKey = `${row.parents[0]}|${row.parents[1]}`;
        const secondParentSha = row.parents[1];
        const secondParentBranches = mergeParentBranchesByPair.get(pairKey) ?? [];
        return secondParentBranches.filter((branchName) => !activeBranches.has(branchName));
      })(),
      hiddenMergeParentId: (() => {
        if (row.parents.length < 2) {
          return undefined;
        }

        const secondParentSha = row.parents[1];
        if (included.has(secondParentSha)) {
          return undefined;
        }

        return shortSha(secondParentSha);
      })(),
      secondParentId: row.parents.length > 1 ? shortSha(row.parents[1]) : undefined,
      secondParentKind: (() => {
        if (row.parents.length < 2) {
          return undefined;
        }

        const pairKey = `${row.parents[0]}|${row.parents[1]}`;
        const secondParentBranches = mergeParentBranchesByPair.get(pairKey) ?? [];
        return secondParentBranches.length > 0
          ? ('branch' as const)
          : ('detached' as const);
      })(),
      secondParentBranches: (() => {
        if (row.parents.length < 2) {
          return [];
        }

        const pairKey = `${row.parents[0]}|${row.parents[1]}`;
        return mergeParentBranchesByPair.get(pairKey) ?? [];
      })(),
      branches: findBranchesForCommit(row.sha, allBranchNames, branchMembership),
      id: shortSha(row.sha),
      branch: findPreferredBranchForCommit(
        row.sha,
        preferredBranchNames,
        allBranchNames,
        branchMembership
      ),
      parents: row.parents
        .filter((parentSha) => included.has(parentSha))
        .map((parentSha) => shortSha(parentSha)),
      message: row.subject,
      tags: tagsByCommitSha.get(row.sha) ?? [],
      hiddenParentCount: row.parents.filter((parentSha) => !included.has(parentSha)).length,
      hiddenChildCount: (fullChildMap.get(row.sha) ?? []).filter((childSha) => !included.has(childSha)).length
    }));

    const branches = Array.from(new Set(commits.map((commit) => commit.branch)));
    return { branches, commits, head: headSha };
  }
}

export class RemoteGitDataProvider implements GitDataProvider {
  public readonly kind = 'remote';

  canHandle(filter: GitGraphFilter): boolean {
    return filter.source === 'remote';
  }

  async getGraphSlice(filter: GitGraphFilter): Promise<GraphModel> {
    const url = filter.remoteUrl ?? '';
    const githubMatch = url.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?(?:\/|$)/i);
    if (!githubMatch) {
      throw new Error(`Cannot fetch remote graph: unsupported URL format "${url}". Expected a GitHub URL like https://github.com/owner/repo`);
    }

    const owner = githubMatch[1];
    const repo = githubMatch[2];

    const branchNames = filter.branches.length > 0
      ? filter.branches
      : await this.fetchBranchNames(owner, repo);

    const commitsByBranch = await Promise.all(
      branchNames.map((branch) => this.fetchCommitsForBranch(owner, repo, branch, filter.commitRange))
    );

    const allById = new Map<string, { id: string; branch: string; branches: string[]; parents: string[]; message: string }>();
    for (let i = 0; i < branchNames.length; i++) {
      for (const commit of commitsByBranch[i]) {
        if (!allById.has(commit.id)) {
          allById.set(commit.id, {
            id: commit.id,
            branch: branchNames[i],
            branches: [branchNames[i]],
            parents: commit.parents,
            message: commit.message
          });
        }
      }
    }

    const commits = Array.from(allById.values());
    const knownIds = new Set(commits.map((c) => c.id));
    const normalized = commits.map((c) => ({
      ...c,
      parents: c.parents.filter((p) => knownIds.has(p)),
      hiddenParentCount: c.parents.filter((p) => !knownIds.has(p)).length,
      hiddenChildCount: 0
    }));

    if (normalized.length === 0) {
      throw new Error(`No commits found for ${owner}/${repo} with the given filter.`);
    }

    return {
      branches: Array.from(new Set(normalized.map((c) => c.branch))),
      commits: normalized
    };
  }

  private fetchBranchNames(owner: string, repo: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${owner}/${repo}/branches?per_page=20`,
        headers: { 'User-Agent': 'smartercode-git-graph', 'Accept': 'application/vnd.github+json' }
      };
      https.get(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const data = JSON.parse(body) as unknown;
            if (!Array.isArray(data)) {
              reject(new Error(`GitHub API error: ${body.slice(0, 200)}`));
              return;
            }
            resolve(data.map((b: { name: string }) => b.name).slice(0, 8));
          } catch (err) {
            reject(err);
          }
        });
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  private fetchCommitsForBranch(
    owner: string, repo: string, branch: string, commitRange: string | undefined
  ): Promise<{ id: string; parents: string[]; message: string }[]> {
    return new Promise((resolve, reject) => {
      const shaParam = commitRange ? `&sha=${encodeURIComponent(commitRange.split('..').pop() ?? branch)}` : `&sha=${encodeURIComponent(branch)}`;
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${owner}/${repo}/commits?per_page=30${shaParam}`,
        headers: { 'User-Agent': 'smartercode-git-graph', 'Accept': 'application/vnd.github+json' }
      };
      https.get(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const data = JSON.parse(body) as unknown;
            if (!Array.isArray(data)) {
              resolve([]);
              return;
            }
            resolve(
              data.map((c: { sha: string; parents: { sha: string }[]; commit?: { message?: string } }) => ({
                id: c.sha.slice(0, 7),
                parents: (c.parents ?? []).map((p: { sha: string }) => p.sha.slice(0, 7)),
                message: String(c.commit?.message ?? '').split('\n')[0]
              }))
            );
          } catch (err) {
            reject(err);
          }
        });
        res.on('error', reject);
      }).on('error', reject);
    });
  }
}

export class GitDataProviderExample implements GitDataProvider {
  public readonly kind = 'example';

  canHandle(_filter: GitGraphFilter): boolean {
    return true;
  }

  async getGraphSlice(filter: GitGraphFilter): Promise<GraphModel> {
    // A richer sample graph: main, develop, feature/auth, feature/cache, hotfix/security, release/2.0
    const full: GraphModel = {
      branches: ['main', 'develop', 'feature/auth', 'feature/cache', 'hotfix/security', 'release/2.0'],
      commits: [
        // Initial main commits
        { id: 'c001', branch: 'main', parents: [] },
        { id: 'c002', branch: 'main', parents: ['c001'] },
        { id: 'c003', branch: 'main', parents: ['c002'] },

        // develop branches off from main
        { id: 'd001', branch: 'develop', parents: ['c003'] },
        { id: 'd002', branch: 'develop', parents: ['d001'] },
        { id: 'd003', branch: 'develop', parents: ['d002'] },

        // feature/auth branches off develop
        { id: 'a001', branch: 'feature/auth', parents: ['d002'] },
        { id: 'a002', branch: 'feature/auth', parents: ['a001'] },
        { id: 'a003', branch: 'feature/auth', parents: ['a002'] },
        { id: 'a004', branch: 'feature/auth', parents: ['a003'] },

        // feature/cache branches off develop
        { id: 'k001', branch: 'feature/cache', parents: ['d001'] },
        { id: 'k002', branch: 'feature/cache', parents: ['k001'] },
        { id: 'k003', branch: 'feature/cache', parents: ['k002'] },

        // hotfix/security branches off main
        { id: 'h001', branch: 'hotfix/security', parents: ['c002'] },
        { id: 'h002', branch: 'hotfix/security', parents: ['h001'] },

        // develop merges hotfix and feature/cache
        { id: 'd004', branch: 'develop', parents: ['d003', 'h002'] },
        { id: 'd005', branch: 'develop', parents: ['d004', 'k003'] },

        // main merges hotfix
        { id: 'c004', branch: 'main', parents: ['c003', 'h002'] },

        // release/2.0 branches from develop
        { id: 'r001', branch: 'release/2.0', parents: ['d005'] },
        { id: 'r002', branch: 'release/2.0', parents: ['r001'] },
        { id: 'r003', branch: 'release/2.0', parents: ['r002'] },

        // feature/auth merges into develop
        { id: 'd006', branch: 'develop', parents: ['d005', 'a004'] },

        // develop merges into main
        { id: 'c005', branch: 'main', parents: ['c004', 'd006'] },

        // final polish on main
        { id: 'c006', branch: 'main', parents: ['c005'] },
        { id: 'c007', branch: 'main', parents: ['c006'] }
      ]
    };

    // Keep sample ordering aligned with `git log` output (newest first)
    // so lane routing behaves the same as local/remote providers.
    return filterModel({
      ...full,
      commits: [...full.commits].reverse()
    }, filter);
  }
}

type LocalCommitRow = {
  sha: string;
  parents: string[];
  subject: string;
};

function normalizeFileSpecs(files: string[]): string[] {
  return files
    .map((file) => String(file).trim())
    .filter((file) => file.length > 0)
    .map((file) => file.replace(/\\/g, '/'));
}

function shortSha(sha: string): string {
  return sha.slice(0, 10);
}

async function resolveRepositoryRoot(localPath: string | undefined): Promise<string> {
  const candidates = [
    localPath,
    process.cwd()
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => path.resolve(value));

  for (const candidate of candidates) {
    try {
      const root = await runGit(candidate, ['rev-parse', '--show-toplevel']);
      return root.trim();
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Unable to resolve repository root for path "${localPath ?? ''}".`);
}

async function listLocalBranches(repoRoot: string): Promise<string[]> {
  const output = await runGit(repoRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  const branches = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return branches.slice(0, 8);
}

async function buildMergeParentMembership(
  repoRoot: string,
  mergeParentRefs: string[],
  fileSpecs: string[]
): Promise<Map<string, Set<string>>> {
  const membership = new Map<string, Set<string>>();
  const refs = Array.from(new Set(
    mergeParentRefs
      .map((ref) => String(ref).trim())
      .filter((ref) => ref.length > 0)
  ));

  await Promise.all(refs.map(async (mergeParentRef) => {
    const syntheticBranchName = toMergeParentBranchName(mergeParentRef);
    const args = ['rev-list', '--max-count=700', mergeParentRef];
    if (fileSpecs.length > 0) {
      args.push('--', ...fileSpecs);
    }

    try {
      const output = await runGit(repoRoot, args);
      const shas = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      membership.set(syntheticBranchName, new Set(shas));
    } catch {
      membership.set(syntheticBranchName, new Set());
    }
  }));

  return membership;
}

async function listLocalLikelySourceBranchesForSecondParent(
  repoRoot: string,
  secondParentSha: string,
  firstParentSha: string
): Promise<string[]> {
  const output = await runGit(repoRoot, [
    'for-each-ref',
    '--contains=' + secondParentSha,
    '--no-contains=' + firstParentSha,
    '--format=%(refname:short)',
    'refs/heads'
  ]);

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function listLocalCommits(
  repoRoot: string,
  commitRange: string | undefined,
  fileSpecs: string[]
): Promise<LocalCommitRow[]> {
  const range = (commitRange ?? '').trim();
  const args = ['log', '--max-count=180', '--pretty=format:%H%x09%P%x09%s'];

  if (range.length > 0) {
    args.push(range);
  } else {
    args.push('--all');
  }

  if (fileSpecs.length > 0) {
    args.push('--', ...fileSpecs);
  }

  const output = await runGit(repoRoot, args);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha = '', parents = '', ...subjectParts] = line.split('\t');
      return {
        sha,
        parents: parents.length > 0 ? parents.split(' ').filter((part) => part.length > 0) : [],
        subject: subjectParts.join('\t').trim()
      };
    })
    .filter((row) => row.sha.length > 0);
}

async function buildBranchMembership(
  repoRoot: string,
  branchNames: string[],
  fileSpecs: string[]
): Promise<Map<string, Set<string>>> {
  const membership = new Map<string, Set<string>>();

  await Promise.all(branchNames.map(async (branchName) => {
    const args = ['rev-list', '--max-count=700', branchName];
    if (fileSpecs.length > 0) {
      args.push('--', ...fileSpecs);
    }

    try {
      const output = await runGit(repoRoot, args);
      const shas = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      membership.set(branchName, new Set(shas));
    } catch {
      membership.set(branchName, new Set());
    }
  }));

  return membership;
}

async function listLocalChildMap(
  repoRoot: string,
  commitRange: string | undefined,
  fileSpecs: string[]
): Promise<Map<string, string[]>> {
  const range = (commitRange ?? '').trim();
  const args = ['rev-list', '--children', '--max-count=2500'];

  if (range.length > 0) {
    args.push(range);
  } else {
    args.push('--all');
  }

  if (fileSpecs.length > 0) {
    args.push('--', ...fileSpecs);
  }

  const output = await runGit(repoRoot, args);
  const map = new Map<string, string[]>();

  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .forEach((line) => {
      const [sha, ...children] = line.split(' ').filter((part) => part.length > 0);
      if (!sha) {
        return;
      }

      map.set(sha, children);
    });

  return map;
}

async function listLocalTagsByCommitSha(repoRoot: string): Promise<Map<string, string[]>> {
  const output = await runGit(repoRoot, [
    'for-each-ref',
    '--format=%(refname:short)%09%(objectname)%09%(*objectname)',
    'refs/tags'
  ]);

  const map = new Map<string, string[]>();
  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .forEach((line) => {
      const [tagName = '', objectSha = '', peeledSha = ''] = line.split('\t');
      const commitSha = (peeledSha || objectSha).trim();
      if (!tagName || !commitSha) {
        return;
      }

      const existing = map.get(commitSha) ?? [];
      existing.push(tagName.trim());
      map.set(commitSha, existing);
    });

  map.forEach((values, key) => {
    map.set(key, values.sort((a, b) => a.localeCompare(b)));
  });

  return map;
}

function findBranchForCommit(
  sha: string,
  branchNames: string[],
  membership: Map<string, Set<string>>
): string {
  for (const branchName of branchNames) {
    if (membership.get(branchName)?.has(sha)) {
      return branchName;
    }
  }

  return branchNames[0] ?? 'main';
}

function findBranchesForCommit(
  sha: string,
  branchNames: string[],
  membership: Map<string, Set<string>>
): string[] {
  const matches: string[] = [];
  for (const branchName of branchNames) {
    if (membership.get(branchName)?.has(sha)) {
      matches.push(branchName);
    }
  }

  return matches;
}

function findPreferredBranchForCommit(
  sha: string,
  preferredBranchNames: string[],
  allBranchNames: string[],
  membership: Map<string, Set<string>>
): string {
  for (const branchName of preferredBranchNames) {
    if (membership.get(branchName)?.has(sha)) {
      return branchName;
    }
  }

  return findBranchForCommit(sha, allBranchNames, membership);
}

function isMergeParentBranchName(name: string): boolean {
  return String(name || '').startsWith(MERGE_PARENT_BRANCH_PREFIX);
}

function orderPreferredBranches(branches: string[]): string[] {
  const values = Array.from(new Set(
    branches
      .map((name) => String(name || '').trim())
      .filter((name) => name.length > 0)
  ));

  const realBranches = values.filter((name) => !isMergeParentBranchName(name));
  const syntheticBranches = values.filter((name) => isMergeParentBranchName(name));
  return realBranches.concat(syntheticBranches);
}

function parseMergeParentBranchRef(name: string): string | undefined {
  const value = String(name || '').trim();
  if (!isMergeParentBranchName(value)) {
    return undefined;
  }

  const ref = value.slice(MERGE_PARENT_BRANCH_PREFIX.length).trim();
  return ref.length > 0 ? ref : undefined;
}

function toMergeParentBranchName(ref: string): string {
  return MERGE_PARENT_BRANCH_PREFIX + shortSha(String(ref || '').trim());
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

function filterModel(model: GraphModel, filter: GitGraphFilter): GraphModel {
  if (filter.branches.length === 0) {
    return model;
  }

  const branchSet = new Set(filter.branches);
  const commits = model.commits.filter((commit) => {
    if (branchSet.has(commit.branch)) {
      return true;
    }

    const memberships = Array.isArray(commit.branches) ? commit.branches : [];
    return memberships.some((branchName) => branchSet.has(branchName));
  });
  const ids = new Set(commits.map((commit) => commit.id));
  const removedCommits = model.commits.filter((commit) => {
    if (branchSet.has(commit.branch)) {
      return false;
    }

    const memberships = Array.isArray(commit.branches) ? commit.branches : [];
    return !memberships.some((branchName) => branchSet.has(branchName));
  });
  const removedChildCountByParentId = new Map<string, number>();

  removedCommits.forEach((commit) => {
    commit.parents.forEach((parentId) => {
      if (!ids.has(parentId)) {
        return;
      }

      removedChildCountByParentId.set(parentId, (removedChildCountByParentId.get(parentId) ?? 0) + 1);
    });
  });

  const normalizedCommits = commits.map((commit) => ({
    ...commit,
    branch: (() => {
      const memberships = Array.isArray(commit.branches) ? commit.branches : [];
      for (const branchName of memberships) {
        if (branchSet.has(branchName)) {
          return branchName;
        }
      }
      return commit.branch;
    })(),
    parents: commit.parents.filter((parentId) => ids.has(parentId)),
    hiddenParentCount: (commit.hiddenParentCount ?? 0)
      + commit.parents.filter((parentId) => !ids.has(parentId)).length,
    hiddenChildCount: (commit.hiddenChildCount ?? 0) + (removedChildCountByParentId.get(commit.id) ?? 0)
  }));

  if (normalizedCommits.length === 0) {
    return model;
  }

  return {
    branches: Array.from(new Set(normalizedCommits.map((commit) => commit.branch))),
    commits: normalizedCommits,
    head: model.head
  };
}
