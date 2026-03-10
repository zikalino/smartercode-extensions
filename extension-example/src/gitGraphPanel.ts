import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { readGitHistory, type GitCommit } from './gitGraphData';

type GraphPayload = {
  repositoryRoot: string;
  commits: GitCommit[];
  generatedAt: string;
};

export class GitGraphPanel {
  private static currentPanel: GitGraphPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.context = context;
    this.panel.webview.html = this.getHtmlForWebview(panel.webview);

    this.panel.onDidDispose(() => {
      if (GitGraphPanel.currentPanel === this) {
        GitGraphPanel.currentPanel = undefined;
      }
    });

    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleWebviewMessage(message);
    });
  }

  public static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (GitGraphPanel.currentPanel) {
      GitGraphPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'extensionExample.gitGraph',
      'Git Commit Graph',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      }
    );

    GitGraphPanel.currentPanel = new GitGraphPanel(panel, context);
    void GitGraphPanel.currentPanel.refreshGraph();
  }

  private async handleWebviewMessage(message: unknown): Promise<void> {
    if (!isRecord(message) || typeof message.type !== 'string') {
      return;
    }

    if (message.type === 'ready' || message.type === 'refresh') {
      await this.refreshGraph();
      return;
    }

    if (message.type === 'copyCommit' && typeof message.payload === 'string') {
      await vscode.env.clipboard.writeText(message.payload);
      void vscode.window.showInformationMessage(`Copied commit hash: ${message.payload}`);
      return;
    }
  }

  private async refreshGraph(): Promise<void> {
    const repositoryRoot = await this.findRepositoryRoot();
    if (!repositoryRoot) {
      await this.panel.webview.postMessage({
        type: 'graphError',
        payload: 'No git repository found in the opened workspace.',
      });
      return;
    }

    try {
      const commits = await readGitHistory(repositoryRoot, 250);
      const payload: GraphPayload = {
        repositoryRoot,
        commits,
        generatedAt: new Date().toISOString(),
      };

      this.panel.title = `Git Commit Graph - ${path.basename(repositoryRoot)}`;
      await this.panel.webview.postMessage({
        type: 'graphData',
        payload,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown git error';
      await this.panel.webview.postMessage({
        type: 'graphError',
        payload: `Failed to read git history: ${message}`,
      });
    }
  }

  private async findRepositoryRoot(): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return undefined;
    }

    for (const folder of folders) {
      const gitDirPath = path.join(folder.uri.fsPath, '.git');
      try {
        await fs.stat(gitDirPath);
        return folder.uri.fsPath;
      } catch {
        // ignore missing .git
      }
    }

    return folders[0].uri.fsPath;
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'designer.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'designer.css'));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Git Commit Graph</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
