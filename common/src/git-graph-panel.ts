import * as vscode from 'vscode';
import {
  GitDataProvider,
  GitDataProviderExample,
  GitGraphFilter,
  LocalGitDataProvider,
  parseGitGraphUri,
  RemoteGitDataProvider
} from './git-data-provider';
import { GraphCommit, GraphModel } from './git-graph-types';

export interface GitGraphPanelOptions {
  panelId?: string;
  title?: string;
  viewColumn?: vscode.ViewColumn;
  transform?: (graphDefinition: string) => string;
  branchLaneDistance?: number;
  commitVerticalDistance?: number;
  strokeWidth?: number;
  onCommitClick?: (commitId: string, branch: string) => void;
  onCommitContextMenu?: (commitId: string, branch: string, selectedCommitIds: string[]) => void;
  localDataProvider?: GitDataProvider;
  remoteDataProvider?: GitDataProvider;
  fallbackDataProvider?: GitDataProvider;
}

export class GitGraphPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly options: GitGraphPanelOptions;
  private readonly localProvider: GitDataProvider;
  private readonly remoteProvider: GitDataProvider;
  private readonly fallbackProvider: GitDataProvider;

  constructor(options: GitGraphPanelOptions = {}) {
    this.options = options;
    this.localProvider = options.localDataProvider ?? new LocalGitDataProvider();
    this.remoteProvider = options.remoteDataProvider ?? new RemoteGitDataProvider();
    this.fallbackProvider = options.fallbackDataProvider ?? new GitDataProviderExample();
  }

  show(graphDefinition: string): void {
    const normalized = normalizeGitGraphDefinition(graphDefinition);
    const transformed = this.options.transform ? this.options.transform(normalized) : normalized;
    const parsedModel = parseGitGraph(transformed);
    const model = shouldUseSampleModel(transformed, parsedModel)
      ? createSampleGraphModel()
      : parsedModel;

    this.showModel(model);
  }

  showLoading(initialFilter?: GitGraphFilter): void {
    const initialConfig = {
      branchLaneDistance: this.options.branchLaneDistance ?? 60,
      commitVerticalDistance: this.options.commitVerticalDistance ?? 46,
      strokeWidth: this.options.strokeWidth ?? 2.2
    };

    const placeholder = createSampleGraphModel();

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        this.options.panelId ?? 'gitGraphPanel',
        this.options.title ?? 'Git Graph',
        this.options.viewColumn ?? vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: []
        }
      );

      this.panel.webview.onDidReceiveMessage(async (message) => {
        if (message?.type === 'apply-filter') {
          const filter = this.parseFilterFromMessage(message);
          const provider = this.resolveProvider(filter);

          try {
            const providedModel = await provider.getGraphSlice(filter);
            const modelToRender = this.ensureRenderableModel(providedModel, placeholder);
            void this.panel?.webview.postMessage({
              type: 'set-graph',
              model: modelToRender,
              config: initialConfig
            });
          } catch (error) {
            const details = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Failed to load graph slice: ${details}`);
            void this.panel?.webview.postMessage({ type: 'set-loading', loading: false });
          }
          return;
        }

        if (message?.type === 'commit-context-menu') {
          if (typeof message.commitId !== 'string' || typeof message.branch !== 'string') {
            return;
          }

          const selectedCommitIds = Array.isArray(message.selectedCommitIds)
            ? message.selectedCommitIds.filter((id: unknown): id is string => typeof id === 'string')
            : [message.commitId];
          this.options.onCommitContextMenu?.(message.commitId, message.branch, selectedCommitIds);
          return;
        }

        if (message?.type !== 'commit-click') {
          return;
        }

        if (typeof message.commitId !== 'string' || typeof message.branch !== 'string') {
          return;
        }

        this.options.onCommitClick?.(message.commitId, message.branch);
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }

    this.panel.webview.html = this.getHtml(
      this.panel.webview,
      placeholder,
      initialConfig,
      initialFilter?.uri,
      true
    );

    this.panel.reveal(this.options.viewColumn ?? vscode.ViewColumn.Active);
    void this.panel.webview.postMessage({ type: 'set-loading', loading: true });
  }

  hideLoading(): void {
    if (!this.panel) {
      return;
    }
    void this.panel.webview.postMessage({ type: 'set-loading', loading: false });
  }

  showModel(model: GraphModel, initialFilter?: GitGraphFilter): void {
    const normalizedModel = (!model || !Array.isArray(model.branches) || !Array.isArray(model.commits) || model.commits.length === 0)
      ? createSampleGraphModel()
      : model;

    const initialConfig = {
      branchLaneDistance: this.options.branchLaneDistance ?? 60,
      commitVerticalDistance: this.options.commitVerticalDistance ?? 46,
      strokeWidth: this.options.strokeWidth ?? 2.2
    };

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        this.options.panelId ?? 'gitGraphPanel',
        this.options.title ?? 'Git Graph',
        this.options.viewColumn ?? vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: []
        }
      );

      this.panel.webview.onDidReceiveMessage(async (message) => {
        if (message?.type === 'apply-filter') {
          const filter = this.parseFilterFromMessage(message);
          const provider = this.resolveProvider(filter);

          try {
            const providedModel = await provider.getGraphSlice(filter);
            const modelToRender = this.ensureRenderableModel(providedModel, normalizedModel);
            void this.panel?.webview.postMessage({
              type: 'set-graph',
              model: modelToRender,
              config: initialConfig
            });
          } catch (error) {
            const details = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Failed to load graph slice: ${details}`);
          }
          return;
        }

        if (message?.type === 'commit-context-menu') {
          if (typeof message.commitId !== 'string' || typeof message.branch !== 'string') {
            return;
          }

          const selectedCommitIds = Array.isArray(message.selectedCommitIds)
            ? message.selectedCommitIds.filter((id: unknown): id is string => typeof id === 'string')
            : [message.commitId];
          this.options.onCommitContextMenu?.(message.commitId, message.branch, selectedCommitIds);
          return;
        }

        if (message?.type !== 'commit-click') {
          return;
        }

        if (typeof message.commitId !== 'string' || typeof message.branch !== 'string') {
          return;
        }

        this.options.onCommitClick?.(message.commitId, message.branch);
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }

    // Refresh the webview markup on each show call so renderer updates are applied
    // even when retainContextWhenHidden keeps an existing panel instance alive.
    this.panel.webview.html = this.getHtml(
      this.panel.webview,
      normalizedModel,
      initialConfig,
      initialFilter?.uri
    );

    this.panel.reveal(this.options.viewColumn ?? vscode.ViewColumn.Active);
    void this.panel.webview.postMessage({
      type: 'set-graph',
      model: normalizedModel,
      config: initialConfig
    });
  }

  dispose(): void {
    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
    }
  }

  private parseFilterFromMessage(message: unknown): GitGraphFilter {
    const asRecord = (message && typeof message === 'object') ? (message as Record<string, unknown>) : {};
    const uri = typeof asRecord.uri === 'string' ? asRecord.uri : '';
    const parsed = parseGitGraphUri(uri);

    const branches = Array.isArray(asRecord.branches)
      ? asRecord.branches.filter((value): value is string => typeof value === 'string')
      : parsed.branches;
    const files = Array.isArray(asRecord.files)
      ? asRecord.files.filter((value): value is string => typeof value === 'string')
      : parsed.files;

    return {
      ...parsed,
      uri: parsed.uri || uri,
      source: asRecord.source === 'remote' ? 'remote' : asRecord.source === 'sample' ? 'sample' : (asRecord.source === 'local' ? 'local' : parsed.source),
      localPath: typeof asRecord.localPath === 'string' ? asRecord.localPath : parsed.localPath,
      remoteUrl: typeof asRecord.remoteUrl === 'string' ? asRecord.remoteUrl : parsed.remoteUrl,
      branches,
      files,
      commitRange: typeof asRecord.commitRange === 'string' ? asRecord.commitRange : parsed.commitRange
    };
  }

  private resolveProvider(filter: GitGraphFilter): GitDataProvider {
    if (filter.source === 'sample') {
      return this.fallbackProvider;
    }
    if (filter.source === 'remote' && this.remoteProvider.canHandle(filter)) {
      return this.remoteProvider;
    }
    if (filter.source === 'local' && this.localProvider.canHandle(filter)) {
      return this.localProvider;
    }
    return this.fallbackProvider;
  }

  private ensureRenderableModel(candidate: GraphModel, fallback: GraphModel): GraphModel {
    if (!candidate || !Array.isArray(candidate.branches) || !Array.isArray(candidate.commits)) {
      return fallback;
    }

    if (candidate.commits.length === 0) {
      return fallback;
    }

    return candidate;
  }

  private getHtml(
    webview: vscode.Webview,
    initialModel: GraphModel,
    initialConfig: { branchLaneDistance: number; commitVerticalDistance: number; strokeWidth: number },
    initialFilterUri?: string,
    initialLoading = false
  ): string {
    const nonce = createNonce();
    const initialPayload = JSON.stringify({ model: initialModel, config: initialConfig }).replace(/</g, '\\u003c');
    const initialFilterUriJson = JSON.stringify(initialFilterUri ?? '').replace(/</g, '\\u003c');
    const initialLoadingJson = initialLoading ? 'true' : 'false';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    html,
    body {
      height: 100%;
    }

    body {
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      overflow: hidden;
    }

    .panel {
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 8px;
      overflow: hidden;
      margin: 12px;
      height: calc(100vh - 24px);
      min-height: 240px;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
    }

    #view {
      position: relative;
      display: flex;
      flex: 1;
      min-height: 260px;
      overflow: auto;
      background: var(--vscode-editor-background);
    }

    #graphLoading {
      position: absolute;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 8;
      background: color-mix(in srgb, var(--vscode-editor-background) 86%, transparent);
      pointer-events: none;
    }

    #graphLoading.visible {
      display: flex;
    }

    #graphLoading svg {
      width: 28px;
      height: 28px;
    }

    #graphLoading circle {
      fill: var(--vscode-editor-background);
      stroke: color-mix(in srgb, var(--vscode-focusBorder) 75%, var(--vscode-foreground));
      stroke-width: 1.1;
      stroke-dasharray: 3 2;
      animation: hidden-node-spin 0.85s linear infinite;
      transform-origin: center;
      transform-box: fill-box;
    }

    #graphHeader {
      border-bottom: 1px solid var(--vscode-editorWidget-border);
      background: color-mix(in srgb, var(--vscode-editor-background) 85%, var(--vscode-sideBar-background));
    }

    #headerCollapsed {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
    }

    #headerToggle {
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font-size: 16px;
      line-height: 1;
      height: 24px;
      min-width: 28px;
      cursor: pointer;
      opacity: 0.75;
    }

    #headerToggle:hover {
      background: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 88%, transparent);
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 65%, transparent);
      opacity: 1;
    }

    #headerExpanded {
      padding: 8px 10px 6px;
    }

    #headerUriRow {
      display: flex;
      gap: 6px;
      align-items: flex-end;
      margin-bottom: 6px;
    }

    #headerUriRow .header-field {
      flex: 1;
      min-width: 0;
    }

    #headerFieldsRow {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: flex-end;
    }

    .header-field {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .header-field label {
      font-size: 11px;
      opacity: 0.8;
    }

    .header-field input,
    .header-field select,
    .header-field button {
      height: 26px;
      border-radius: 4px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      padding: 0 8px;
      min-width: 0;
    }

    .header-actions {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .header-range {
      min-width: 240px;
    }

    .header-range-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .header-range-row input {
      flex: 1;
      min-width: 0;
    }

    .header-range-sep {
      opacity: 0.75;
      font-size: 12px;
      user-select: none;
    }

    #applyFilter {
      border-color: var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      white-space: nowrap;
    }

    #headerStatus {
      font-size: 11px;
      opacity: 0.75;
      min-height: 14px;
      margin-top: 4px;
    }

    #graphColumn {
      width: 180px;
      min-width: 96px;
      border-right: 1px solid var(--vscode-editorWidget-border);
      position: relative;
      background: var(--vscode-sideBar-background);
    }

    #commitGraph {
      display: block;
      position: absolute;
      left: 0;
      top: 0;
      z-index: 2;
      pointer-events: none;
    }

    #commitGraph circle {
      pointer-events: all;
      cursor: pointer;
    }

    #commitGraph circle.current {
      fill: var(--vscode-editor-background);
      stroke-width: 2;
    }

    #commitGraph circle.merge {
      fill: var(--vscode-editor-background);
      stroke-width: 2.4;
    }

    #commitGraph circle.merge.detached-merge {
      stroke-dasharray: 2.5 2.5;
    }

    #commitGraph circle.mergeInner {
      pointer-events: none;
      stroke: none;
    }

    #commitGraph rect.detachedMergeInner {
      pointer-events: none;
      stroke: none;
    }

    #commitGraph circle:not(.current) {
      stroke: var(--vscode-editor-background);
      stroke-width: 1;
      stroke-opacity: 0.75;
    }

    #commitGraph circle.merge:not(.current) {
      stroke: inherit;
      stroke-opacity: 1;
    }

    #commitGraph circle.stashInner {
      stroke-opacity: 1;
      pointer-events: none;
      fill: transparent;
    }

    #commitGraph path.shadow {
      fill: none;
      stroke: var(--vscode-editor-background);
      stroke-opacity: 0.75;
      stroke-width: 4;
    }

    #commitGraph path.line {
      fill: none;
      stroke-width: 2;
    }

    #commitGraph .hidden-edge-connector {
      fill: none;
      stroke: color-mix(in srgb, var(--vscode-descriptionForeground) 78%, transparent);
      stroke-width: 1.4;
      stroke-dasharray: 3 2;
      pointer-events: none;
    }

    #commitGraph .hidden-node-circle {
      fill: var(--vscode-editor-background);
      stroke-dasharray: 2.5 2.5;
      stroke-linecap: round;
      pointer-events: none;
    }

    #commitGraph .hidden-node-circle.loading {
      stroke-dasharray: 7 3;
      animation: hidden-node-spin 0.85s linear infinite;
      transform-origin: center;
      transform-box: fill-box;
    }

    #commitGraph .hidden-node-plus {
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
    }

    #commitGraph .hidden-node-plus.loading {
      opacity: 0;
    }

    #commitGraph .hidden-node-hittarget {
      fill: transparent;
      stroke: none;
      cursor: pointer;
    }

    #commitGraph .hidden-node-hittarget.loading {
      pointer-events: none;
      cursor: progress;
    }

    @keyframes hidden-node-spin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }

    #graphTooltip {
      display: block;
      position: absolute;
      pointer-events: none;
      z-index: 7;
    }

    #graphTooltipPointer {
      position: absolute;
      display: block;
      width: 30px;
      height: 2px;
      left: 4px;
      top: 0;
      margin-top: -1px;
      z-index: 4;
    }

    #graphTooltipContent {
      position: relative;
      left: 23px;
      top: 0;
      background-color: var(--vscode-menu-background);
      border-width: 2px;
      border-style: solid;
      border-radius: 5px;
      color: var(--vscode-menu-foreground);
      font-size: 12px;
      line-height: 18px;
      white-space: normal;
      z-index: 5;
    }

    #graphTooltipShadow {
      position: absolute;
      left: 23px;
      top: 0;
      border-radius: 5px;
      box-shadow: 0 0 20px 4px var(--vscode-widget-shadow);
      z-index: 3;
    }

    .graphTooltipTitle,
    .graphTooltipSection {
      padding: 3px 8px;
    }

    .graphTooltipTitle {
      text-align: center;
      font-weight: 700;
    }

    .graphTooltipSection {
      border-top: 1px solid rgba(128, 128, 128, 0.5);
    }

    .graphTooltipRef,
    .graphTooltipCombinedRef {
      display: inline-block;
      height: 18px;
      line-height: 18px;
    }

    .graphTooltipRef {
      margin: 2px;
      padding: 0 5px;
      background-color: rgba(128, 128, 128, 0.15);
      border-radius: 5px;
      border: 1px solid rgba(128, 128, 128, 0.75);
      vertical-align: top;
      font-size: 12px;
      cursor: default;
    }

    .graphTooltipCombinedRef {
      margin-left: 5px;
      padding-left: 5px;
      border-left: 1px solid rgba(128, 128, 128, 0.45);
      font-style: italic;
    }

    #commitTable {
      flex: 1;
      min-width: 280px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .status {
      font-size: 12px;
      opacity: 0.8;
      padding: 4px 2px 8px;
    }

    .status.subtle {
      opacity: 0.65;
    }

    .commit {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 24px;
      padding: 2px 8px;
      border-radius: 6px;
      cursor: pointer;
      user-select: none;
    }

    .commit:hover,
    .commit.graphVertexActive {
      background: color-mix(in srgb, var(--vscode-list-hoverBackground) 85%, transparent);
    }

    .commit.selected {
      background: color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 85%, transparent);
      outline: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 60%, transparent);
    }

    .commit:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .commit-id {
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      opacity: 0.95;
      min-width: 110px;
    }

    .commit-time {
      font-size: 11px;
      opacity: 0.78;
      min-width: 150px;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    .commit-branch {
      font-size: 11px;
      opacity: 0.8;
      border: 1px solid color-mix(in srgb, var(--vscode-editorWidget-border) 85%, transparent);
      border-radius: 10px;
      padding: 0 6px;
      line-height: 16px;
    }

    .commit-branch-extra {
      background: transparent;
      color: inherit;
      cursor: pointer;
      opacity: 0.86;
    }

    .commit-branch-extra:hover {
      opacity: 1;
      background: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 80%, transparent);
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 55%, transparent);
    }

    .commit-tag {
      font-size: 10px;
      line-height: 14px;
      padding: 0 6px;
      border-radius: 10px;
      border: 1px solid color-mix(in srgb, var(--vscode-charts-orange) 55%, var(--vscode-editorWidget-border));
      background: color-mix(in srgb, var(--vscode-charts-orange) 18%, transparent);
      color: color-mix(in srgb, var(--vscode-charts-orange) 88%, var(--vscode-foreground));
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .commit-merge {
      font-size: 10px;
      line-height: 14px;
      padding: 0 6px;
      border-radius: 10px;
      border: 1px solid color-mix(in srgb, var(--vscode-charts-yellow) 62%, var(--vscode-editorWidget-border));
      background: color-mix(in srgb, var(--vscode-charts-yellow) 16%, transparent);
      color: color-mix(in srgb, var(--vscode-charts-yellow) 95%, var(--vscode-foreground));
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }

    .commit-merge-detached {
      font-size: 10px;
      line-height: 14px;
      padding: 0 6px;
      border-radius: 10px;
      border: 1px dashed color-mix(in srgb, var(--vscode-charts-blue) 58%, var(--vscode-editorWidget-border));
      background: color-mix(in srgb, var(--vscode-charts-blue) 12%, transparent);
      color: color-mix(in srgb, var(--vscode-charts-blue) 92%, var(--vscode-foreground));
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }

    .commit-message {
      flex: 1;
      min-width: 0;
      font-size: 12px;
      opacity: 0.92;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .commit-head {
      font-size: 10px;
      line-height: 14px;
      padding: 0 6px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--vscode-badge-background) 88%, transparent);
      color: var(--vscode-badge-foreground);
    }

    .commit-menu-btn {
      margin-left: auto;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font-size: 14px;
      line-height: 1;
      height: 20px;
      width: 24px;
      cursor: pointer;
      opacity: 0.8;
    }

    .commit-menu-btn:hover {
      background: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 88%, transparent);
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 65%, transparent);
      opacity: 1;
    }

    .error {
      color: var(--vscode-errorForeground);
      white-space: pre-wrap;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="panel" id="root">
    <div id="graphHeader"></div>
    <div id="view">
      <div id="graphColumn"><div id="commitGraph"></div></div>
      <div id="commitTable"></div>
      <div id="graphLoading" aria-live="polite" aria-label="Loading graph">
        <svg viewBox="0 0 20 20" role="img" aria-hidden="true">
          <circle cx="10" cy="10" r="5.5"></circle>
        </svg>
      </div>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const root = document.getElementById('root');
    const viewElem = document.getElementById('view');
    const tableElem = document.getElementById('commitTable');
    const graphColumnElem = document.getElementById('graphColumn');
    const loadingElem = document.getElementById('graphLoading');
    const initialPayload = ${initialPayload};
    const initialFilterUri = ${initialFilterUriJson};
    const initialLoading = ${initialLoadingJson};
    const COLORS = ['#1a73e8', '#34a853', '#ea4335', '#fbbc05', '#3f51b5', '#009688', '#ef6c00', '#8e24aa', '#4e6cef', '#5e9b45'];
    const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
    const UNCOMMITTED = '*';
    let currentModel = null;
    let currentConfig = null;
    let currentFallbackLayout = null;
    let alignRafHandle = 0;

    function setLoadingVisible(visible) {
      if (!loadingElem) {
        return;
      }
      loadingElem.classList.toggle('visible', Boolean(visible));
    }

    const GG = {
      GraphStyle: {
        Angular: 0,
        Curved: 1
      },
      GraphUncommittedChangesStyle: {
        OpenCircleAtTheCheckedOutCommit: 0,
        OpenCircleAtTheUncommittedChanges: 1
      }
    };

    function parseCsvInput(value) {
      return String(value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }

    function decodeCsvFromUri(params, key) {
      const raw = params.get(key);
      if (!raw) {
        return [];
      }
      return parseCsvInput(raw);
    }

    function parseUriToHeaderState(uri) {
      const fallback = {
        uri,
        source: 'local',
        localPath: 'workspace',
        remoteUrl: '',
        branches: [],
        files: [],
        commitRange: ''
      };

      if (!String(uri).startsWith('gitgraph://')) {
        return fallback;
      }

      const withoutPrefix = String(uri).slice('gitgraph://'.length);
      const parts = withoutPrefix.split('?');
      const sourceAndTarget = parts[0];
      const query = parts[1] || '';
      const slash = sourceAndTarget.indexOf('/');
      const sourcePart = slash >= 0 ? sourceAndTarget.slice(0, slash) : sourceAndTarget;
      const targetPart = slash >= 0 ? sourceAndTarget.slice(slash + 1) : '';
      const params = new URLSearchParams(query);

      return {
        uri,
        source: sourcePart === 'remote' ? 'remote' : sourcePart === 'sample' ? 'sample' : 'local',
        localPath: sourcePart === 'local' ? decodeURIComponent(targetPart || 'workspace') : '',
        remoteUrl: sourcePart === 'remote' ? decodeURIComponent(targetPart) : '',
        branches: decodeCsvFromUri(params, 'branches'),
        files: decodeCsvFromUri(params, 'files'),
        commitRange: params.get('range') || ''
      };
    }

    function splitCommitRange(value) {
      const text = String(value || '').trim();
      if (!text) {
        return { start: '', end: '' };
      }

      const marker = text.indexOf('..');
      if (marker < 0) {
        return { start: text, end: '' };
      }

      return {
        start: text.slice(0, marker).trim(),
        end: text.slice(marker + 2).trim()
      };
    }

    function joinCommitRange(start, end) {
      const left = String(start || '').trim();
      const right = String(end || '').trim();
      if (!left && !right) {
        return '';
      }
      if (!left) {
        return right;
      }
      if (!right) {
        return left;
      }
      return left + '..' + right;
    }

    function buildUriFromHeaderState(state) {
      const source = state.source === 'remote' ? 'remote' : state.source === 'sample' ? 'sample' : 'local';
      const target = source === 'remote'
        ? String(state.remoteUrl || '')
        : source === 'sample'
          ? ''
          : String(state.localPath || 'workspace');
      const params = new URLSearchParams();
      const branches = parseCsvInput(state.branches);
      const files = parseCsvInput(state.files);

      if (branches.length > 0) {
        params.set('branches', branches.join(','));
      }
      if (files.length > 0) {
        params.set('files', files.join(','));
      }
      if (String(state.commitRange || '').trim().length > 0) {
        params.set('range', String(state.commitRange).trim());
      }

      const query = params.toString();
      return 'gitgraph://' + source + '/' + encodeURIComponent(target) + (query ? '?' + query : '');
    }

    function setHeaderStatus(message) {
      const elem = document.getElementById('headerStatus');
      if (elem) {
        elem.textContent = message;
      }
    }

    function applyHeaderFilter(filter, statusPrefix) {
      const prefix = String(statusPrefix || 'Applying: ');
      setHeaderStatus(prefix + filter.uri);
      const collapsedStatus = document.getElementById('headerCollapsedStatus');
      if (collapsedStatus) {
        collapsedStatus.textContent = filter.uri;
      }

      vscode.postMessage({
        type: 'apply-filter',
        uri: filter.uri,
        source: filter.source,
        localPath: filter.localPath,
        remoteUrl: filter.remoteUrl,
        branches: filter.branches,
        files: filter.files,
        commitRange: filter.commitRange
      });
    }

    function requestAddBranchToFilter(branchName) {
      const normalized = String(branchName || '').trim();
      if (!normalized) {
        return;
      }

      const branchesInput = document.getElementById('filterBranches');
      if (!branchesInput) {
        return;
      }

      const confirmed = window.confirm('Add branch "' + normalized + '" to the graph filter?');
      if (!confirmed) {
        return;
      }

      const currentBranches = parseCsvInput(branchesInput.value);
      if (!currentBranches.includes(normalized)) {
        currentBranches.push(normalized);
      }
      branchesInput.value = currentBranches.join(',');

      const filter = collectHeaderFilter();
      applyHeaderFilter(filter, 'Adding branch: ');
    }

    function increaseTildeDepth(ref, increment, fallbackBase) {
      const text = String(ref || '').trim();
      const delta = Math.max(1, Number(increment || 1));

      if (!text) {
        return String(fallbackBase || 'HEAD') + '~' + String(delta);
      }

      const tokens = text.split('~').map((token) => token.trim()).filter((token) => token.length > 0);
      if (tokens.length === 0) {
        return String(fallbackBase || 'HEAD') + '~' + String(delta);
      }

      let base = tokens[0];
      let depth = 0;
      for (let index = 1; index < tokens.length; index += 1) {
        const part = Number(tokens[index]);
        if (!Number.isFinite(part)) {
          base += '~' + tokens[index];
          continue;
        }

        depth += Math.max(0, Math.floor(part));
      }

      return base + '~' + String(depth + delta);
    }

    function expandCommitRangeForDirection(currentRange, direction, commitId) {
      const parts = splitCommitRange(currentRange);

      if (direction === 'parents') {
        if (!parts.start && !parts.end) {
          return joinCommitRange(increaseTildeDepth(commitId, 40, commitId), commitId);
        }

        if (!parts.start && parts.end) {
          return joinCommitRange(increaseTildeDepth(parts.end, 40, commitId), parts.end);
        }

        return joinCommitRange(increaseTildeDepth(parts.start, 40, commitId), parts.end);
      }

      if (!parts.start && !parts.end) {
        return joinCommitRange(increaseTildeDepth(commitId, 80, commitId), 'HEAD');
      }

      if (parts.start && !parts.end) {
        return joinCommitRange(parts.start, 'HEAD');
      }

      return joinCommitRange(parts.start, 'HEAD');
    }

    function requestHiddenEdgeExpansion(direction, commitId) {
      const rangeStartInput = document.getElementById('filterRangeStart');
      const rangeEndInput = document.getElementById('filterRangeEnd');
      const currentRange = joinCommitRange(
        rangeStartInput ? rangeStartInput.value : '',
        rangeEndInput ? rangeEndInput.value : ''
      );
      const nextRange = expandCommitRangeForDirection(currentRange, direction, commitId);
      const split = splitCommitRange(nextRange);

      if (rangeStartInput) {
        rangeStartInput.value = split.start;
      }
      if (rangeEndInput) {
        rangeEndInput.value = split.end;
      }

      const filter = collectHeaderFilter();
      const directionLabel = direction === 'parents' ? 'older' : 'newer';
      applyHeaderFilter(filter, 'Loading ' + directionLabel + ' commits: ');
    }

    function requestHiddenMergeBranchExpansion(branchName, commitId) {
      const normalizedBranch = String(branchName || '').trim();
      if (!normalizedBranch) {
        return;
      }

      const branchesInput = document.getElementById('filterBranches');
      if (branchesInput) {
        const branches = parseCsvInput(branchesInput.value);
        if (!branches.includes(normalizedBranch)) {
          branches.push(normalizedBranch);
          branchesInput.value = branches.join(',');
        }
      }

      const rangeStartInput = document.getElementById('filterRangeStart');
      const rangeEndInput = document.getElementById('filterRangeEnd');
      const currentRange = joinCommitRange(
        rangeStartInput ? rangeStartInput.value : '',
        rangeEndInput ? rangeEndInput.value : ''
      );
      const nextRange = expandCommitRangeForDirection(currentRange, 'parents', commitId);
      const split = splitCommitRange(nextRange);

      if (rangeStartInput) {
        rangeStartInput.value = split.start;
      }
      if (rangeEndInput) {
        rangeEndInput.value = split.end;
      }

      const filter = collectHeaderFilter();
      applyHeaderFilter(filter, 'Loading merge branch ' + normalizedBranch + ': ');
    }

    function requestMergeParentExpansion(mergeParentId, branchName) {
      const mergeParent = String(mergeParentId || '').trim();
      if (!mergeParent) {
        return;
      }

      const normalizedBranch = String(branchName || '').trim();
      const branchesInput = document.getElementById('filterBranches');
      if (branchesInput) {
        const branches = parseCsvInput(branchesInput.value)
          .filter((name) => !String(name).startsWith('merge-parent/'));
        if (normalizedBranch) {
          if (!branches.includes(normalizedBranch)) {
            branches.push(normalizedBranch);
          }
        }
        branchesInput.value = branches.join(',');
      }

      const rangeStartInput = document.getElementById('filterRangeStart');
      const rangeEndInput = document.getElementById('filterRangeEnd');
      const currentRange = joinCommitRange(
        rangeStartInput ? rangeStartInput.value : '',
        rangeEndInput ? rangeEndInput.value : ''
      );
      const parts = splitCommitRange(currentRange);
      const currentStart = String(parts.start || '').trim();
      const currentBase = currentStart.split('~')[0].trim();

      const nextStart = currentBase === mergeParent
        ? increaseTildeDepth(currentStart, 40, mergeParent)
        : increaseTildeDepth(mergeParent, 40, mergeParent);
      const nextEnd = parts.end || 'HEAD';

      if (rangeStartInput) {
        rangeStartInput.value = nextStart;
      }
      if (rangeEndInput) {
        rangeEndInput.value = nextEnd;
      }

      const filter = collectHeaderFilter();
      applyHeaderFilter(
        filter,
        normalizedBranch
          ? 'Loading merge parent and branch ' + normalizedBranch + ': '
          : 'Loading merge parent lineage: '
      );
    }

    function getCurrentRangePartsFromHeader() {
      const rangeStartInput = document.getElementById('filterRangeStart');
      const rangeEndInput = document.getElementById('filterRangeEnd');
      const range = joinCommitRange(
        rangeStartInput ? rangeStartInput.value : '',
        rangeEndInput ? rangeEndInput.value : ''
      );
      return splitCommitRange(range);
    }

    function collectHeaderFilter() {
      const uriInput = document.getElementById('filterUri');
      const sourceSelect = document.getElementById('filterSource');
      const localInput = document.getElementById('filterLocalPath');
      const remoteInput = document.getElementById('filterRemoteUrl');
      const branchesInput = document.getElementById('filterBranches');
      const filesInput = document.getElementById('filterFiles');
      const rangeStartInput = document.getElementById('filterRangeStart');
      const rangeEndInput = document.getElementById('filterRangeEnd');

      const rawSource = sourceSelect ? sourceSelect.value : 'sample';
      const source = rawSource === 'remote' ? 'remote' : rawSource === 'sample' ? 'sample' : 'local';
      const draft = {
        source,
        localPath: localInput ? localInput.value : '',
        remoteUrl: remoteInput ? remoteInput.value : '',
        branches: branchesInput ? branchesInput.value : '',
        files: filesInput ? filesInput.value : '',
        commitRange: joinCommitRange(
          rangeStartInput ? rangeStartInput.value : '',
          rangeEndInput ? rangeEndInput.value : ''
        )
      };
      const computedUri = buildUriFromHeaderState(draft);
      if (uriInput) {
        uriInput.value = computedUri;
      }

      return {
        uri: computedUri,
        source,
        localPath: draft.localPath,
        remoteUrl: draft.remoteUrl,
        branches: parseCsvInput(draft.branches),
        files: parseCsvInput(draft.files),
        commitRange: String(draft.commitRange || '').trim()
      };
    }

    let headerCollapsed = true;

    function renderHeader() {
      const headerElem = document.getElementById('graphHeader');
      if (!headerElem) {
        return;
      }

      const defaultUri = String(initialFilterUri || '').startsWith('gitgraph://')
        ? String(initialFilterUri)
        : 'gitgraph://sample/';
      headerElem.innerHTML = ''
        + '<div id="headerCollapsed">'
        + '  <button id="headerToggle" type="button" title="Toggle filter panel">&#8942;</button>'
        + '  <span id="headerCollapsedStatus"></span>'
        + '</div>'
        + '<div id="headerExpanded" style="display:none">'
        + '  <div id="headerUriRow">'
        + '    <div class="header-field">'
        + '      <label>URI</label>'
        + '      <input id="filterUri" type="text" value="' + escapeHtml(defaultUri) + '" style="width:100%;box-sizing:border-box" />'
        + '    </div>'
        + '  </div>'
        + '  <div id="headerFieldsRow">'
        + '    <div class="header-field">'
        + '      <label>Source</label>'
        + '      <select id="filterSource">'
        + '        <option value="sample">sample</option>'
        + '        <option value="local">local</option>'
        + '        <option value="remote">remote</option>'
        + '      </select>'
        + '    </div>'
        + '    <div class="header-field" id="fieldLocalPath">'
        + '      <label>Local Path</label>'
        + '      <input id="filterLocalPath" type="text" value="workspace" />'
        + '    </div>'
        + '    <div class="header-field" id="fieldRemoteUrl">'
        + '      <label>Remote URL</label>'
        + '      <input id="filterRemoteUrl" type="text" placeholder="https://github.com/owner/repo" style="min-width:240px" />'
        + '    </div>'
        + '    <div class="header-field">'
        + '      <label>Branches</label>'
        + '      <input id="filterBranches" type="text" placeholder="main,develop" />'
        + '    </div>'
        + '    <div class="header-field">'
        + '      <label>Files</label>'
        + '      <input id="filterFiles" type="text" placeholder="src/app.ts" />'
        + '    </div>'
        + '    <div class="header-field header-range">'
        + '      <label>Commit Range</label>'
        + '      <div class="header-range-row">'
        + '        <input id="filterRangeStart" type="text" placeholder="HEAD~20" />'
        + '        <span class="header-range-sep">..</span>'
        + '        <input id="filterRangeEnd" type="text" placeholder="HEAD" />'
        + '      </div>'
        + '    </div>'
        + '    <div class="header-actions">'
        + '      <button id="applyFilter" type="button">Apply</button>'
        + '    </div>'
        + '  </div>'
        + '  <div id="headerStatus"></div>'
        + '</div>';

      const uriInput = document.getElementById('filterUri');
      const sourceSelect = document.getElementById('filterSource');
      const localInput = document.getElementById('filterLocalPath');
      const remoteInput = document.getElementById('filterRemoteUrl');
      const branchesInput = document.getElementById('filterBranches');
      const filesInput = document.getElementById('filterFiles');
      const rangeStartInput = document.getElementById('filterRangeStart');
      const rangeEndInput = document.getElementById('filterRangeEnd');
      const applyButton = document.getElementById('applyFilter');
      const expandedPanel = document.getElementById('headerExpanded');
      const toggleBtn = document.getElementById('headerToggle');
      const collapsedStatus = document.getElementById('headerCollapsedStatus');
      const fieldLocalPath = document.getElementById('fieldLocalPath');
      const fieldRemoteUrl = document.getElementById('fieldRemoteUrl');

      function updateSourceVisibility() {
        const src = sourceSelect ? sourceSelect.value : 'sample';
        if (fieldLocalPath) fieldLocalPath.style.display = src === 'local' ? '' : 'none';
        if (fieldRemoteUrl) fieldRemoteUrl.style.display = src === 'remote' ? '' : 'none';
      }

      const updateUriFromFields = () => {
        const src = sourceSelect ? sourceSelect.value : 'sample';
        const state = {
          source: src,
          localPath: localInput ? localInput.value : '',
          remoteUrl: remoteInput ? remoteInput.value : '',
          branches: branchesInput ? branchesInput.value : '',
          files: filesInput ? filesInput.value : '',
          commitRange: joinCommitRange(
            rangeStartInput ? rangeStartInput.value : '',
            rangeEndInput ? rangeEndInput.value : ''
          )
        };
        if (uriInput) {
          uriInput.value = buildUriFromHeaderState(state);
        }
        updateSourceVisibility();
      };

      const updateFieldsFromUri = () => {
        if (!uriInput) {
          return;
        }
        const state = parseUriToHeaderState(uriInput.value);
        if (sourceSelect) {
          sourceSelect.value = state.source;
        }
        if (localInput) {
          localInput.value = state.localPath;
        }
        if (remoteInput) {
          remoteInput.value = state.remoteUrl;
        }
        if (branchesInput) {
          branchesInput.value = state.branches.join(',');
        }
        if (filesInput) {
          filesInput.value = state.files.join(',');
        }
        const range = splitCommitRange(state.commitRange);
        if (rangeStartInput) {
          rangeStartInput.value = range.start;
        }
        if (rangeEndInput) {
          rangeEndInput.value = range.end;
        }
        updateSourceVisibility();
      };

      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
          headerCollapsed = !headerCollapsed;
          if (expandedPanel) expandedPanel.style.display = headerCollapsed ? 'none' : '';
          toggleBtn.title = headerCollapsed ? 'Expand filter panel' : 'Collapse filter panel';
        });
      }

      if (sourceSelect) {
        sourceSelect.addEventListener('change', updateUriFromFields);
      }
      if (localInput) {
        localInput.addEventListener('input', updateUriFromFields);
      }
      if (remoteInput) {
        remoteInput.addEventListener('input', updateUriFromFields);
      }
      if (branchesInput) {
        branchesInput.addEventListener('input', updateUriFromFields);
      }
      if (filesInput) {
        filesInput.addEventListener('input', updateUriFromFields);
      }
      if (rangeStartInput) {
        rangeStartInput.addEventListener('input', updateUriFromFields);
      }
      if (rangeEndInput) {
        rangeEndInput.addEventListener('input', updateUriFromFields);
      }
      if (uriInput) {
        uriInput.addEventListener('change', updateFieldsFromUri);
      }

      if (applyButton) {
        applyButton.addEventListener('click', () => {
          const filter = collectHeaderFilter();
          applyHeaderFilter(filter, 'Applying: ');
        });
      }

      if (expandedPanel) {
        expandedPanel.style.display = headerCollapsed ? 'none' : '';
      }
      if (toggleBtn) {
        toggleBtn.title = headerCollapsed ? 'Expand filter panel' : 'Collapse filter panel';
      }
      updateFieldsFromUri();
      updateSourceVisibility();
      if (collapsedStatus) {
        collapsedStatus.textContent = defaultUri;
      }
      setHeaderStatus('Configure the filter and click Apply.');
    }

    function getCommitElems() {
      return Array.from(tableElem.querySelectorAll('.commit'));
    }

    function findCommitElemWithId(elems, id) {
      if (id === null) {
        return null;
      }
      const idAsString = String(id);
      for (const elem of elems) {
        if (elem.dataset.id === idAsString) {
          return elem;
        }
      }
      return null;
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    }

    function abbrevCommit(hash) {
      const value = String(hash ?? '');
      return value.length > 10 ? value.substring(0, 10) : value;
    }

    function formatCommitTimestamp(value) {
      const raw = String(value || '').trim();
      if (!raw) {
        return '';
      }

      const date = new Date(raw);
      if (!Number.isFinite(date.getTime())) {
        return raw;
      }

      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    }

    function getBranchLabels(heads, remotes) {
      return {
        heads: Array.isArray(heads)
          ? heads.map((name) => ({ name, remotes: [] }))
          : [],
        remotes: Array.isArray(remotes) ? remotes : []
      };
    }

    let fallbackTooltip = null;
    let fallbackActiveId = null;
    const selectedCommitIndexes = new Set();
    let focusedCommitIndex = null;

    function showError(message) {
      const notice = document.createElement('div');
      notice.className = 'status error';
      notice.textContent = message;
      tableElem.prepend(notice);
    }

    function getBranchHeads(model) {
      // Prefer branch tips inferred from topology: commits that are not a parent of any
      // other visible commit. This avoids depending on input order.
      const parentIds = new Set();
      model.commits.forEach((commit) => {
        commit.parents.forEach((parentId) => parentIds.add(parentId));
      });

      const firstSeenByBranch = new Map();
      model.commits.forEach((commit) => {
        if (!firstSeenByBranch.has(commit.branch)) {
          firstSeenByBranch.set(commit.branch, commit.id);
        }
      });

      const inferredHeads = new Map();
      model.commits.forEach((commit) => {
        if (!parentIds.has(commit.id) && !inferredHeads.has(commit.branch)) {
          inferredHeads.set(commit.branch, commit.id);
        }
      });

      if (inferredHeads.size === 0) {
        return firstSeenByBranch;
      }

      firstSeenByBranch.forEach((id, branch) => {
        if (!inferredHeads.has(branch)) {
          inferredHeads.set(branch, id);
        }
      });

      return inferredHeads;
    }

    function getFallbackCurrentHeadId(model) {
      if (model.head) {
        const match = model.commits.find((c) => c.id === model.head);
        if (match) {
          return match.id;
        }
      }

      const branchHeads = getBranchHeads(model);
      if (branchHeads.has('main')) {
        return branchHeads.get('main');
      }
      if (branchHeads.has('master')) {
        return branchHeads.get('master');
      }

      const orderedIndexes = getFallbackDisplayOrder(model);
      const newestIndex = orderedIndexes[orderedIndexes.length - 1];
      return model.commits[newestIndex]?.id ?? model.commits[0]?.id ?? null;
    }

    function getFallbackDisplayOrder(model) {
      const idToIndex = new Map();
      model.commits.forEach((commit, index) => {
        idToIndex.set(commit.id, index);
      });

      const memo = new Map();
      const visiting = new Set();

      const getDepth = (index) => {
        if (memo.has(index)) {
          return memo.get(index);
        }

        if (visiting.has(index)) {
          return 0;
        }

        visiting.add(index);
        const commit = model.commits[index];
        let depth = 0;

        for (const parentId of commit.parents) {
          const parentIndex = idToIndex.get(parentId);
          if (typeof parentIndex !== 'number') {
            continue;
          }
          depth = Math.max(depth, getDepth(parentIndex) + 1);
        }

        visiting.delete(index);
        memo.set(index, depth);
        return depth;
      };

      const ordered = model.commits.map((_, index) => index);
      ordered.sort((a, b) => {
        const byDepth = getDepth(a) - getDepth(b);
        if (byDepth !== 0) {
          return byDepth;
        }
        return a - b;
      });

      return ordered;
    }

    function closeFallbackTooltip() {
      if (fallbackTooltip) {
        fallbackTooltip.remove();
        fallbackTooltip = null;
      }
    }

    function clearFallbackActiveState() {
      if (fallbackActiveId === null) {
        return;
      }

      const activeCommitElem = findCommitElemWithId(getCommitElems(), fallbackActiveId);
      if (activeCommitElem) {
        activeCommitElem.classList.remove('graphVertexActive');
      }

      const activeCircle = document.querySelector('#commitGraph circle[data-id="' + fallbackActiveId + '"]');
      if (activeCircle) {
        activeCircle.setAttribute('r', activeCircle.classList.contains('current') ? '5.5' : '4');
      }

      fallbackActiveId = null;
    }

    function setFallbackActiveState(id) {
      clearFallbackActiveState();
      fallbackActiveId = id;

      const commitElem = findCommitElemWithId(getCommitElems(), id);
      if (commitElem) {
        commitElem.classList.add('graphVertexActive');
      }

      const circle = document.querySelector('#commitGraph circle[data-id="' + id + '"]');
      if (circle) {
        circle.setAttribute('r', circle.classList.contains('current') ? '6.5' : '5');
      }
    }

    function showFallbackTooltip(commit, node, headNames) {
      closeFallbackTooltip();

      const color = COLORS[(node.branchColorIndex ?? 0) % COLORS.length];
      const anchor = document.createElement('div');
      const pointer = document.createElement('div');
      const content = document.createElement('div');
      const shadow = document.createElement('div');
      const parents = commit.parents.length > 0
        ? commit.parents.map((parentId) => '<span class="graphTooltipRef">' + escapeHtml(abbrevCommit(parentId)) + '</span>').join('')
        : '<span class="graphTooltipRef">root</span>';
      const heads = headNames.length > 0
        ? headNames.map((name) => '<span class="graphTooltipRef">' + escapeHtml(name) + '</span>').join('')
        : '';
      const commitType = commit.parents.length > 1
        ? 'merge'
        : commit.parents.length === 0
          ? 'root'
          : 'commit';
      const commitBranches = Array.from(new Set(
        [commit.branch].concat(Array.isArray(commit.branches) ? commit.branches : [])
      ));
      const branchesInfo = commitBranches
        .map((name) => '<span class="graphTooltipRef">' + escapeHtml(name) + '</span>')
        .join('');
      const secondParentBranches = Array.isArray(commit.secondParentBranches)
        ? commit.secondParentBranches
        : [];
      const secondParentDetails = commitType !== 'merge'
        ? ''
        : (() => {
            const secondParentId = String(commit.secondParentId || '').trim();
            if (!secondParentId) {
              return '<div class="graphTooltipSection">Second parent: <span class="graphTooltipRef">unknown</span></div>';
            }

            const kind = commit.secondParentKind === 'branch' ? 'branch-backed' : 'detached';
            const branchRefs = secondParentBranches.length > 0
              ? secondParentBranches.map((name) => '<span class="graphTooltipRef">' + escapeHtml(name) + '</span>').join('')
              : '<span class="graphTooltipRef">none</span>';
            return '<div class="graphTooltipSection">Second parent: '
              + '<span class="graphTooltipRef">' + escapeHtml(secondParentId) + '</span>'
              + '<span class="graphTooltipCombinedRef">' + escapeHtml(kind) + '</span>'
              + '</div>'
              + '<div class="graphTooltipSection">Likely source branches: ' + branchRefs + '</div>';
          })();

      anchor.setAttribute('id', 'graphTooltip');
      pointer.setAttribute('id', 'graphTooltipPointer');
      pointer.style.backgroundColor = color;
      content.setAttribute('id', 'graphTooltipContent');
      content.style.borderColor = color;
      content.innerHTML = [
        '<div class="graphTooltipTitle">Commit ' + escapeHtml(abbrevCommit(commit.id)) + '</div>',
        '<div class="graphTooltipSection">Type: <span class="graphTooltipRef">' + escapeHtml(commitType) + '</span></div>',
        '<div class="graphTooltipSection">Branch: <span class="graphTooltipRef">' + escapeHtml(commit.branch) + '</span></div>',
        branchesInfo ? '<div class="graphTooltipSection">Branches: ' + branchesInfo + '</div>' : '',
        headNames.length > 0 ? '<div class="graphTooltipSection">Heads: ' + heads + '</div>' : '',
        '<div class="graphTooltipSection">Parents: ' + parents + '</div>',
        secondParentDetails
      ].filter(Boolean).join('');
      shadow.setAttribute('id', 'graphTooltipShadow');

      anchor.appendChild(shadow);
      anchor.appendChild(pointer);
      anchor.appendChild(content);
      viewElem.appendChild(anchor);
      fallbackTooltip = anchor;

      const viewWidth = Math.max(240, viewElem.clientWidth);
      const scrollTop = Number(viewElem.scrollTop || 0);
      const minTop = scrollTop + 4;
      const maxTop = scrollTop + Math.max(32, viewElem.clientHeight - 72);
      const top = Math.max(minTop, Math.min(node.y - 28, maxTop));
      const left = graphColumnElem.offsetLeft + node.x;
      anchor.style.left = left + 'px';
      anchor.style.top = top + 'px';
      content.style.maxWidth = Math.max(180, Math.min(viewWidth - left - 35, 520)) + 'px';

      const tooltipRect = content.getBoundingClientRect();
      const pointerTop = Math.max(6, Math.min(node.y - top, tooltipRect.height - 6));
      pointer.style.top = pointerTop + 'px';
      shadow.style.width = tooltipRect.width + 'px';
      shadow.style.height = tooltipRect.height + 'px';
    }

    function buildFallbackLayout(model, config, rowCenterByCommitId) {
      const occupiedBranches = new Set(model.commits.map((commit) => commit.branch));
      const orderedOccupiedBranches = model.branches.filter((name) => occupiedBranches.has(name));
      const branchLaneIndex = new Map();
      orderedOccupiedBranches.forEach((name, index) => branchLaneIndex.set(name, index));

      // If a commit references a branch not listed in model.branches, append it deterministically.
      model.commits.forEach((commit) => {
        if (!branchLaneIndex.has(commit.branch)) {
          branchLaneIndex.set(commit.branch, branchLaneIndex.size);
        }
      });

      const branchHeads = getBranchHeads(model);
      const currentHeadId = getFallbackCurrentHeadId(model);
      // Match the advanced renderer's spacing model: lane/row distance come directly from config.
      const lane = Math.max(10, Number(config?.branchLaneDistance ?? 50));
      const stepY = Math.max(10, Number(config?.commitVerticalDistance ?? 44));
      const offsetX = 36;
      const offsetY = 24;
      const commitsById = new Map();
      const orderedIndexes = getFallbackDisplayOrder(model);

      orderedIndexes.forEach((index, orderedPos) => {
        const displayIndex = orderedIndexes.length - 1 - orderedPos;
        const commit = model.commits[index];
        const measuredY = rowCenterByCommitId ? rowCenterByCommitId.get(commit.id) : undefined;
        const headNames = [];
        branchHeads.forEach((headId, branchName) => {
          if (headId === commit.id) {
            headNames.push(branchName);
          }
        });

        commitsById.set(commit.id, {
          ...commit,
          index,
          x: offsetX + (branchLaneIndex.get(commit.branch) ?? 0) * lane,
          y: typeof measuredY === 'number' ? measuredY : offsetY + displayIndex * stepY,
          headNames,
          isCurrent: commit.id === currentHeadId,
          branchColorIndex: branchLaneIndex.get(commit.branch) ?? 0
        });
      });

      let maxY = 0;
      let maxX = 0;
      commitsById.forEach((node) => {
        maxY = Math.max(maxY, node.y);
        maxX = Math.max(maxX, node.x);
      });

      return {
        lane,
        stepY,
        offsetX,
        offsetY,
        width: Math.max(96, maxX + 28),
        height: Math.max(180, maxY + 28),
        commitsById,
        orderedIndexes
      };
    }

    function measureCommitRowCentersByCommitId(model) {
      const centers = new Map();
      const graphRect = graphColumnElem.getBoundingClientRect();
      const rows = getCommitElems();

      rows.forEach((row) => {
        const index = Number(row.dataset.id);
        if (!Number.isInteger(index) || index < 0 || index >= model.commits.length) {
          return;
        }

        const commit = model.commits[index];
        const rowRect = row.getBoundingClientRect();
        const centerY = (rowRect.top + rowRect.height / 2) - graphRect.top;
        centers.set(commit.id, centerY);
      });

      return centers;
    }

    function applySelectionState() {
      const rows = getCommitElems();
      rows.forEach((row) => {
        const idValue = Number(row.dataset.id);
        row.classList.toggle('selected', Number.isInteger(idValue) && selectedCommitIndexes.has(idValue));
      });
    }

    function getSelectionStrokeColor() {
      const style = getComputedStyle(document.documentElement);
      const warningColor = style.getPropertyValue('--vscode-editorWarning-foreground').trim();
      if (warningColor) {
        return warningColor;
      }

      const contrastColor = style.getPropertyValue('--vscode-contrastActiveBorder').trim();
      if (contrastColor) {
        return contrastColor;
      }

      return '#d97706';
    }

    function applySelectedCircleStyle(circle, isSelected) {
      const isCurrent = circle.dataset.current === 'true';
      const branchColor = circle.dataset.branchColor || '#1a73e8';
      const baseStrokeWidth = Number(circle.dataset.baseStrokeWidth || '2.2');

      if (!isSelected) {
        circle.removeAttribute('stroke-dasharray');
        if (isCurrent) {
          circle.setAttribute('fill', 'var(--vscode-editor-background)');
          circle.setAttribute('stroke', branchColor);
          circle.setAttribute('stroke-width', String(Math.max(2, baseStrokeWidth)));
        } else {
          circle.setAttribute('fill', branchColor);
          circle.removeAttribute('stroke');
          circle.removeAttribute('stroke-width');
        }
        return;
      }

      const selectionStroke = getSelectionStrokeColor();
      circle.setAttribute('stroke', selectionStroke);
      circle.setAttribute('stroke-width', isCurrent ? '3.2' : '2.8');
      circle.setAttribute('stroke-dasharray', '3 2');
      if (!isCurrent) {
        circle.setAttribute('fill', 'var(--vscode-editor-background)');
      }
    }

    function renderSelectionDecorations(model, layout) {
      const svg = document.querySelector('#commitGraph svg');
      if (!svg) {
        return;
      }

      const oldLayer = svg.querySelector('g.selection-decorators');
      if (oldLayer) {
        oldLayer.remove();
      }

      if (!model || !layout || selectedCommitIndexes.size === 0) {
        return;
      }

      const nodes = [];
      selectedCommitIndexes.forEach((index) => {
        if (!Number.isInteger(index) || index < 0 || index >= model.commits.length) {
          return;
        }

        const commitId = model.commits[index]?.id;
        if (!commitId) {
          return;
        }

        const node = layout.commitsById.get(commitId);
        if (!node) {
          return;
        }

        nodes.push(node);
      });

      if (nodes.length === 0) {
        return;
      }

      const layer = document.createElementNS(SVG_NAMESPACE, 'g');
      layer.setAttribute('class', 'selection-decorators');
      const selectionStroke = getSelectionStrokeColor();

      const groupsByX = new Map();
      nodes.forEach((node) => {
        const key = String(node.x);
        if (!groupsByX.has(key)) {
          groupsByX.set(key, []);
        }
        groupsByX.get(key).push(node);
      });

      const contiguousGap = Math.max(8, Number(layout.stepY || 44) * 0.75);
      groupsByX.forEach((groupNodes) => {
        const sortedByY = groupNodes.slice().sort((a, b) => a.y - b.y);
        let currentRun = [];

        const flushRun = () => {
          if (currentRun.length === 0) {
            return;
          }

          if (currentRun.length === 1) {
            const node = currentRun[0];
            const ring = document.createElementNS(SVG_NAMESPACE, 'circle');
            ring.setAttribute('cx', String(node.x));
            ring.setAttribute('cy', String(node.y));
            ring.setAttribute('r', String(node.isCurrent ? 11.5 : 10));
            ring.setAttribute('fill', selectionStroke);
            ring.setAttribute('fill-opacity', '0.14');
            ring.setAttribute('stroke', selectionStroke);
            ring.setAttribute('stroke-width', '2.4');
            ring.setAttribute('stroke-dasharray', '3 3');
            layer.appendChild(ring);
            currentRun = [];
            return;
          }

          const x = currentRun[0].x;
          const top = currentRun[0].y;
          const bottom = currentRun[currentRun.length - 1].y;
          const rect = document.createElementNS(SVG_NAMESPACE, 'rect');
          rect.setAttribute('x', String(x - 10));
          rect.setAttribute('y', String(top - 10));
          rect.setAttribute('width', '20');
          rect.setAttribute('height', String(Math.max(20, (bottom - top) + 20)));
          rect.setAttribute('rx', '10');
          rect.setAttribute('ry', '10');
          rect.setAttribute('fill', selectionStroke);
          rect.setAttribute('fill-opacity', '0.14');
          rect.setAttribute('stroke', selectionStroke);
          rect.setAttribute('stroke-width', '2.4');
          rect.setAttribute('stroke-dasharray', '4 3');
          layer.appendChild(rect);
          currentRun = [];
        };

        sortedByY.forEach((node) => {
          if (currentRun.length === 0) {
            currentRun.push(node);
            return;
          }

          const prev = currentRun[currentRun.length - 1];
          if ((node.y - prev.y) <= contiguousGap) {
            currentRun.push(node);
            return;
          }

          flushRun();
          currentRun.push(node);
        });

        flushRun();
      });

      svg.appendChild(layer);
    }

    function setCommitSelection(model, index, multiSelect) {
      if (!Number.isInteger(index) || index < 0 || index >= model.commits.length) {
        return;
      }

      if (!multiSelect) {
        selectedCommitIndexes.clear();
        selectedCommitIndexes.add(index);
      } else if (selectedCommitIndexes.has(index)) {
        selectedCommitIndexes.delete(index);
      } else {
        selectedCommitIndexes.add(index);
      }

      applySelectionState();
      focusedCommitIndex = index;
      syncCommitRowTabStops();
    }

    function getSelectedCommitIds(model) {
      return Array.from(selectedCommitIndexes)
        .sort((a, b) => a - b)
        .map((index) => model.commits[index]?.id)
        .filter((id) => typeof id === 'string');
    }

    function getCommitRowByIndex(index) {
      return tableElem.querySelector('.commit[data-id="' + String(index) + '"]');
    }

    function syncCommitRowTabStops() {
      const rows = getCommitElems();
      const selectedIndexes = Array.from(selectedCommitIndexes).sort((a, b) => a - b);
      const fallbackIndex = selectedIndexes.length > 0
        ? selectedIndexes[0]
        : (() => {
            const firstRow = rows[0];
            if (!firstRow) {
              return null;
            }
            const firstId = Number(firstRow.dataset.id);
            return Number.isInteger(firstId) ? firstId : null;
          })();
      const activeIndex = focusedCommitIndex !== null ? focusedCommitIndex : fallbackIndex;

      rows.forEach((row) => {
        const idValue = Number(row.dataset.id);
        const isActive = Number.isInteger(idValue) && idValue === activeIndex;
        row.tabIndex = isActive ? 0 : -1;
        row.setAttribute('aria-selected', selectedCommitIndexes.has(idValue) ? 'true' : 'false');
      });
    }

    function focusCommitRow(index, options) {
      const settings = options || {};
      if (!Number.isInteger(index)) {
        return;
      }

      const row = getCommitRowByIndex(index);
      if (!row) {
        return;
      }

      focusedCommitIndex = index;
      syncCommitRowTabStops();
      row.focus({ preventScroll: Boolean(settings.preventScroll) });
      if (!settings.preventReveal) {
        row.scrollIntoView({ block: 'nearest' });
      }
    }

    function moveFocusOnly(model, index, delta) {
      const rows = getCommitElems();
      const currentRow = getCommitRowByIndex(index);
      const currentPosition = currentRow ? rows.indexOf(currentRow) : -1;
      if (currentPosition < 0) {
        return;
      }

      const nextPosition = Math.max(0, Math.min(rows.length - 1, currentPosition + delta));
      const nextRow = rows[nextPosition];
      if (!nextRow) {
        return;
      }

      const nextIndex = Number(nextRow.dataset.id);
      if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= model.commits.length) {
        return;
      }

      focusCommitRow(nextIndex);
    }

    function expandSelectionAndMoveFocus(model, index, delta) {
      const rows = getCommitElems();
      const currentRow = getCommitRowByIndex(index);
      const currentPosition = currentRow ? rows.indexOf(currentRow) : -1;
      if (currentPosition < 0) {
        return;
      }

      const nextPosition = Math.max(0, Math.min(rows.length - 1, currentPosition + delta));
      const nextRow = rows[nextPosition];
      if (!nextRow) {
        return;
      }

      const nextIndex = Number(nextRow.dataset.id);
      if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= model.commits.length) {
        return;
      }

      if (selectedCommitIndexes.has(nextIndex)) {
        selectedCommitIndexes.delete(nextIndex);
      } else {
        selectedCommitIndexes.add(nextIndex);
      }
      applySelectionState();
      focusCommitRow(nextIndex);
    }

    function focusCommitBoundary(model, boundary) {
      const rows = getCommitElems();
      const row = boundary === 'start' ? rows[0] : rows[rows.length - 1];
      if (!row) {
        return;
      }

      const index = Number(row.dataset.id);
      if (!Number.isInteger(index) || index < 0 || index >= model.commits.length) {
        return;
      }

      focusCommitRow(index);
    }

    function invokeCommit(model, index) {
      const commit = model.commits[index];
      if (!commit) {
        return;
      }

      setCommitSelection(model, index, false);
      focusCommitRow(index, { preventReveal: true });
      vscode.postMessage({
        type: 'commit-click',
        commitId: commit.id,
        branch: commit.branch
      });
    }

    function openCommitContextMenu(model, index, preserveMultiSelect) {
      const commit = model.commits[index];
      if (!commit) {
        return;
      }

      setCommitSelection(model, index, Boolean(preserveMultiSelect));
      focusCommitRow(index, { preventReveal: true });
      vscode.postMessage({
        type: 'commit-context-menu',
        commitId: commit.id,
        branch: commit.branch,
        selectedCommitIds: getSelectedCommitIds(model)
      });
    }

    function createCurvePath(parent, child) {
      if (parent.x === child.x) {
        return 'M' + parent.x + ',' + parent.y + ' L' + child.x + ',' + child.y;
      }

      const deltaY = child.y - parent.y;
      const direction = deltaY >= 0 ? 1 : -1;
      const bend = Math.max(16, Math.abs(deltaY) * 0.45);
      return 'M' + parent.x + ',' + parent.y
        + ' C' + parent.x + ',' + (parent.y + direction * bend)
        + ' ' + child.x + ',' + (child.y - direction * bend)
        + ' ' + child.x + ',' + child.y;
    }

    function renderHiddenEdgeMarkers(model, layout, svg, strokeWidth) {
      const markerOffset = Math.max(14, Number(layout?.stepY || 44) * 0.38);
      const minY = 10;
      const maxY = Math.max(minY + 4, Number(layout?.height || 180) - 10);

      const appendMarker = (commit, node, direction, hiddenCount) => {
        if (!hiddenCount || hiddenCount < 1) {
          return;
        }

        const isParentDirection = direction === 'parents';
        const markerY = isParentDirection
          ? Math.min(maxY, node.y + markerOffset)
          : Math.max(minY, node.y - markerOffset);
        const color = COLORS[node.branchColorIndex % COLORS.length];
        const sw = Math.max(1.5, Number(strokeWidth || 2.2));

        const line = document.createElementNS(SVG_NAMESPACE, 'path');
        line.setAttribute('class', 'hidden-edge-connector');
        line.setAttribute('d', 'M' + node.x + ',' + node.y + ' L' + node.x + ',' + markerY);
        svg.appendChild(line);

        const r = 6.1;   // 5.5 * 1.1 — 10% bigger than HEAD circle
        const halfPlus = r * 0.45;
        const thinSw = sw * 0.5;

        // Circle styled exactly like a HEAD commit node but dashed and thinner stroke.
        const nodeCircle = document.createElementNS(SVG_NAMESPACE, 'circle');
        nodeCircle.setAttribute('class', 'hidden-node-circle');
        nodeCircle.setAttribute('cx', String(node.x));
        nodeCircle.setAttribute('cy', String(markerY));
        nodeCircle.setAttribute('r', String(r));
        nodeCircle.style.stroke = color;
        nodeCircle.style.strokeWidth = String(thinSw);
        svg.appendChild(nodeCircle);

        // + drawn as two SVG path segments so it is always pixel-perfect centered.
        const plusPath = document.createElementNS(SVG_NAMESPACE, 'path');
        plusPath.setAttribute('class', 'hidden-node-plus');
        plusPath.setAttribute(
          'd',
          'M' + (node.x - halfPlus) + ',' + markerY
          + ' H' + (node.x + halfPlus)
          + ' M' + node.x + ',' + (markerY - halfPlus)
          + ' V' + (markerY + halfPlus)
        );
        plusPath.style.stroke = color;
        plusPath.style.strokeWidth = String(thinSw);
        svg.appendChild(plusPath);

        // Transparent larger hit-target for easier clicking.
        const hitTarget = document.createElementNS(SVG_NAMESPACE, 'circle');
        hitTarget.setAttribute('class', 'hidden-node-hittarget');
        hitTarget.setAttribute('cx', String(node.x));
        hitTarget.setAttribute('cy', String(markerY));
        hitTarget.setAttribute('r', String(r + 4));
        hitTarget.setAttribute(
          'title',
          (isParentDirection ? 'Load older commits' : 'Load newer commits') + ' (+' + String(hiddenCount) + ')'
        );
        hitTarget.addEventListener('click', (event) => {
          event.stopPropagation();
          if (hitTarget.classList.contains('loading')) {
            return;
          }

          hitTarget.classList.add('loading');
          nodeCircle.classList.add('loading');
          plusPath.classList.add('loading');

          // If refresh never returns, restore marker state to avoid a stuck spinner.
          setTimeout(() => {
            hitTarget.classList.remove('loading');
            nodeCircle.classList.remove('loading');
            plusPath.classList.remove('loading');
          }, 15000);

          requestHiddenEdgeExpansion(direction, commit.id);
        });
        svg.appendChild(hitTarget);
      };

      const entries = model.commits
        .map((commit) => ({ commit, node: layout.commitsById.get(commit.id) }))
        .filter((entry) => Boolean(entry.node));
      if (entries.length === 0) {
        return;
      }

      const topEntry = entries.reduce((best, current) => (current.node.y < best.node.y ? current : best), entries[0]);
      const bottomEntry = entries.reduce((best, current) => (current.node.y > best.node.y ? current : best), entries[0]);

      const totalHiddenParents = entries
        .reduce((sum, entry) => sum + Number(entry.commit.hiddenParentCount || 0), 0);
      const totalHiddenChildren = entries
        .reduce((sum, entry) => sum + Number(entry.commit.hiddenChildCount || 0), 0);

      const showParentsMarker = totalHiddenParents > 0;
      const showChildrenMarker = totalHiddenChildren > 0;

      if (showParentsMarker) {
        appendMarker(bottomEntry.commit, bottomEntry.node, 'parents', Math.max(1, totalHiddenParents));
      }

      if (showChildrenMarker) {
        appendMarker(topEntry.commit, topEntry.node, 'children', Math.max(1, totalHiddenChildren));
      }
    }

    function renderHiddenMergeBranchMarkers(model, layout, svg, strokeWidth) {
      const lane = Math.max(20, Number(layout?.lane || 48));
      const markerOffsetX = Math.max(18, lane * 0.45);
      const sw = Math.max(1.5, Number(strokeWidth || 2.2));
      const r = 6.1;
      const halfPlus = r * 0.45;
      const thinSw = sw * 0.5;
      const commitsById = new Map(model.commits.map((commit) => [commit.id, commit]));

      const entries = model.commits
        .map((commit) => ({ commit, node: layout.commitsById.get(commit.id) }))
        .filter((entry) => Boolean(entry.node));

      entries.forEach((entry) => {
        const hiddenBranches = Array.isArray(entry.commit.hiddenMergeBranches)
          ? entry.commit.hiddenMergeBranches
          : [];
        const secondParentId = Array.isArray(entry.commit.parents) && entry.commit.parents.length > 1
          ? entry.commit.parents[1]
          : '';
        const secondParentCommit = secondParentId ? commitsById.get(secondParentId) : undefined;
        const secondParentHasHiddenAncestors = Boolean(secondParentCommit)
          && Number(secondParentCommit.hiddenParentCount || 0) > 0;
        const hasHiddenSecondParent = typeof entry.commit.hiddenMergeParentId === 'string'
          && entry.commit.hiddenMergeParentId.length > 0;
        if (hiddenBranches.length === 0 && !hasHiddenSecondParent && !secondParentHasHiddenAncestors) {
          return;
        }

        const targetBranch = hiddenBranches[0];
        const mergeParentId = hasHiddenSecondParent
          ? entry.commit.hiddenMergeParentId
          : secondParentId;
        const node = entry.node;
        const markerX = node.x + markerOffsetX;
        const markerY = node.y;
        const color = COLORS[node.branchColorIndex % COLORS.length];

        const line = document.createElementNS(SVG_NAMESPACE, 'path');
        line.setAttribute('class', 'hidden-edge-connector');
        line.setAttribute('d', 'M' + node.x + ',' + node.y + ' L' + markerX + ',' + markerY);
        svg.appendChild(line);

        const nodeCircle = document.createElementNS(SVG_NAMESPACE, 'circle');
        nodeCircle.setAttribute('class', 'hidden-node-circle');
        nodeCircle.setAttribute('cx', String(markerX));
        nodeCircle.setAttribute('cy', String(markerY));
        nodeCircle.setAttribute('r', String(r));
        nodeCircle.style.stroke = color;
        nodeCircle.style.strokeWidth = String(thinSw);
        svg.appendChild(nodeCircle);

        const plusPath = document.createElementNS(SVG_NAMESPACE, 'path');
        plusPath.setAttribute('class', 'hidden-node-plus');
        plusPath.setAttribute(
          'd',
          'M' + (markerX - halfPlus) + ',' + markerY
          + ' H' + (markerX + halfPlus)
          + ' M' + markerX + ',' + (markerY - halfPlus)
          + ' V' + (markerY + halfPlus)
        );
        plusPath.style.stroke = color;
        plusPath.style.strokeWidth = String(thinSw);
        svg.appendChild(plusPath);

        const hitTarget = document.createElementNS(SVG_NAMESPACE, 'circle');
        hitTarget.setAttribute('class', 'hidden-node-hittarget');
        hitTarget.setAttribute('cx', String(markerX));
        hitTarget.setAttribute('cy', String(markerY));
        hitTarget.setAttribute('r', String(r + 4));
        hitTarget.setAttribute(
          'title',
          targetBranch
            ? (
              'Load merge source branch ' + targetBranch
              + (hiddenBranches.length > 1 ? ' (+' + String(hiddenBranches.length - 1) + ' more)' : '')
            )
            : 'Load merged-in parent history'
        );
        hitTarget.addEventListener('click', (event) => {
          event.stopPropagation();
          if (hitTarget.classList.contains('loading')) {
            return;
          }

          hitTarget.classList.add('loading');
          nodeCircle.classList.add('loading');
          plusPath.classList.add('loading');

          setTimeout(() => {
            hitTarget.classList.remove('loading');
            nodeCircle.classList.remove('loading');
            plusPath.classList.remove('loading');
          }, 15000);

          requestMergeParentExpansion(mergeParentId, targetBranch);
        });
        svg.appendChild(hitTarget);
      });
    }

    function wireFallbackInteractions(model, layout) {
      const circles = Array.from(document.querySelectorAll('#commitGraph circle[data-id]'));

      const activate = (id) => {
        const commit = model.commits[id];
        if (!commit) {
          return;
        }

        const node = layout.commitsById.get(commit.id);
        if (!node) {
          return;
        }

        setFallbackActiveState(id);
        showFallbackTooltip(commit, node, node.headNames);
      };

      const deactivate = () => {
        clearFallbackActiveState();
        closeFallbackTooltip();
      };

      circles.forEach((circle) => {
        const idValue = Number(circle.dataset.id);
        if (!Number.isInteger(idValue)) {
          return;
        }

        circle.addEventListener('mouseenter', () => activate(idValue));
        circle.addEventListener('mouseleave', deactivate);
      });
    }

    function drawSimpleGraph(model, config, rowCenterByCommitId) {
      closeFallbackTooltip();
      clearFallbackActiveState();

      const old = document.querySelector('#commitGraph svg');
      if (old) {
        old.remove();
      }

      const layout = buildFallbackLayout(model, config, rowCenterByCommitId);
      currentFallbackLayout = layout;
      const hasMergeBranchMarkers = model.commits.some((commit) => {
        const hiddenBranches = Array.isArray(commit.hiddenMergeBranches) ? commit.hiddenMergeBranches : [];
        return hiddenBranches.length > 0 || Boolean(commit.hiddenMergeParentId);
      });
      const mergeMarkerPadding = hasMergeBranchMarkers
        ? Math.max(18, Number(layout?.lane || 48) * 0.5 + 8)
        : 0;
      const width = layout.width + mergeMarkerPadding;
      const height = layout.height;
      const strokeWidth = Math.max(1.5, Number(config?.strokeWidth ?? 2.2));
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

      for (const commit of model.commits) {
        const node = layout.commitsById.get(commit.id);
        if (!node) {
          continue;
        }

        for (const parentId of commit.parents) {
          const parent = layout.commitsById.get(parentId);
          if (!parent) {
            continue;
          }

          const pathData = createCurvePath(parent, node);
          const shadow = document.createElementNS(SVG_NAMESPACE, 'path');
          shadow.setAttribute('class', 'shadow');
          shadow.setAttribute('d', pathData);
          shadow.setAttribute('stroke-width', String(strokeWidth + 2));
          svg.appendChild(shadow);

          const line = document.createElementNS(SVG_NAMESPACE, 'path');
          line.setAttribute('class', 'line');
          line.setAttribute('d', pathData);
          line.setAttribute('stroke', COLORS[node.branchColorIndex % COLORS.length]);
          line.setAttribute('stroke-width', String(strokeWidth));
          svg.appendChild(line);
        }
      }

      for (const commit of model.commits) {
        const node = layout.commitsById.get(commit.id);
        if (!node) {
          continue;
        }

        const isMerge = Array.isArray(commit.parents) && commit.parents.length > 1;
        const isDetachedMerge = isMerge && commit.secondParentKind === 'detached';
        const branchColor = COLORS[node.branchColorIndex % COLORS.length];

        const circle = document.createElementNS(SVG_NAMESPACE, 'circle');
        circle.dataset.id = String(node.index);
        circle.dataset.current = String(node.isCurrent);
        circle.dataset.branchColor = branchColor;
        circle.dataset.baseStrokeWidth = String(strokeWidth);
        circle.setAttribute('cx', String(node.x));
        circle.setAttribute('cy', String(node.y));
        circle.setAttribute('r', node.isCurrent ? '5.5' : isMerge ? '4.8' : '4');
        if (isMerge) {
          circle.dataset.merge = 'true';
        }
        if (node.isCurrent) {
          circle.setAttribute('class', isMerge ? ('current merge' + (isDetachedMerge ? ' detached-merge' : '')) : 'current');
          circle.setAttribute('fill', 'var(--vscode-editor-background)');
          circle.setAttribute('stroke', branchColor);
          circle.setAttribute('stroke-width', String(strokeWidth));
        } else if (isMerge) {
          circle.setAttribute('class', isDetachedMerge ? 'merge detached-merge' : 'merge');
          circle.setAttribute('fill', 'var(--vscode-editor-background)');
          circle.style.stroke = branchColor;
          circle.style.strokeWidth = String(Math.max(2.2, strokeWidth));
          circle.style.strokeOpacity = '1';
        } else {
          circle.setAttribute('fill', branchColor);
        }
        circle.addEventListener('click', (event) => {
          const multiSelect = event.ctrlKey || event.metaKey;
          setCommitSelection(model, node.index, multiSelect);
          vscode.postMessage({
            type: 'commit-click',
            commitId: commit.id,
            branch: commit.branch
          });
        });
        svg.appendChild(circle);

        if (isMerge) {
          if (isDetachedMerge) {
            const innerSquare = document.createElementNS(SVG_NAMESPACE, 'rect');
            const size = node.isCurrent ? 3.6 : 3.2;
            innerSquare.setAttribute('class', 'detachedMergeInner');
            innerSquare.setAttribute('x', String(node.x - size / 2));
            innerSquare.setAttribute('y', String(node.y - size / 2));
            innerSquare.setAttribute('width', String(size));
            innerSquare.setAttribute('height', String(size));
            innerSquare.setAttribute('rx', '0.8');
            innerSquare.setAttribute('ry', '0.8');
            innerSquare.setAttribute('fill', branchColor);
            svg.appendChild(innerSquare);
          } else {
            const innerDot = document.createElementNS(SVG_NAMESPACE, 'circle');
            innerDot.setAttribute('class', 'mergeInner');
            innerDot.setAttribute('cx', String(node.x));
            innerDot.setAttribute('cy', String(node.y));
            innerDot.setAttribute('r', node.isCurrent ? '1.8' : '1.6');
            innerDot.setAttribute('fill', branchColor);
            svg.appendChild(innerDot);
          }
        }
      }

      renderHiddenEdgeMarkers(model, layout, svg, strokeWidth);
      renderHiddenMergeBranchMarkers(model, layout, svg, strokeWidth);

      document.getElementById('commitGraph')?.appendChild(svg);
      const contentHeight = Math.max(height + 12, Number(tableElem.scrollHeight || 0));
      graphColumnElem.style.height = Math.max(180, contentHeight) + 'px';
      graphColumnElem.style.width = Math.max(96, width + 12) + 'px';
      wireFallbackInteractions(model, layout);
    }

    function buildRuntimeCommits(model) {
      const branchHeads = new Map();
      for (const commit of model.commits) {
        branchHeads.set(commit.branch, commit.id);
      }

      return model.commits.map((commit) => {
        const heads = [];
        for (const [branch, headHash] of branchHeads.entries()) {
          if (headHash === commit.id) {
            heads.push(branch);
          }
        }

        return {
          hash: commit.id,
          parents: commit.parents,
          heads,
          tags: [],
          remotes: [],
          stash: null
        };
      });
    }

    function renderCommitTable(model) {
      tableElem.replaceChildren();
      tableElem.setAttribute('role', 'listbox');
      tableElem.setAttribute('aria-label', 'Commit list');
      tableElem.setAttribute('aria-multiselectable', 'true');

      const branchHeads = getBranchHeads(model);
      const orderedIndexes = getFallbackDisplayOrder(model);

      for (let pos = orderedIndexes.length - 1; pos >= 0; pos -= 1) {
        const index = orderedIndexes[pos];
        const commit = model.commits[index];
        const row = document.createElement('div');
        row.className = 'commit';
        row.dataset.id = String(index);
        row.tabIndex = -1;
        row.setAttribute('role', 'option');

        const id = document.createElement('div');
        id.className = 'commit-id';
        id.textContent = commit.id;

        const committedAt = document.createElement('div');
        committedAt.className = 'commit-time';
        const formattedCommittedAt = formatCommitTimestamp(commit.committedAt);
        committedAt.textContent = formattedCommittedAt || '-';
        if (formattedCommittedAt && commit.committedAt) {
          committedAt.title = String(commit.committedAt);
        }

        const branch = document.createElement('div');
        branch.className = 'commit-branch';
        branch.textContent = commit.branch;

        const message = document.createElement('div');
        message.className = 'commit-message';
        message.textContent = String(commit.message || '');

        row.appendChild(id);
        row.appendChild(committedAt);
        row.appendChild(branch);

        const allCommitBranches = Array.isArray(commit.branches) ? commit.branches : [];
        const extraBranches = allCommitBranches.filter((branchName) => branchName !== commit.branch);
        const maxExtraBranches = 4;
        for (const branchName of extraBranches.slice(0, maxExtraBranches)) {
          const extraBranch = document.createElement('button');
          extraBranch.type = 'button';
          extraBranch.className = 'commit-branch commit-branch-extra';
          extraBranch.textContent = branchName;
          extraBranch.title = 'Add branch "' + branchName + '" to graph filter';
          extraBranch.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            requestAddBranchToFilter(branchName);
          });
          row.appendChild(extraBranch);
        }

        if (extraBranches.length > maxExtraBranches) {
          const more = document.createElement('div');
          more.className = 'commit-branch';
          more.textContent = '+' + String(extraBranches.length - maxExtraBranches);
          more.title = String(extraBranches.length - maxExtraBranches) + ' additional branches contain this commit';
          row.appendChild(more);
        }

        const tags = Array.isArray(commit.tags) ? commit.tags : [];
        for (const tagName of tags) {
          const tag = document.createElement('div');
          tag.className = 'commit-tag';
          tag.textContent = tagName;
          row.appendChild(tag);
        }

        if (Array.isArray(commit.parents) && commit.parents.length > 1) {
          const mergePill = document.createElement('div');
          mergePill.className = 'commit-merge';
          mergePill.textContent = 'merge';
          row.appendChild(mergePill);

          if (commit.secondParentKind === 'detached') {
            const detachedPill = document.createElement('div');
            detachedPill.className = 'commit-merge-detached';
            detachedPill.textContent = 'detached';
            detachedPill.title = 'Merged from lineage with no surviving branch ref';
            row.appendChild(detachedPill);
          }
        }

        row.appendChild(message);

        branchHeads.forEach((headId, branchName) => {
          if (headId !== commit.id) {
            return;
          }

          const head = document.createElement('div');
          head.className = 'commit-head';
          head.textContent = branchName === 'main' ? 'HEAD' : 'HEAD ' + branchName;
          row.appendChild(head);
        });

        const menuButton = document.createElement('button');
        menuButton.type = 'button';
        menuButton.className = 'commit-menu-btn';
        menuButton.title = 'Commit actions';
        menuButton.textContent = '...';
        row.appendChild(menuButton);

        row.addEventListener('click', (event) => {
          const multiSelect = event.ctrlKey || event.metaKey;
          setCommitSelection(model, index, multiSelect);
          focusCommitRow(index, { preventReveal: true });
          vscode.postMessage({
            type: 'commit-click',
            commitId: commit.id,
            branch: commit.branch
          });
        });

        row.addEventListener('focus', () => {
          focusedCommitIndex = index;
          syncCommitRowTabStops();
        });

        row.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
              expandSelectionAndMoveFocus(model, index, 1);
            } else {
              moveFocusOnly(model, index, 1);
            }
            return;
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
              expandSelectionAndMoveFocus(model, index, -1);
            } else {
              moveFocusOnly(model, index, -1);
            }
            return;
          }

          if (event.key === 'Home') {
            event.preventDefault();
            focusCommitBoundary(model, 'start');
            return;
          }

          if (event.key === 'End') {
            event.preventDefault();
            focusCommitBoundary(model, 'end');
            return;
          }

          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
              setCommitSelection(model, index, true);
              focusCommitRow(index, { preventReveal: true });
            } else {
              invokeCommit(model, index);
            }
            return;
          }

          if (event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault();
            setCommitSelection(model, index, event.ctrlKey || event.metaKey);
            focusCommitRow(index, { preventReveal: true });
            return;
          }

          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            openCommitContextMenu(model, index, selectedCommitIndexes.size > 1);
          }
        });

        row.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          openCommitContextMenu(model, index, true);
        });

        menuButton.addEventListener('click', (event) => {
          event.stopPropagation();
          openCommitContextMenu(model, index, true);
        });

        tableElem.appendChild(row);
      }

      applySelectionState();
      syncCommitRowTabStops();
    }

    function wireVertexClicks(model) {
      const vertices = document.querySelectorAll('#commitGraph circle[data-id]');
      vertices.forEach((circle) => {
        circle.addEventListener('click', () => {
          const idValue = Number(circle.dataset.id);
          if (!Number.isInteger(idValue) || idValue < 0 || idValue >= model.commits.length) {
            return;
          }

          const commit = model.commits[idValue];
          vscode.postMessage({
            type: 'commit-click',
            commitId: commit.id,
            branch: commit.branch
          });
        });
      });
    }

    function draw(model, config) {
      if (!model || !Array.isArray(model.branches) || !Array.isArray(model.commits)) {
        showError('Invalid graph model.');
        return;
      }

      currentModel = model;
      currentConfig = config;
      selectedCommitIndexes.clear();
      renderCommitTable(model);
      const rowCenterByCommitId = measureCommitRowCentersByCommitId(model);
      drawSimpleGraph(model, config, rowCenterByCommitId);
    }

    function realignGraphToRows() {
      if (!currentModel || !currentConfig) {
        return;
      }

      const rowCenterByCommitId = measureCommitRowCentersByCommitId(currentModel);
      drawSimpleGraph(currentModel, currentConfig, rowCenterByCommitId);
      applySelectionState();
    }

    function scheduleGraphRealign() {
      if (alignRafHandle) {
        cancelAnimationFrame(alignRafHandle);
      }

      alignRafHandle = requestAnimationFrame(() => {
        alignRafHandle = 0;
        realignGraphToRows();
      });
    }

    window.addEventListener('resize', scheduleGraphRealign);
    viewElem.addEventListener('scroll', () => {
      closeFallbackTooltip();
      clearFallbackActiveState();
    });
    if (typeof ResizeObserver !== 'undefined') {
      const tableObserver = new ResizeObserver(() => {
        scheduleGraphRealign();
      });
      tableObserver.observe(tableElem);
    }

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'set-loading') {
        setLoadingVisible(event.data.loading !== false);
        return;
      }

      if (event.data?.type === 'set-graph') {
        try {
          setLoadingVisible(false);
          draw(event.data.model, event.data.config);
          const branchCount = Array.isArray(event.data.model?.branches) ? event.data.model.branches.length : 0;
          const commitCount = Array.isArray(event.data.model?.commits) ? event.data.model.commits.length : 0;
          setHeaderStatus('Loaded slice with ' + commitCount + ' commit(s) across ' + branchCount + ' branch(es).');
        } catch (error) {
          const details = error instanceof Error ? error.message : String(error);
          showError('Unable to render graph.\\n\\n' + details);
        }
      }
    });

    renderHeader();

    if (initialLoading) {
      setLoadingVisible(true);
    } else {
      try {
        draw(initialPayload.model, initialPayload.config);
        scheduleGraphRealign();
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        showError('Unable to render initial graph.\\n\\n' + details);
      }
    }
  </script>
</body>
</html>`;
  }
}

function normalizeGitGraphDefinition(graphDefinition: string): string {
  const trimmed = graphDefinition.trim();
  if (!trimmed) {
    return 'gitGraph\n  commit id: "A"';
  }

  if (/^%%\{/.test(trimmed) || /^gitGraph\b/.test(trimmed)) {
    return trimmed;
  }

  const indentedBody = trimmed
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join('\n');

  return `gitGraph\n${indentedBody}`;
}

function parseGitGraph(graphDefinition: string): GraphModel {
  const lines = graphDefinition
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('%%'));

  const branches: string[] = ['main'];
  const commits: GraphCommit[] = [];
  const branchHeads = new Map<string, string | undefined>([['main', undefined]]);
  let currentBranch = 'main';
  let commitCount = 1;

  for (const line of lines) {
    if (/^gitGraph\b/.test(line)) {
      continue;
    }

    const branchMatch = line.match(/^branch\s+(.+)$/);
    if (branchMatch) {
      const name = branchMatch[1].trim();
      if (!branches.includes(name)) {
        branches.push(name);
      }
      branchHeads.set(name, branchHeads.get(currentBranch));
      continue;
    }

    const checkoutMatch = line.match(/^checkout\s+(.+)$/);
    if (checkoutMatch) {
      const name = checkoutMatch[1].trim();
      if (!branches.includes(name)) {
        branches.push(name);
        branchHeads.set(name, undefined);
      }
      currentBranch = name;
      continue;
    }

    const mergeMatch = line.match(/^merge\s+(.+)$/);
    if (mergeMatch) {
      const sourceBranch = mergeMatch[1].trim();
      const currentHead = branchHeads.get(currentBranch);
      const sourceHead = branchHeads.get(sourceBranch);
      const parents = [currentHead, sourceHead].filter((value): value is string => typeof value === 'string');
      const id = `merge-${commitCount}`;
      commitCount += 1;
      commits.push({ id, branch: currentBranch, parents });
      branchHeads.set(currentBranch, id);
      continue;
    }

    if (/^commit\b/.test(line)) {
      const idMatch = line.match(/\bid:\s*"([^"]+)"|\bid:\s*([^\s]+)/);
      const id = (idMatch && (idMatch[1] ?? idMatch[2])) ? String(idMatch[1] ?? idMatch[2]) : `C${commitCount}`;
      commitCount += 1;
      const head = branchHeads.get(currentBranch);
      const parents = head ? [head] : [];
      commits.push({ id, branch: currentBranch, parents });
      branchHeads.set(currentBranch, id);
    }
  }

  if (commits.length === 0) {
    commits.push({ id: 'A', branch: 'main', parents: [] });
  }

  return {
    branches,
    commits
  };
}

function shouldUseSampleModel(graphDefinition: string, model: GraphModel): boolean {
  const trimmed = graphDefinition.trim();
  if (!trimmed) {
    return true;
  }

  if (model.commits.length === 0) {
    return true;
  }

  // If the parser only produced the placeholder commit, show a richer sample graph.
  if (
    model.commits.length === 1
    && model.commits[0].id === 'A'
    && model.commits[0].branch === 'main'
    && model.commits[0].parents.length === 0
  ) {
    return true;
  }

  return false;
}

function createSampleGraphModel(): GraphModel {
  const model: GraphModel = {
    branches: ['main', 'feature/auth', 'release/1.1'],
    commits: [
      { id: 'A0', branch: 'main', parents: [] },
      { id: 'A1', branch: 'main', parents: ['A0'] },
      { id: 'T1', branch: 'temp/deleted', parents: ['A1'], message: 'Temporary branch commit' },
      {
        id: 'M1',
        branch: 'main',
        parents: ['A1', 'T1'],
        message: 'Merge deleted temp branch',
        secondParentId: 'T1',
        secondParentKind: 'detached',
        secondParentBranches: []
      },
      { id: 'F1', branch: 'feature/auth', parents: ['M1'] },
      { id: 'F2', branch: 'feature/auth', parents: ['F1'] },
      {
        id: 'M2',
        branch: 'main',
        parents: ['M1', 'F2'],
        message: 'Merge feature/auth',
        secondParentId: 'F2',
        secondParentKind: 'branch',
        secondParentBranches: ['feature/auth']
      },
      { id: 'R1', branch: 'release/1.1', parents: ['M2'] },
      { id: 'R2', branch: 'release/1.1', parents: ['R1'] }
    ]
  };

  return {
    ...model,
    commits: [...model.commits].reverse()
  };
}

function createNonce(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}
