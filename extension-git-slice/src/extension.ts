import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  buildGitGraphUri,
  GitCommandService,
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
const SAMPLE_COMMIT_COUNT = 1000;

let currentRepoPath: string | undefined;
let activeSlices: Array<{ filter: GitGraphFilter; model: GraphModel }> = [];
let currentPanel: GitGraphPanel | undefined;
let currentLocalProvider: LocalGitDataProvider | undefined;
let currentSampleProvider: GitDataProviderExample | undefined;
let currentGitCommandService: GitCommandService | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const localProvider = new LocalGitDataProvider();
  const sampleProvider = new GitDataProviderExample();
  const gitCommandService = new GitCommandService();
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
      void showCommitContextMenu(commitId, branch, selectedCommitIds, currentRepoPath);
    }
  });
  currentPanel = panel;
  currentLocalProvider = localProvider;
  currentSampleProvider = sampleProvider;
  currentGitCommandService = gitCommandService;

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

type CommitAction = 'tag' | 'branch' | 'checkout' | 'cherry-pick' | 'patch' | 'revert' | 'squash' | 'cumulative-patch' | 'slice-before' | 'slice-after' | 'change-message';

async function showCommitContextMenu(
  commitId: string,
  branch: string,
  selectedCommitIds: string[],
  repoPath: string | undefined
): Promise<void> {
  const isMulti = selectedCommitIds.length > 1;
  const context = resolveCommitActionContext(isMulti ? selectedCommitIds : [commitId], repoPath);
  const canRunLocalGitOperations = Boolean(context.repoPath);
  const canChangeMessage = canRunLocalGitOperations || context.source === 'sample';

  if (!canRunLocalGitOperations && isMulti) {
    void vscode.window.showWarningMessage('Git Slice: multi-commit operations are available only for local repository slices.');
    return;
  }

  const items: Array<{ label: string; description?: string; action: CommitAction }> = isMulti
    ? [
        { label: '$(file-code) Extract Cumulative Patch', description: `${selectedCommitIds.length} commits as one diff`, action: 'cumulative-patch' },
        { label: '$(git-merge) Squash Commits', description: `${selectedCommitIds.length} commits → 1`, action: 'squash' }
      ]
    : (() => {
        const singleItems: Array<{ label: string; description?: string; action: CommitAction }> = [
          { label: '$(split-horizontal) Slice Before', description: 'Split current slice before this commit', action: 'slice-before' },
          { label: '$(split-horizontal) Slice After', description: 'Split current slice after this commit', action: 'slice-after' }
        ];

        if (canChangeMessage) {
          singleItems.push(
            {
              label: '$(edit) Change Commit Message',
              description: context.source === 'sample' ? 'Simulate message rewrite in sample data' : 'Rewrite this commit message',
              action: 'change-message'
            }
          );
        }

        if (canRunLocalGitOperations) {
          singleItems.push(
            { label: '$(tag) Add Tag', action: 'tag' },
            { label: '$(git-branch) Add Branch', action: 'branch' },
            { label: '$(check) Checkout', action: 'checkout' },
            { label: '$(copy) Cherry Pick', action: 'cherry-pick' },
            { label: '$(file-code) Extract Patch', action: 'patch' },
            { label: '$(discard) Revert', action: 'revert' }
          );
        }

        return singleItems;
      })();

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
    await executeCommitAction(picked.action, commitId, selectedCommitIds, context.repoPath, context.source);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Git Slice: operation failed. ${details}`);
  }
}

function resolveCommitActionContext(
  commitIds: string[],
  fallbackRepoPath: string | undefined
): { source: 'local' | 'remote' | 'sample' | 'mixed' | 'unknown'; repoPath?: string } {
  const sliceEntries = commitIds
    .map((id) => activeSlices.find((entry) => entry.model.commits.some((commit) => commit.id === id)))
    .filter((entry): entry is { filter: GitGraphFilter; model: GraphModel } => Boolean(entry));

  if (sliceEntries.length === 0) {
    return fallbackRepoPath ? { source: 'unknown', repoPath: fallbackRepoPath } : { source: 'unknown' };
  }

  const sources = Array.from(new Set(sliceEntries.map((entry) => entry.filter.source)));
  if (sources.length !== 1) {
    return { source: 'mixed' };
  }

  const source = sources[0];
  if (source !== 'local') {
    return { source };
  }

  const repoPath = sliceEntries.find((entry) => Boolean(entry.filter.localPath))?.filter.localPath ?? fallbackRepoPath;
  return repoPath ? { source: 'local', repoPath } : { source: 'local' };
}

async function executeCommitAction(
  action: CommitAction,
  commitId: string,
  selectedCommitIds: string[],
  repoPath: string | undefined,
  source: 'local' | 'remote' | 'sample' | 'mixed' | 'unknown'
): Promise<void> {
  const gitCommandService = requireGitCommandService();

  switch (action) {
    case 'slice-before': {
      await splitSliceAtCommit(commitId, 'before');
      break;
    }

    case 'slice-after': {
      await splitSliceAtCommit(commitId, 'after');
      break;
    }

    case 'change-message': {
      if (source === 'sample') {
        await rewriteSampleCommitMessage(commitId);
        break;
      }

      if (!repoPath) {
        throw new Error('Changing commit message is only available for local repository slices.');
      }
      await rewriteCommitMessage(repoPath, commitId);
      break;
    }

    case 'tag': {
      if (!repoPath) {
        throw new Error('Tag action is only available for local repository slices.');
      }
      const name = await vscode.window.showInputBox({
        title: 'New tag',
        prompt: `Tag name for commit ${commitId}`,
        validateInput: (v) => v.trim().length === 0 ? 'Tag name cannot be empty.' : undefined
      });
      if (!name) { return; }
      await gitCommandService.createTag(repoPath, commitId, name.trim());
      void vscode.window.showInformationMessage(`Git Slice: tag '${name.trim()}' created at ${commitId}.`);
      break;
    }

    case 'branch': {
      if (!repoPath) {
        throw new Error('Branch action is only available for local repository slices.');
      }
      const name = await vscode.window.showInputBox({
        title: 'New branch',
        prompt: `Branch name from commit ${commitId}`,
        validateInput: (v) => v.trim().length === 0 ? 'Branch name cannot be empty.' : undefined
      });
      if (!name) { return; }
      await gitCommandService.createBranch(repoPath, commitId, name.trim());
      void vscode.window.showInformationMessage(`Git Slice: branch '${name.trim()}' created at ${commitId}.`);
      break;
    }

    case 'checkout': {
      if (!repoPath) {
        throw new Error('Checkout action is only available for local repository slices.');
      }
      await gitCommandService.checkoutCommit(repoPath, commitId);
      void vscode.window.showInformationMessage(`Git Slice: checked out ${commitId}.`);
      break;
    }

    case 'cherry-pick': {
      if (!repoPath) {
        throw new Error('Cherry-pick action is only available for local repository slices.');
      }
      await gitCommandService.cherryPickCommit(repoPath, commitId);
      void vscode.window.showInformationMessage(`Git Slice: cherry-picked ${commitId} onto current branch.`);
      break;
    }

    case 'patch': {
      if (!repoPath) {
        throw new Error('Patch extraction is only available for local repository slices.');
      }
      const patchContent = await gitCommandService.extractPatch(repoPath, commitId);
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
      if (!repoPath) {
        throw new Error('Revert action is only available for local repository slices.');
      }
      const confirmed = await vscode.window.showWarningMessage(
        `Revert commit ${commitId}? A new revert commit will be created.`,
        { modal: true },
        'Revert'
      );
      if (confirmed !== 'Revert') { return; }
      await gitCommandService.revertCommit(repoPath, commitId);
      void vscode.window.showInformationMessage(`Git Slice: reverted ${commitId}.`);
      break;
    }

    case 'squash': {
      if (!repoPath) {
        throw new Error('Squash action is only available for local repository slices.');
      }
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
      await gitCommandService.squashCommits(repoPath, selectedCommitIds, message.trim());
      void vscode.window.showInformationMessage(`Git Slice: squashed ${selectedCommitIds.length} commits.`);
      break;
    }

    case 'cumulative-patch': {
      if (!repoPath) {
        throw new Error('Cumulative patch extraction is only available for local repository slices.');
      }
      const result = await gitCommandService.extractCumulativePatch(repoPath, selectedCommitIds);

      const defaultUri = vscode.Uri.file(path.join(repoPath, `${result.oldestSha}-${result.newestSha}.patch`));
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'Patch files': ['patch', 'diff'], 'All files': ['*'] }
      });
      if (!saveUri) { return; }

      await vscode.workspace.fs.writeFile(saveUri, Buffer.from(result.content, 'utf8'));
      void vscode.window.showInformationMessage(`Git Slice: cumulative patch saved to ${saveUri.fsPath}.`);
      break;
    }
  }
}

function requireGitCommandService(): GitCommandService {
  if (!currentGitCommandService) {
    throw new Error('Git command service is not initialized.');
  }
  return currentGitCommandService;
}

async function splitSliceAtCommit(commitId: string, mode: 'before' | 'after'): Promise<void> {
  if (!currentPanel || !currentLocalProvider || !currentSampleProvider) {
    throw new Error('Git Slice is not initialized.');
  }

  const sliceIndex = activeSlices.findIndex((entry) => entry.model.commits.some((commit) => commit.id === commitId));
  if (sliceIndex < 0) {
    throw new Error('Selected commit is not part of an active slice.');
  }

  const sliceEntry = activeSlices[sliceIndex];
  const commits = sliceEntry.model.commits;
  const pivotIndex = commits.findIndex((commit) => commit.id === commitId);
  if (pivotIndex < 0) {
    throw new Error('Selected commit is not part of the current slice model.');
  }

  const firstCommits = mode === 'before'
    ? commits.slice(0, pivotIndex)
    : commits.slice(0, pivotIndex + 1);
  const secondCommits = mode === 'before'
    ? commits.slice(pivotIndex)
    : commits.slice(pivotIndex + 1);

  const firstRange = buildCommitRangeFromCommitIds(firstCommits);
  const secondRange = buildCommitRangeFromCommitIds(secondCommits);
  if (!firstRange || !secondRange) {
    throw new Error('Split would produce an empty slice. Pick another commit boundary.');
  }

  const provider: GitDataProvider = sliceEntry.filter.source === 'sample' ? currentSampleProvider : currentLocalProvider;
  const firstFilter: GitGraphFilter = { ...sliceEntry.filter, commitRange: firstRange, commitRanges: [firstRange] };
  firstFilter.uri = buildGitGraphUri(firstFilter);
  const secondFilter: GitGraphFilter = { ...sliceEntry.filter, commitRange: secondRange, commitRanges: [secondRange] };
  secondFilter.uri = buildGitGraphUri(secondFilter);

  const firstModel = await provider.getGraphSlice(firstFilter);
  const secondModel = await provider.getGraphSlice(secondFilter);

  activeSlices.splice(sliceIndex, 1, { filter: firstFilter, model: firstModel }, { filter: secondFilter, model: secondModel });
  renderActiveSlices(currentPanel);
  void vscode.window.showInformationMessage(`Git Slice: split slice into ${firstRange} and ${secondRange}.`);
}

function buildCommitRangeFromCommitIds(commits: GraphCommit[]): string | undefined {
  if (commits.length === 0) {
    return undefined;
  }

  const newest = String(commits[0]?.id || '').trim();
  const oldest = commits[commits.length - 1];
  const oldestId = String(oldest?.id || '').trim();
  if (!newest || !oldestId) {
    return undefined;
  }

  const oldestHasNoParents = (oldest.parents?.length ?? 0) === 0 && (oldest.hiddenParentCount ?? 0) === 0;
  if (oldestHasNoParents) {
    return newest;
  }

  return `${oldestId}^..${newest}`;
}

async function rewriteCommitMessage(repoPath: string, commitId: string): Promise<void> {
  const gitCommandService = requireGitCommandService();

  const newMessage = await vscode.window.showInputBox({
    title: 'Change Commit Message',
    prompt: `New message for ${commitId}`,
    validateInput: (value) => String(value || '').trim().length === 0 ? 'Commit message cannot be empty.' : undefined
  });
  if (!newMessage) {
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    'Changing a commit message rewrites history and changes commit SHAs. Continue?',
    { modal: true },
    'Rewrite'
  );
  if (confirmed !== 'Rewrite') {
    return;
  }

  const result = await gitCommandService.rewriteCommitMessage(repoPath, commitId, newMessage.trim());
  if (result.mode === 'amend-head') {
    void vscode.window.showInformationMessage('Git Slice: amended latest commit message.');
    return;
  }

  void vscode.window.showInformationMessage('Git Slice: commit message rewritten. You may need to force-push updated history.');
}

async function rewriteSampleCommitMessage(commitId: string): Promise<void> {
  if (!currentPanel) {
    throw new Error('Git Slice panel is not initialized.');
  }

  const newMessage = await vscode.window.showInputBox({
    title: 'Change Sample Commit Message',
    prompt: `New message for ${commitId}`,
    validateInput: (value) => String(value || '').trim().length === 0 ? 'Commit message cannot be empty.' : undefined
  });
  if (!newMessage) {
    return;
  }

  const updatedMessage = newMessage.trim();
  let updated = false;

  activeSlices = activeSlices.map((entry) => {
    if (entry.filter.source !== 'sample') {
      return entry;
    }

    let entryUpdated = false;
    const commits = entry.model.commits.map((commit) => {
      if (commit.id !== commitId) {
        return commit;
      }

      entryUpdated = true;
      updated = true;
      return { ...commit, message: updatedMessage };
    });

    if (!entryUpdated) {
      return entry;
    }

    return {
      ...entry,
      model: {
        ...entry.model,
        commits
      }
    };
  });

  if (!updated) {
    throw new Error('Selected sample commit was not found in active slices.');
  }

  renderActiveSlices(currentPanel);
  void vscode.window.showInformationMessage('Git Slice: sample commit message updated (simulated).');
}
function runGitInRepo(cwd: string, args: string[], extraEnv?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      {
        encoding: 'utf8',
        env: extraEnv ? { ...process.env, ...extraEnv } : process.env
      },
      (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim()));
        return;
      }
      resolve(stdout);
      }
    );
  });
}
