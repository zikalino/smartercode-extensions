import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  buildGitGraphUri,
  GitGraphFilter,
  GitGraphPanel,
  LocalGitDataProvider
} from '@upcloud/common';

const OPEN_VIEW_COMMAND = 'gitSlice.openView';
const SHOW_CONTEXT_COMMAND = 'gitSlice.showGitContext';

let currentRepoPath: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const localProvider = new LocalGitDataProvider();
  const panel = new GitGraphPanel({
    panelId: 'gitSlice.panel',
    title: 'Git Slice',
    branchLaneDistance: 14,
    commitVerticalDistance: 26,
    strokeWidth: 2.5,
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

    await openSlice(panel, localProvider, filter);
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

    await openSlice(panel, localProvider, filter);
  });

  context.subscriptions.push(openWorkspaceDisposable, showContextDisposable, panel);
}

export function deactivate(): void {
}

async function openSlice(
  panel: GitGraphPanel,
  provider: LocalGitDataProvider,
  filter: GitGraphFilter
): Promise<void> {
  panel.showLoading(filter);

  try {
    const model = await provider.getGraphSlice(filter);
    panel.showModel(model, filter);
  } catch (error) {
    panel.hideLoading();
    const details = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Git Slice: failed to load history. ${details}`);
  }
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
