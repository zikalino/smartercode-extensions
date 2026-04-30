import * as vscode from 'vscode';

const OPEN_MONSTER_GENE_LAB = 'monsterGeneLab.open';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(OPEN_MONSTER_GENE_LAB, () => {
    const panel = vscode.window.createWebviewPanel(
      'monsterGeneLab.panel',
      'Monster Gene Lab',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
      }
    );

    panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'designer.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'designer.css'));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <title>Monster Gene Lab</title>
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div class="app-shell">
    <header class="header">
      <div>
        <h1>Monster Gene Lab</h1>
        <p>Drag gene chips into Parent A and Parent B, then breed a hybrid child.</p>
      </div>
      <div class="header-actions">
        <button id="reroll-btn" class="ghost">Reroll 8 Monsters</button>
        <button id="breed-btn">Breed Child</button>
      </div>
    </header>

    <section class="breeder" aria-label="Breeding workstation">
      <article class="parent" data-parent="a">
        <h2>Parent A Genome</h2>
        <div id="parent-a-card" class="monster-card parent-card empty">
          <div class="monster-name">No parent genes yet</div>
        </div>
        <div id="parent-a-slots" class="gene-slots"></div>
      </article>
      <article class="child-preview">
        <h2>Child</h2>
        <div id="child-card" class="monster-card child-card empty">
          <div class="monster-name">No child yet</div>
        </div>
      </article>
      <article class="parent" data-parent="b">
        <h2>Parent B Genome</h2>
        <div id="parent-b-card" class="monster-card parent-card empty">
          <div class="monster-name">No parent genes yet</div>
        </div>
        <div id="parent-b-slots" class="gene-slots"></div>
      </article>
    </section>

    <section>
      <h2 class="section-title">Monster Pool</h2>
      <p class="section-subtitle">Each card contains draggable genes and quick fill buttons.</p>
      <div id="monster-pool" class="monster-grid"></div>
    </section>

    <section class="escape-panel" aria-label="Escape simulation">
      <div class="escape-header">
        <div>
          <h2 class="section-title">Lab Escape Simulation</h2>
          <p class="section-subtitle">Several monsters attempt to escape while a scientist chases them.</p>
        </div>
        <button id="escape-start-btn" class="ghost">Start Escape Run</button>
      </div>
      <div id="escape-arena" class="escape-arena" role="img" aria-label="Lab room with escaping monsters"></div>
      <div id="escape-status" class="escape-status">Press Start Escape Run to begin.</div>
    </section>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 24; i += 1) {
    text += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return text;
}
