import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

type DiagramNode = {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type DiagramEdge = {
  id: string;
  from: string;
  to: string;
};

type DiagramModel = {
  version: 1;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
};

const OPEN_DESIGNER_COMMAND = 'extensionExample.openDiagramDesigner';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(OPEN_DESIGNER_COMMAND, () => {
    DiagramDesignerPanel.createOrShow(context);
  });

  context.subscriptions.push(disposable);
}

class DiagramDesignerPanel {
  private static currentPanel: DiagramDesignerPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private currentFileUri: vscode.Uri | undefined;

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.context = context;
    this.panel.webview.html = this.getHtmlForWebview(panel.webview);

    this.panel.onDidDispose(() => {
      if (DiagramDesignerPanel.currentPanel === this) {
        DiagramDesignerPanel.currentPanel = undefined;
      }
    });

    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleWebviewMessage(message);
    });
  }

  public static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (DiagramDesignerPanel.currentPanel) {
      DiagramDesignerPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'extensionExample.diagramDesigner',
      'Diagram Designer',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      }
    );

    DiagramDesignerPanel.currentPanel = new DiagramDesignerPanel(panel, context);
  }

  private async handleWebviewMessage(message: unknown): Promise<void> {
    if (!isRecord(message) || typeof message.type !== 'string') {
      return;
    }

    if (message.type === 'ready') {
      return;
    }

    if (message.type === 'saveDiagram') {
      const model = parseDiagramModel(message.payload);
      if (!model) {
        void vscode.window.showErrorMessage('Invalid diagram payload.');
        return;
      }

      await this.saveDiagram(model);
      return;
    }

    if (message.type === 'loadDiagram') {
      await this.loadDiagram();
      return;
    }

    if (message.type === 'exportSvg' && typeof message.payload === 'string') {
      await this.exportSvg(message.payload);
      return;
    }
  }

  private async saveDiagram(model: DiagramModel): Promise<void> {
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: this.currentFileUri ?? this.defaultWorkspaceFile('diagram.json'),
      filters: {
        'Diagram JSON': ['json'],
      },
      saveLabel: 'Save Diagram',
    });

    if (!saveUri) {
      return;
    }

    await fs.writeFile(saveUri.fsPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
    this.currentFileUri = saveUri;
    await this.context.workspaceState.update('extensionExample.lastDiagramPath', saveUri.fsPath);
    this.panel.title = `Diagram Designer — ${path.basename(saveUri.fsPath)}`;
    void vscode.window.showInformationMessage(`Diagram saved: ${saveUri.fsPath}`);
  }

  private async loadDiagram(): Promise<void> {
    const defaultPath = this.currentFileUri?.fsPath
      ?? this.context.workspaceState.get<string>('extensionExample.lastDiagramPath');

    const openUri = await vscode.window.showOpenDialog({
      canSelectMany: false,
      defaultUri: defaultPath ? vscode.Uri.file(defaultPath) : this.defaultWorkspaceFile('diagram.json'),
      filters: {
        'Diagram JSON': ['json'],
      },
      openLabel: 'Load Diagram',
    });

    if (!openUri || openUri.length === 0) {
      return;
    }

    const fileUri = openUri[0];
    const raw = await fs.readFile(fileUri.fsPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const model = parseDiagramModel(parsed);

    if (!model) {
      void vscode.window.showErrorMessage('Selected file is not a valid diagram JSON.');
      return;
    }

    this.currentFileUri = fileUri;
    await this.context.workspaceState.update('extensionExample.lastDiagramPath', fileUri.fsPath);
    this.panel.title = `Diagram Designer — ${path.basename(fileUri.fsPath)}`;
    await this.panel.webview.postMessage({
      type: 'loadDiagramData',
      payload: model,
    });
  }

  private async exportSvg(svg: string): Promise<void> {
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: this.defaultWorkspaceFile('diagram.svg'),
      filters: {
        'SVG': ['svg'],
      },
      saveLabel: 'Export SVG',
    });

    if (!saveUri) {
      return;
    }

    await fs.writeFile(saveUri.fsPath, svg, 'utf8');
    void vscode.window.showInformationMessage(`SVG exported: ${saveUri.fsPath}`);
  }

  private defaultWorkspaceFile(fileName: string): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return vscode.Uri.file(path.join(process.cwd(), fileName));
    }

    return vscode.Uri.joinPath(folder.uri, fileName);
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
  <title>Diagram Designer</title>
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

function parseDiagramModel(value: unknown): DiagramModel | undefined {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return undefined;
  }

  const nodes: DiagramNode[] = [];
  for (const nodeCandidate of value.nodes) {
    if (!isRecord(nodeCandidate)) {
      return undefined;
    }

    const { id, type, label, x, y, w, h } = nodeCandidate;
    if (
      typeof id !== 'string'
      || typeof type !== 'string'
      || typeof label !== 'string'
      || typeof x !== 'number'
      || typeof y !== 'number'
      || typeof w !== 'number'
      || typeof h !== 'number'
    ) {
      return undefined;
    }

    nodes.push({ id, type, label, x, y, w, h });
  }

  const edges: DiagramEdge[] = [];
  for (const edgeCandidate of value.edges) {
    if (!isRecord(edgeCandidate)) {
      return undefined;
    }

    const { id, from, to } = edgeCandidate;
    if (typeof id !== 'string' || typeof from !== 'string' || typeof to !== 'string') {
      return undefined;
    }

    edges.push({ id, from, to });
  }

  return {
    version: 1,
    nodes,
    edges,
  };
}

export function deactivate(): void {
}
