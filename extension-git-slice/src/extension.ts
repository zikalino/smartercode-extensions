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

export function activate(context: vscode.ExtensionContext): void {
  const localProvider = new LocalGitDataProvider();
  const panel = new GitGraphPanel({
    panelId: 'gitSlice.panel',
    title: 'Git Slice',
    branchLaneDistance: 28,
    commitVerticalDistance: 26,
    strokeWidth: 2.5
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
      files: []
    };
    filter.uri = buildGitGraphUri(filter);

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
      files: [relativeFilePath]
    };
    filter.uri = buildGitGraphUri(filter);

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
  try {
    const model = await provider.getGraphSlice(filter);
    panel.showModel(model, filter);
  } catch (error) {
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
