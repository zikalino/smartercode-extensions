import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  buildGitGraphUri,
  GraphCommit,
  GraphModel,
  GitDataProvider,
  GitDataProviderExample,
  GitGraphFilter,
  GitGraphPanel,
  LocalGitDataProvider
} from '@upcloud/common';

const OPEN_VIEW_COMMAND = 'gitSlice.openView';
const SHOW_CONTEXT_COMMAND = 'gitSlice.showGitContext';
const ADD_SLICE_COMMAND = 'gitSlice.addSlice';

let currentRepoPath: string | undefined;
let activeSlices: Array<{ filter: GitGraphFilter; model: GraphModel }> = [];

export function activate(context: vscode.ExtensionContext): void {
  const localProvider = new LocalGitDataProvider();
  const sampleProvider = new GitDataProviderExample();
  const panel = new GitGraphPanel({
    panelId: 'gitSlice.panel',
    title: 'Git Slice',
    branchLaneDistance: 14,
    commitVerticalDistance: 26,
    strokeWidth: 2.5,
    onFilterApplied: (filter, model) => {
      activeSlices = [{ filter, model }];
      if (filter.source === 'local' && filter.localPath) {
        currentRepoPath = filter.localPath;
      }
    },
    onSliceDividerAction: (action, range) => {
      void handleSliceDividerAction(action, range, panel, localProvider, sampleProvider);
    },
    onCommitContextMenu: (commitId, branch, selectedCommitIds) => {
      if (!currentRepoPath) {
        void vscode.window.showWarningMessage('Git Slice: no repository path available.');
        return;
      }
      void showCommitContextMenu(commitId, branch, selectedCommitIds, currentRepoPath);
    }
  });

  const openWorkspaceDisposable = vscode.commands.registerCommand(OPEN_VIEW_COMMAND, async () => {
    const workspaceFolder = getPrimaryWorkspaceFolder();
    if (!workspaceFolder) {
      void vscode.window.showWarningMessage('Git Slice: open a workspace folder first.');
      return;
    }

    const filter: GitGraphFilter = {
      uri: '',
      source: 'local',
      localPath: workspaceFolder.uri.fsPath,
      branches: [],
      files: [],
      commitRange: 'HEAD~5..HEAD'
    };
    filter.uri = buildGitGraphUri(filter);
    currentRepoPath = workspaceFolder.uri.fsPath;

    await openSlice(panel, localProvider, sampleProvider, filter, false);
  });

  const showContextDisposable = vscode.commands.registerCommand(SHOW_CONTEXT_COMMAND, async (resource?: vscode.Uri) => {
    const target = resolveTargetUri(resource);
    if (!target) {
      void vscode.window.showWarningMessage('Git Slice: no file selected.');
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(target) ?? getPrimaryWorkspaceFolder();
    if (!workspaceFolder) {
      void vscode.window.showWarningMessage('Git Slice: selected file is not inside an opened workspace folder.');
      return;
    }

    const relativeFilePath = toWorkspaceRelativePath(workspaceFolder, target);
    const filter: GitGraphFilter = {
      uri: '',
      source: 'local',
      localPath: workspaceFolder.uri.fsPath,
      branches: [],
      files: [relativeFilePath],
      commitRange: 'HEAD~5..HEAD'
    };
    filter.uri = buildGitGraphUri(filter);
    currentRepoPath = workspaceFolder.uri.fsPath;

    await openSlice(panel, localProvider, sampleProvider, filter, false);
  });

  const addSliceDisposable = vscode.commands.registerCommand(ADD_SLICE_COMMAND, async () => {
    if (!currentRepoPath) {
      const workspaceFolder = getPrimaryWorkspaceFolder();
      if (!workspaceFolder) {
        void vscode.window.showWarningMessage('Git Slice: open a workspace folder first.');
        return;
      }

      const initialFilter: GitGraphFilter = {
        uri: '',
        source: 'local',
        localPath: workspaceFolder.uri.fsPath,
        branches: [],
        files: [],
        commitRange: 'HEAD~5..HEAD'
      };
      initialFilter.uri = buildGitGraphUri(initialFilter);
      currentRepoPath = workspaceFolder.uri.fsPath;
      await openSlice(panel, localProvider, sampleProvider, initialFilter, false);
    }

    const query = await vscode.window.showInputBox({
      title: 'Git Slice: Add Slice',
      prompt: 'Enter tag, commit, commit range, or message text',
      placeHolder: 'Examples: v1.2.0, 3c621c3, HEAD~50..HEAD~20, scheduler timeout'
    });
    if (!query || query.trim().length === 0) {
      return;
    }

    const baseFilter = activeSlices[activeSlices.length - 1]?.filter;
    const source = baseFilter?.source ?? 'local';

    const candidates = source === 'sample'
      ? await resolveSampleSliceCandidates(sampleProvider, query.trim())
      : await resolveLocalSliceCandidates(currentRepoPath!, query.trim());
    if (candidates.length === 0) {
      void vscode.window.showWarningMessage(`Git Slice: no commits matched "${query.trim()}".`);
      return;
    }

    let selected = candidates[0];
    if (candidates.length > 1) {
      const picked = await vscode.window.showQuickPick(
        candidates.map((candidate) => ({
          label: candidate.label,
          description: candidate.description,
          detail: candidate.detail,
          candidate
        })),
        {
          title: 'Git Slice: Select a slice candidate',
          placeHolder: 'Choose which range to add'
        }
      );

      if (!picked) {
        return;
      }
      selected = picked.candidate;
    }

    const nextFilter: GitGraphFilter = {
      uri: '',
      source,
      localPath: source === 'local' ? currentRepoPath : undefined,
      branches: baseFilter?.branches ?? [],
      files: baseFilter?.files ?? [],
      commitRange: selected.range
    };
    nextFilter.uri = buildGitGraphUri(nextFilter);

    await openSlice(panel, localProvider, sampleProvider, nextFilter, true);
    void vscode.window.showInformationMessage(`Git Slice: added slice ${selected.range}.`);
  });

  context.subscriptions.push(openWorkspaceDisposable, showContextDisposable, addSliceDisposable, panel);
}

export function deactivate(): void {
}

async function openSlice(
  panel: GitGraphPanel,
  localProvider: LocalGitDataProvider,
  sampleProvider: GitDataProviderExample,
  filter: GitGraphFilter,
  append: boolean
): Promise<void> {
  panel.showLoading(filter);

  try {
    const provider: GitDataProvider = filter.source === 'sample' ? sampleProvider : localProvider;
    const model = await provider.getGraphSlice(filter);
    if (append) {
      activeSlices.push({ filter, model });
    } else {
      activeSlices = [{ filter, model }];
    }

    const combined = mergeSliceModels(activeSlices.map((entry) => entry.model));
    const displayFilter = buildDisplayFilter(activeSlices.map((entry) => entry.filter), filter);
    panel.showModel(combined, displayFilter);
  } catch (error) {
    panel.hideLoading();
    const details = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Git Slice: failed to load history. ${details}`);
  }
}

function buildDisplayFilter(filters: GitGraphFilter[], fallback: GitGraphFilter): GitGraphFilter {
  if (filters.length === 0) {
    return fallback;
  }

  const first = filters[0];
  const commitRanges = filters
    .map((entry) => String(entry.commitRange || '').trim())
    .filter((value) => value.length > 0);

  const displayFilter: GitGraphFilter = {
    ...first,
    commitRange: commitRanges[0] ?? first.commitRange,
    commitRanges
  };
  displayFilter.uri = buildGitGraphUri(displayFilter);
  return displayFilter;
}

async function handleSliceDividerAction(
  action: 'remove' | 'expand',
  range: string,
  panel: GitGraphPanel,
  localProvider: LocalGitDataProvider,
  sampleProvider: GitDataProviderExample
): Promise<void> {
  const index = activeSlices.findIndex((entry, idx) => idx > 0 && String(entry.filter.commitRange || '').trim() === String(range || '').trim());
  if (index < 0) {
    void vscode.window.showWarningMessage('Git Slice: slice range was not found.');
    return;
  }

  if (action === 'remove') {
    activeSlices.splice(index, 1);
    renderActiveSlices(panel);
    void vscode.window.showInformationMessage(`Git Slice: removed slice ${range}.`);
    return;
  }

  const target = activeSlices[index];
  const expandedRange = expandSliceRange(String(target.filter.commitRange || ''));
  if (!expandedRange) {
    void vscode.window.showWarningMessage(`Git Slice: cannot expand range ${target.filter.commitRange || ''}.`);
    return;
  }

  const nextFilter: GitGraphFilter = {
    ...target.filter,
    commitRange: expandedRange,
    commitRanges: target.filter.commitRanges
  };
  nextFilter.uri = buildGitGraphUri(nextFilter);

  const provider: GitDataProvider = nextFilter.source === 'sample' ? sampleProvider : localProvider;
  const model = await provider.getGraphSlice(nextFilter);
  activeSlices[index] = { filter: nextFilter, model };

  renderActiveSlices(panel);
  void vscode.window.showInformationMessage(`Git Slice: expanded slice to ${expandedRange}.`);
}

function renderActiveSlices(panel: GitGraphPanel): void {
  if (activeSlices.length === 0) {
    return;
  }

  const combined = mergeSliceModels(activeSlices.map((entry) => entry.model));
  const displayFilter = buildDisplayFilter(activeSlices.map((entry) => entry.filter), activeSlices[0].filter);
  panel.showModel(combined, displayFilter);
}

function expandSliceRange(range: string): string | undefined {
  const value = String(range || '').trim();
  if (!value.includes('..')) {
    return undefined;
  }

  const headToHeadMatch = value.match(/^HEAD~(\d+)\.\.HEAD~(\d+)$/i);
  if (headToHeadMatch) {
    const older = Number(headToHeadMatch[1]);
    const newer = Number(headToHeadMatch[2]);
    if (!Number.isFinite(older) || !Number.isFinite(newer) || older < newer) {
      return undefined;
    }
    const expandedOlder = older + 80;
    const expandedNewer = Math.max(0, newer - 20);
    return `HEAD~${expandedOlder}..${expandedNewer === 0 ? 'HEAD' : `HEAD~${expandedNewer}`}`;
  }

  const refMatch = value.match(/^(.+?)~(\d+)\.\.\1$/);
  if (refMatch) {
    const base = refMatch[1];
    const depth = Number(refMatch[2]);
    if (!Number.isFinite(depth)) {
      return undefined;
    }
    return `${base}~${depth + 40}..${base}`;
  }

  const headTailMatch = value.match(/^HEAD~(\d+)\.\.HEAD$/i);
  if (headTailMatch) {
    const older = Number(headTailMatch[1]);
    if (!Number.isFinite(older)) {
      return undefined;
    }
    return `HEAD~${older + 80}..HEAD`;
  }

  return undefined;
}

type SliceQueryCandidate = {
  label: string;
  description?: string;
  detail?: string;
  range: string;
};

async function resolveSliceCandidates(repoPath: string, query: string): Promise<SliceQueryCandidate[]> {
  if (query.includes('..')) {
    return [{ label: `Range ${query}`, detail: 'Commit range', range: query }];
  }

  const directCommit = await tryResolveCommit(repoPath, query);
  if (directCommit) {
    const range = `${directCommit}~20..${directCommit}`;
    return [{
      label: `${directCommit.slice(0, 10)} (tag/commit)`,
      detail: range,
      range
    }];
  }

  const output = await runGitInRepo(repoPath, [
    'log',
    '--all',
    '--max-count=30',
    '--date=short',
    '--format=%H%x09%ad%x09%s',
    '--regexp-ignore-case',
    '--grep',
    query
  ]).catch(() => '');

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha = '', date = '', ...subjectParts] = line.split('\t');
      const subject = subjectParts.join('\t').trim();
      const range = `${sha}~20..${sha}`;
      return {
        label: `${sha.slice(0, 10)} ${subject || '(no message)'}`,
        description: date,
        detail: range,
        range
      } as SliceQueryCandidate;
    })
    .filter((candidate) => candidate.range.length > 0);
}

async function resolveSampleSliceCandidates(
  sampleProvider: GitDataProviderExample,
  query: string
): Promise<SliceQueryCandidate[]> {
  const fullModel = await sampleProvider.getGraphSlice({
    uri: 'gitgraph://sample/',
    source: 'sample',
    branches: [],
    files: []
  });

  if (query.includes('..')) {
    return [{ label: `Range ${query}`, detail: 'Commit range', range: query }];
  }

  const normalized = query.trim().toLowerCase();
  const commits = fullModel.commits;

  const makeRangeAroundIndex = (index: number, window = 24): string => {
    const maxIndex = Math.max(0, commits.length - 1);
    const clamped = Math.max(0, Math.min(index, maxIndex));
    const olderDepth = Math.min(maxIndex, clamped + window);
    const newerDepth = Math.max(0, clamped);
    const olderRef = olderDepth === 0 ? 'HEAD' : `HEAD~${olderDepth}`;
    const newerRef = newerDepth === 0 ? 'HEAD' : `HEAD~${newerDepth}`;
    return `${olderRef}..${newerRef}`;
  };

  const isCommitIdQuery = /^[a-z0-9]{4,}$/i.test(query);
  if (isCommitIdQuery) {
    const index = commits.findIndex((commit) => commit.id.toLowerCase().startsWith(normalized));
    if (index >= 0) {
      const range = makeRangeAroundIndex(index);
      return [{
        label: `${commits[index].id} (sample commit)`,
        detail: range,
        range
      }];
    }
  }

  const tagIndex = commits.findIndex((commit) =>
    Array.isArray(commit.tags) && commit.tags.some((tag) => tag.toLowerCase() === normalized)
  );
  if (tagIndex >= 0) {
    const matchedTag = commits[tagIndex].tags?.find((tag) => tag.toLowerCase() === normalized) ?? query;
    const range = makeRangeAroundIndex(tagIndex);
    return [{
      label: `${matchedTag} (sample tag)`,
      detail: range,
      range
    }];
  }

  return commits
    .map((commit, index) => ({ commit, index }))
    .filter(({ commit }) => String(commit.message || '').toLowerCase().includes(normalized))
    .slice(0, 30)
    .map(({ commit, index }) => {
      const range = makeRangeAroundIndex(index);
      return {
        label: `${commit.id} ${String(commit.message || '(no message)')}`,
        description: commit.committedAt ? new Date(commit.committedAt).toLocaleDateString() : undefined,
        detail: range,
        range
      } as SliceQueryCandidate;
    });
}

async function resolveLocalSliceCandidates(repoPath: string, query: string): Promise<SliceQueryCandidate[]> {
  return resolveSliceCandidates(repoPath, query);
}

async function tryResolveCommit(repoPath: string, value: string): Promise<string | undefined> {
  try {
    const resolved = await runGitInRepo(repoPath, ['rev-parse', '--verify', '--quiet', `${value}^{commit}`]);
    const sha = resolved.trim();
    return sha.length > 0 ? sha : undefined;
  } catch {
    return undefined;
  }
}

function mergeSliceModels(models: GraphModel[]): GraphModel {
  const byId = new Map<string, GraphCommit>();
  const orderedIds: string[] = [];
  const seen = new Set<string>();

  const mergeUnique = (left: string[] | undefined, right: string[] | undefined): string[] | undefined => {
    const values = [...(left ?? []), ...(right ?? [])]
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0);
    if (values.length === 0) {
      return undefined;
    }
    return Array.from(new Set(values));
  };

  models.forEach((model, modelIndex) => {
    let firstUniqueCommitMarked = false;
    model.commits.forEach((commit) => {
      const commitWithSliceMeta: GraphCommit = {
        ...commit,
        sliceBreakBefore: commit.sliceBreakBefore || (!firstUniqueCommitMarked && modelIndex > 0),
        sliceLabel: commit.sliceLabel || (!firstUniqueCommitMarked && modelIndex > 0 ? (activeSlices[modelIndex]?.filter.commitRange || 'Additional Slice') : undefined)
      };

      if (!seen.has(commit.id)) {
        seen.add(commit.id);
        orderedIds.push(commit.id);
        if (!firstUniqueCommitMarked) {
          firstUniqueCommitMarked = true;
        }
      }

      const existing = byId.get(commit.id);
      if (!existing) {
        byId.set(commit.id, commitWithSliceMeta);
        return;
      }

      byId.set(commit.id, {
        ...existing,
        ...commitWithSliceMeta,
        branch: existing.branch || commit.branch,
        committedAt: existing.committedAt || commitWithSliceMeta.committedAt,
        message: existing.message || commit.message,
        parents: mergeUnique(existing.parents, commit.parents) ?? [],
        branches: mergeUnique(existing.branches ?? [existing.branch], commit.branches ?? [commit.branch]),
        tags: mergeUnique(existing.tags, commit.tags),
        secondParentBranches: mergeUnique(existing.secondParentBranches, commit.secondParentBranches),
        hiddenMergeBranches: mergeUnique(existing.hiddenMergeBranches, commit.hiddenMergeBranches),
        sliceBreakBefore: existing.sliceBreakBefore || commitWithSliceMeta.sliceBreakBefore,
        sliceLabel: existing.sliceLabel || commitWithSliceMeta.sliceLabel,
        hiddenParentCount: Math.max(existing.hiddenParentCount ?? 0, commit.hiddenParentCount ?? 0),
        hiddenChildCount: Math.max(existing.hiddenChildCount ?? 0, commit.hiddenChildCount ?? 0)
      });
    });
  });

  const commits = orderedIds
    .map((id) => byId.get(id))
    .filter((commit): commit is GraphCommit => Boolean(commit));
  const branches = Array.from(new Set(commits.map((commit) => commit.branch)));
  const head = models[0]?.head;
  return { branches, commits, head };
}

function getPrimaryWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

function resolveTargetUri(resource: vscode.Uri | undefined): vscode.Uri | undefined {
  if (resource && resource.scheme === 'file') {
    return resource;
  }

  const active = vscode.window.activeTextEditor?.document.uri;
  if (active && active.scheme === 'file') {
    return active;
  }

  return undefined;
}

function toWorkspaceRelativePath(folder: vscode.WorkspaceFolder, fileUri: vscode.Uri): string {
  const relativePath = path.relative(folder.uri.fsPath, fileUri.fsPath);
  return relativePath.replace(/\\/g, '/');
}

type CommitAction = 'tag' | 'branch' | 'checkout' | 'cherry-pick' | 'patch' | 'revert' | 'squash' | 'cumulative-patch';

async function showCommitContextMenu(
  commitId: string,
  branch: string,
  selectedCommitIds: string[],
  repoPath: string
): Promise<void> {
  const isMulti = selectedCommitIds.length > 1;

  const items: Array<{ label: string; description?: string; action: CommitAction }> = isMulti
    ? [
        { label: '$(file-code) Extract Cumulative Patch', description: `${selectedCommitIds.length} commits as one diff`, action: 'cumulative-patch' },
        { label: '$(git-merge) Squash Commits', description: `${selectedCommitIds.length} commits → 1`, action: 'squash' }
      ]
    : [
        { label: '$(tag) Add Tag', action: 'tag' },
        { label: '$(git-branch) Add Branch', action: 'branch' },
        { label: '$(check) Checkout', action: 'checkout' },
        { label: '$(copy) Cherry Pick', action: 'cherry-pick' },
        { label: '$(file-code) Extract Patch', action: 'patch' },
        { label: '$(discard) Revert', action: 'revert' }
      ];

  const picked = await vscode.window.showQuickPick(items, {
    title: isMulti
      ? `${selectedCommitIds.length} commits selected`
      : `Commit ${commitId}  •  ${branch}`,
    placeHolder: 'Choose an action'
  });

  if (!picked) {
    return;
  }

  try {
    await executeCommitAction(picked.action, commitId, selectedCommitIds, repoPath);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Git Slice: operation failed. ${details}`);
  }
}

async function executeCommitAction(
  action: CommitAction,
  commitId: string,
  selectedCommitIds: string[],
  repoPath: string
): Promise<void> {
  switch (action) {
    case 'tag': {
      const name = await vscode.window.showInputBox({
        title: 'New tag',
        prompt: `Tag name for commit ${commitId}`,
        validateInput: (v) => v.trim().length === 0 ? 'Tag name cannot be empty.' : undefined
      });
      if (!name) { return; }
      await runGitInRepo(repoPath, ['tag', name.trim(), commitId]);
      void vscode.window.showInformationMessage(`Git Slice: tag '${name.trim()}' created at ${commitId}.`);
      break;
    }

    case 'branch': {
      const name = await vscode.window.showInputBox({
        title: 'New branch',
        prompt: `Branch name from commit ${commitId}`,
        validateInput: (v) => v.trim().length === 0 ? 'Branch name cannot be empty.' : undefined
      });
      if (!name) { return; }
      await runGitInRepo(repoPath, ['branch', name.trim(), commitId]);
      void vscode.window.showInformationMessage(`Git Slice: branch '${name.trim()}' created at ${commitId}.`);
      break;
    }

    case 'checkout': {
      await runGitInRepo(repoPath, ['checkout', commitId]);
      void vscode.window.showInformationMessage(`Git Slice: checked out ${commitId}.`);
      break;
    }

    case 'cherry-pick': {
      await runGitInRepo(repoPath, ['cherry-pick', commitId]);
      void vscode.window.showInformationMessage(`Git Slice: cherry-picked ${commitId} onto current branch.`);
      break;
    }

    case 'patch': {
      const patchContent = await runGitInRepo(repoPath, ['format-patch', '-1', commitId, '--stdout']);
      const defaultUri = vscode.Uri.file(path.join(repoPath, `${commitId}.patch`));
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'Patch files': ['patch', 'diff'], 'All files': ['*'] }
      });
      if (!saveUri) { return; }
      await vscode.workspace.fs.writeFile(saveUri, Buffer.from(patchContent, 'utf8'));
      void vscode.window.showInformationMessage(`Git Slice: patch saved to ${saveUri.fsPath}.`);
      break;
    }

    case 'revert': {
      const confirmed = await vscode.window.showWarningMessage(
        `Revert commit ${commitId}? A new revert commit will be created.`,
        { modal: true },
        'Revert'
      );
      if (confirmed !== 'Revert') { return; }
      await runGitInRepo(repoPath, ['revert', '--no-edit', commitId]);
      void vscode.window.showInformationMessage(`Git Slice: reverted ${commitId}.`);
      break;
    }

    case 'squash': {
      const message = await vscode.window.showInputBox({
        title: 'Squash commits',
        prompt: `Commit message for the squashed commit (${selectedCommitIds.length} commits)`,
        validateInput: (v) => v.trim().length === 0 ? 'Commit message cannot be empty.' : undefined
      });
      if (!message) { return; }
      const confirmed = await vscode.window.showWarningMessage(
        `Squash ${selectedCommitIds.length} commits into one? This rewrites local history.`,
        { modal: true },
        'Squash'
      );
      if (confirmed !== 'Squash') { return; }
      await squashCommits(repoPath, selectedCommitIds, message.trim());
      void vscode.window.showInformationMessage(`Git Slice: squashed ${selectedCommitIds.length} commits.`);
      break;
    }

    case 'cumulative-patch': {
      const { newestSha, oldestSha, parentSha } = await resolveSelectedCommitBounds(repoPath, selectedCommitIds);
      const patchContent = await runGitInRepo(repoPath, [
        'diff',
        '--binary',
        '--full-index',
        `${parentSha}..${newestSha}`
      ]);

      const defaultUri = vscode.Uri.file(path.join(repoPath, `${oldestSha}-${newestSha}.patch`));
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'Patch files': ['patch', 'diff'], 'All files': ['*'] }
      });
      if (!saveUri) { return; }

      await vscode.workspace.fs.writeFile(saveUri, Buffer.from(patchContent, 'utf8'));
      void vscode.window.showInformationMessage(`Git Slice: cumulative patch saved to ${saveUri.fsPath}.`);
      break;
    }
  }
}

async function resolveSelectedCommitBounds(
  repoPath: string,
  selectedCommitIds: string[]
): Promise<{ newestSha: string; oldestSha: string; parentSha: string }> {
  // List only selected commits sorted by commit date (newest first) without ancestry traversal.
  const logOutput = await runGitInRepo(repoPath, [
    'log', '--no-walk=sorted', '--format=%H', ...selectedCommitIds
  ]);
  const orderedShas = logOutput.trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (orderedShas.length === 0) {
    throw new Error('Could not resolve the selected commits.');
  }

  const newestSha = orderedShas[0];
  const oldestSha = orderedShas[orderedShas.length - 1];
  const parentSha = (await runGitInRepo(repoPath, ['rev-parse', `${oldestSha}^`])).trim();
  return { newestSha, oldestSha, parentSha };
}

async function squashCommits(
  repoPath: string,
  selectedCommitIds: string[],
  message: string
): Promise<void> {
  const { parentSha } = await resolveSelectedCommitBounds(repoPath, selectedCommitIds);
  await runGitInRepo(repoPath, ['reset', '--soft', parentSha]);
  await runGitInRepo(repoPath, ['commit', '-m', message]);
}

function runGitInRepo(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim()));
        return;
      }
      resolve(stdout);
    });
  });
}
