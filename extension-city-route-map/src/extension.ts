import * as vscode from 'vscode';

const OPEN_PLANNER_COMMAND = 'cityRouteMap.openPlanner';

type ResolvedCity = {
  query: string;
  name: string;
  country: string;
  latitude: number;
  longitude: number;
};

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(OPEN_PLANNER_COMMAND, () => {
    CityRoutePanel.createOrShow(context.extensionUri);
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
}

class CityRoutePanel {
  private static currentPanel: CityRoutePanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (CityRoutePanel.currentPanel) {
      CityRoutePanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'cityRouteMap.panel',
      'City Route Map',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
      }
    );

    CityRoutePanel.currentPanel = new CityRoutePanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message);
    }, null, this.disposables);
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isResolveRequest(message)) {
      return;
    }

    const cities = normalizeCityList(message.cities);
    if (cities.length < 2) {
      this.panel.webview.postMessage({
        type: 'routeError',
        error: 'Enter at least two city names.'
      });
      return;
    }

    try {
      const resolved: ResolvedCity[] = [];
      for (const city of cities) {
        const point = await geocodeCity(city);
        resolved.push(point);
      }

      this.panel.webview.postMessage({
        type: 'routeReady',
        points: resolved
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      this.panel.webview.postMessage({
        type: 'routeError',
        error: details
      });
    }
  }

  public dispose(): void {
    CityRoutePanel.currentPanel = undefined;

    this.panel.dispose();
    while (this.disposables.length > 0) {
      const item = this.disposables.pop();
      item?.dispose();
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const stylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'));

    const nonce = getNonce();
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} https: 'unsafe-inline'`,
      `font-src ${webview.cspSource} https: data:`,
      `script-src 'nonce-${nonce}' https:`,
      'connect-src https:'
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>City Route Map</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="${stylesheetUri}" />
</head>
<body>
  <div class="layout">
    <section class="controls">
      <h1>City Route Map</h1>
      <p>Enter city names in order. One per line, or comma-separated.</p>
      <textarea id="cityInput" placeholder="Lisbon\nPorto\nMalaga"></textarea>
      <button id="drawRoute">Draw Route</button>
      <div id="status" aria-live="polite"></div>
      <ul id="results"></ul>
    </section>
    <section class="map-wrap">
      <div id="map" aria-label="Map with connected city routes"></div>
    </section>
  </div>

  <script nonce="${nonce}" src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function normalizeCityList(input: string): string[] {
  return input
    .split(/[\n,;]/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isResolveRequest(message: unknown): message is { type: 'resolveCities'; cities: string } {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const maybe = message as Record<string, unknown>;
  return maybe.type === 'resolveCities' && typeof maybe.cities === 'string';
}

async function geocodeCity(city: string): Promise<ResolvedCity> {
  const endpoint = new URL('https://geocoding-api.open-meteo.com/v1/search');
  endpoint.searchParams.set('name', city);
  endpoint.searchParams.set('count', '1');
  endpoint.searchParams.set('language', 'en');
  endpoint.searchParams.set('format', 'json');

  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to geocode "${city}" (HTTP ${response.status}).`);
  }

  const payload = (await response.json()) as {
    results?: Array<{
      name: string;
      country?: string;
      admin1?: string;
      latitude: number;
      longitude: number;
    }>;
  };

  const match = payload.results?.[0];
  if (!match) {
    throw new Error(`Could not find city "${city}".`);
  }

  const suffix = [match.admin1, match.country].filter(Boolean).join(', ');
  return {
    query: city,
    name: suffix ? `${match.name}, ${suffix}` : match.name,
    country: match.country ?? '',
    latitude: match.latitude,
    longitude: match.longitude
  };
}

function getNonce(): string {
  let value = '';
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let index = 0; index < 32; index += 1) {
    value += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return value;
}
