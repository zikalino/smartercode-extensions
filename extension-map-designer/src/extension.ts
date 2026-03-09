import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

type TileType = string;

type TileAsset = {
  id: string;
  name: string;
  imageUri: string;
};

const BUILTIN_TILE_TYPES = new Set(['empty', 'wall', 'platform', 'hazard', 'collectible', 'spawn', 'exit']);

type MapModel = {
  version: 1;
  width: number;
  height: number;
  title: string;
  tiles: TileType[];
};

const OPEN_MAP_DESIGNER_COMMAND = 'upcloudExplorer.openGameMapDesigner';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(OPEN_MAP_DESIGNER_COMMAND, () => {
    GameMapDesignerPanel.createOrShow(context);
  });

  context.subscriptions.push(disposable);
}

class GameMapDesignerPanel {
  private static currentPanel: GameMapDesignerPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private currentFileUri: vscode.Uri | undefined;

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.context = context;
    this.panel.webview.html = this.getHtmlForWebview(panel.webview);

    this.panel.onDidDispose(() => {
      if (GameMapDesignerPanel.currentPanel === this) {
        GameMapDesignerPanel.currentPanel = undefined;
      }
    });

    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleWebviewMessage(message);
    });
  }

  public static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (GameMapDesignerPanel.currentPanel) {
      GameMapDesignerPanel.currentPanel.panel.reveal(column);
      return;
    }

    const localResourceRoots = [vscode.Uri.joinPath(context.extensionUri, 'media')];
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      localResourceRoots.push(vscode.Uri.joinPath(workspaceFolder.uri, 'tiles'));
    }

    const panel = vscode.window.createWebviewPanel(
      'upcloudExplorer.gameMapDesigner',
      'Game Map Designer',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots,
      }
    );

    GameMapDesignerPanel.currentPanel = new GameMapDesignerPanel(panel, context);
  }

  private async handleWebviewMessage(message: unknown): Promise<void> {
    if (!isRecord(message) || typeof message.type !== 'string') {
      return;
    }

    if (message.type === 'saveMap') {
      const model = parseMapModel(message.payload);
      if (!model) {
        void vscode.window.showErrorMessage('Invalid map payload.');
        return;
      }

      await this.saveMap(model);
      return;
    }

    if (message.type === 'loadMap') {
      await this.loadMap();
      return;
    }

    if (message.type === 'ready') {
      await this.postTileAssets();
    }
  }

  private async postTileAssets(): Promise<void> {
    const tileAssets = await this.findWorkspaceTileAssets(this.panel.webview);
    await this.panel.webview.postMessage({
      type: 'setTileAssets',
      payload: tileAssets,
    });
  }

  private async findWorkspaceTileAssets(webview: vscode.Webview): Promise<TileAsset[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    const tilesUri = vscode.Uri.joinPath(workspaceFolder.uri, 'tiles');
    const supportedExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

    try {
      const entries = await vscode.workspace.fs.readDirectory(tilesUri);
      const assets = entries
        .filter(([name, type]) => type === vscode.FileType.File && supportedExtensions.has(path.extname(name).toLowerCase()))
        .map(([name]) => {
          const id = sanitizeTileId(path.basename(name, path.extname(name)));
          return {
            id,
            name: humanizeTileName(id),
            imageUri: webview.asWebviewUri(vscode.Uri.joinPath(tilesUri, name)).toString(),
          };
        })
        .filter((asset) => asset.id.length > 0);

      const uniqueById = new Map<string, TileAsset>();
      for (const asset of assets) {
        if (!uniqueById.has(asset.id)) {
          uniqueById.set(asset.id, asset);
        }
      }

      return Array.from(uniqueById.values());
    } catch {
      return [];
    }
  }

  private async saveMap(model: MapModel): Promise<void> {
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: this.currentFileUri ?? this.defaultWorkspaceFile('game-map.json'),
      filters: {
        'Map JSON': ['json'],
      },
      saveLabel: 'Save Game Map',
    });

    if (!saveUri) {
      return;
    }

    await fs.writeFile(saveUri.fsPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
    this.currentFileUri = saveUri;
    await this.context.workspaceState.update('upcloudExplorer.lastMapPath', saveUri.fsPath);
    this.panel.title = `Game Map Designer — ${path.basename(saveUri.fsPath)}`;
    void vscode.window.showInformationMessage(`Map saved: ${saveUri.fsPath}`);
  }

  private async loadMap(): Promise<void> {
    const defaultPath = this.currentFileUri?.fsPath
      ?? this.context.workspaceState.get<string>('upcloudExplorer.lastMapPath');

    const openResult = await vscode.window.showOpenDialog({
      canSelectMany: false,
      defaultUri: defaultPath ? vscode.Uri.file(defaultPath) : this.defaultWorkspaceFile('game-map.json'),
      filters: {
        'Map JSON': ['json'],
      },
      openLabel: 'Load Game Map',
    });

    if (!openResult || openResult.length === 0) {
      return;
    }

    const fileUri = openResult[0];
    const raw = await fs.readFile(fileUri.fsPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const model = parseMapModel(parsed);

    if (!model) {
      void vscode.window.showErrorMessage('Selected file is not a valid game map JSON.');
      return;
    }

    this.currentFileUri = fileUri;
    await this.context.workspaceState.update('upcloudExplorer.lastMapPath', fileUri.fsPath);
    this.panel.title = `Game Map Designer — ${path.basename(fileUri.fsPath)}`;
    await this.panel.webview.postMessage({
      type: 'loadMapData',
      payload: model,
    });
  }

  private defaultWorkspaceFile(fileName: string): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return vscode.Uri.file(path.join(process.cwd(), fileName));
    }

    return vscode.Uri.joinPath(folder.uri, fileName);
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'mapDesigner.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'mapDesigner.css'));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Game Map Designer</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseMapModel(value: unknown): MapModel | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const { version, width, height, title, tiles } = value;
  if (
    version !== 1
    || typeof width !== 'number'
    || typeof height !== 'number'
    || typeof title !== 'string'
    || !Array.isArray(tiles)
  ) {
    return undefined;
  }

  const normalizedTiles: TileType[] = [];

  for (const tileCandidate of tiles) {
    if (typeof tileCandidate !== 'string') {
      return undefined;
    }

    const normalized = sanitizeTileId(tileCandidate);
    if (!normalized) {
      return undefined;
    }

    normalizedTiles.push(normalized);
  }

  if (normalizedTiles.length !== width * height) {
    return undefined;
  }

  return {
    version: 1,
    width,
    height,
    title,
    tiles: normalizedTiles,
  };
}

function sanitizeTileId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
}

function humanizeTileName(id: string): string {
  return id
    .split(/[-_]/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return value;
}

export function deactivate(): void {
}
