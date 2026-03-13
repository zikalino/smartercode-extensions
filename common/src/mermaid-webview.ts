import * as vscode from 'vscode';

export interface MermaidDiagramViewerOptions {
  panelId?: string;
  title?: string;
  viewColumn?: vscode.ViewColumn;
  extensionUri?: vscode.Uri;
  mermaidScriptPath?: string;
  cdnFallbackUrl?: string;
}

export class MermaidDiagramViewer implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private currentDiagram = '';

  constructor(private readonly options: MermaidDiagramViewerOptions = {}) {}

  show(diagram: string): void {
    this.currentDiagram = diagram;

    if (!this.panel) {
      const localResourceRoots = this.options.extensionUri
        ? [vscode.Uri.joinPath(this.options.extensionUri, 'media')]
        : undefined;

      this.panel = vscode.window.createWebviewPanel(
        this.options.panelId ?? 'mermaidDiagramViewer',
        this.options.title ?? 'Mermaid Diagram Viewer',
        this.options.viewColumn ?? vscode.ViewColumn.Active,
        {
          enableScripts: true,
          localResourceRoots
        }
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });

      this.panel.webview.html = this.getHtml(this.panel.webview, this.currentDiagram);
      return;
    }

    this.panel.reveal(this.options.viewColumn ?? vscode.ViewColumn.Active);
    void this.panel.webview.postMessage({ type: 'set-diagram', diagram: this.currentDiagram });
  }

  dispose(): void {
    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
    }
  }

  private getHtml(webview: vscode.Webview, diagram: string): string {
    const nonce = createNonce();
    const initialDiagram = JSON.stringify(diagram).replace(/</g, '\\u003c');
    const localScriptUri = this.options.extensionUri
      ? webview.asWebviewUri(
        vscode.Uri.joinPath(this.options.extensionUri, this.options.mermaidScriptPath ?? 'media/mermaid.min.js')
      ).toString()
      : '';
    const cdnFallbackUrl = this.options.cdnFallbackUrl ?? 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
    const scriptSources: string[] = [];
    if (localScriptUri) {
      scriptSources.push(localScriptUri);
    }
    scriptSources.push(cdnFallbackUrl);
    const scriptSourcesJson = JSON.stringify(scriptSources).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} data: https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource} https://cdn.jsdelivr.net;"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mermaid Diagram Viewer</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    body {
      margin: 0;
      padding: 16px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }

    .surface {
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 8px;
      padding: 16px;
      overflow: auto;
      min-height: 220px;
    }

    .error {
      white-space: pre-wrap;
      color: var(--vscode-errorForeground);
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="surface" id="content"></div>

  <script nonce="${nonce}">
    const content = document.getElementById('content');
    let currentDiagram = ${initialDiagram};
    const scriptSources = ${scriptSourcesJson};

    async function loadMermaidLibrary() {
      for (const source of scriptSources) {
        const loaded = await new Promise((resolve) => {
          const script = document.createElement('script');
          script.src = source;
          script.setAttribute('nonce', '${nonce}');
          script.onload = () => resolve(true);
          script.onerror = () => resolve(false);
          document.head.appendChild(script);
        });

        if (loaded && window.mermaid) {
          return true;
        }
      }

      return false;
    }

    function showError(message) {
      const error = document.createElement('pre');
      error.className = 'error';
      error.textContent = message;
      content.replaceChildren(error);
    }

    async function renderDiagram(diagram) {
      if (!window.mermaid) {
        showError('Mermaid library failed to load.');
        return;
      }

      try {
        const renderId = 'mmd-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        const result = await window.mermaid.render(renderId, diagram);
        content.innerHTML = result.svg;
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        showError('Unable to render diagram.\\n\\n' + details);
      }
    }

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'set-diagram') {
        currentDiagram = String(event.data.diagram ?? '');
        void renderDiagram(currentDiagram);
      }
    });

    async function boot() {
      const loaded = await loadMermaidLibrary();
      if (!loaded) {
        showError('Mermaid library failed to load from local file and CDN fallback.');
        return;
      }

      window.mermaid?.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default'
      });

      void renderDiagram(currentDiagram);
    }

    void boot();
  </script>
</body>
</html>`;
  }
}

function createNonce(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}