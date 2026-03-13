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

  showModel(model: GraphModel, initialFilter?: GitGraphFilter): void {
    const normalizedModel = (!model || !Array.isArray(model.branches) || !Array.isArray(model.commits) || model.commits.length === 0)
      ? createSampleGraphModel()
      : model;

    const initialConfig = {
      branchLaneDistance: this.options.branchLaneDistance ?? 120,
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

          const selectedCount = Array.isArray(message.selectedCommitIds)
            ? message.selectedCommitIds.filter((id: unknown): id is string => typeof id === 'string').length
            : 0;
          const suffix = selectedCount > 1 ? ` (${selectedCount} selected)` : '';
          void vscode.window.showInformationMessage(`Commit context menu placeholder: ${message.commitId}${suffix}`);
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
    initialFilterUri?: string
  ): string {
    const nonce = createNonce();
    const initialPayload = JSON.stringify({ model: initialModel, config: initialConfig }).replace(/</g, '\\u003c');
    const initialFilterUriJson = JSON.stringify(initialFilterUri ?? '').replace(/</g, '\\u003c');

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
    body {
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }

    .panel {
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 8px;
      overflow: hidden;
      min-height: 240px;
      margin: 12px;
    }

    #view {
      position: relative;
      display: flex;
      height: min(64vh, 700px);
      min-height: 260px;
      overflow: auto;
      background: var(--vscode-editor-background);
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

    #commitGraph circle:not(.current) {
      stroke: var(--vscode-editor-background);
      stroke-width: 1;
      stroke-opacity: 0.75;
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

    #graphTooltip {
      display: block;
      position: absolute;
      pointer-events: none;
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

    .commit-id {
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      opacity: 0.95;
      min-width: 110px;
    }

    .commit-branch {
      font-size: 11px;
      opacity: 0.8;
      border: 1px solid color-mix(in srgb, var(--vscode-editorWidget-border) 85%, transparent);
      border-radius: 10px;
      padding: 0 6px;
      line-height: 16px;
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

    #commitGraph circle.selected {
      filter: saturate(1.2);
    }

    #commitGraph .selection-decorators {
      pointer-events: none;
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
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const root = document.getElementById('root');
    const viewElem = document.getElementById('view');
    const tableElem = document.getElementById('commitTable');
    const graphColumnElem = document.getElementById('graphColumn');
    const initialPayload = ${initialPayload};
    const initialFilterUri = ${initialFilterUriJson};
    const COLORS = ['#1a73e8', '#34a853', '#ea4335', '#fbbc05', '#3f51b5', '#009688', '#ef6c00', '#8e24aa', '#4e6cef', '#5e9b45'];
    const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
    const UNCOMMITTED = '*';
    let currentModel = null;
    let currentConfig = null;
    let currentFallbackLayout = null;
    let alignRafHandle = 0;

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

    function collectHeaderFilter() {
      const uriInput = document.getElementById('filterUri');
      const sourceSelect = document.getElementById('filterSource');
      const localInput = document.getElementById('filterLocalPath');
      const remoteInput = document.getElementById('filterRemoteUrl');
      const branchesInput = document.getElementById('filterBranches');
      const filesInput = document.getElementById('filterFiles');
      const rangeInput = document.getElementById('filterRange');

      const rawSource = sourceSelect ? sourceSelect.value : 'sample';
      const source = rawSource === 'remote' ? 'remote' : rawSource === 'sample' ? 'sample' : 'local';
      const draft = {
        source,
        localPath: localInput ? localInput.value : '',
        remoteUrl: remoteInput ? remoteInput.value : '',
        branches: branchesInput ? branchesInput.value : '',
        files: filesInput ? filesInput.value : '',
        commitRange: rangeInput ? rangeInput.value : ''
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
        + '    <div class="header-field">'
        + '      <label>Commit Range</label>'
        + '      <input id="filterRange" type="text" placeholder="HEAD~20..HEAD" />'
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
      const rangeInput = document.getElementById('filterRange');
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
          commitRange: rangeInput ? rangeInput.value : ''
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
        if (rangeInput) {
          rangeInput.value = state.commitRange;
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
      if (rangeInput) {
        rangeInput.addEventListener('input', updateUriFromFields);
      }
      if (uriInput) {
        uriInput.addEventListener('change', updateFieldsFromUri);
      }

      if (applyButton) {
        applyButton.addEventListener('click', () => {
          const filter = collectHeaderFilter();
          setHeaderStatus('Applying: ' + filter.uri);
          if (collapsedStatus) collapsedStatus.textContent = filter.uri;
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

      anchor.setAttribute('id', 'graphTooltip');
      pointer.setAttribute('id', 'graphTooltipPointer');
      pointer.style.backgroundColor = color;
      content.setAttribute('id', 'graphTooltipContent');
      content.style.borderColor = color;
      content.innerHTML = [
        '<div class="graphTooltipTitle">Commit ' + escapeHtml(abbrevCommit(commit.id)) + '</div>',
        '<div class="graphTooltipSection">Branch: <span class="graphTooltipRef">' + escapeHtml(commit.branch) + '</span></div>',
        headNames.length > 0 ? '<div class="graphTooltipSection">Heads: ' + heads + '</div>' : '',
        '<div class="graphTooltipSection">Parents: ' + parents + '</div>'
      ].filter(Boolean).join('');
      shadow.setAttribute('id', 'graphTooltipShadow');

      anchor.appendChild(shadow);
      anchor.appendChild(pointer);
      anchor.appendChild(content);
      graphColumnElem.appendChild(anchor);
      fallbackTooltip = anchor;

      const columnRect = graphColumnElem.getBoundingClientRect();
      const top = Math.max(4, Math.min(node.y - 28, graphColumnElem.clientHeight - 72));
      anchor.style.left = node.x + 'px';
      anchor.style.top = top + 'px';
      content.style.maxWidth = Math.min(columnRect.width - node.x - 35, 360) + 'px';

      const tooltipRect = content.getBoundingClientRect();
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
      const lane = Math.max(10, Number(config?.branchLaneDistance ?? 100));
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

      const circles = document.querySelectorAll('#commitGraph circle[data-id]');
      circles.forEach((circle) => {
        const idValue = Number(circle.dataset.id);
        const isSelected = Number.isInteger(idValue) && selectedCommitIndexes.has(idValue);
        circle.classList.toggle('selected', isSelected);
        applySelectedCircleStyle(circle, isSelected);
      });

      renderSelectionDecorations(currentModel, currentFallbackLayout);
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
    }

    function getSelectedCommitIds(model) {
      return Array.from(selectedCommitIndexes)
        .sort((a, b) => a - b)
        .map((index) => model.commits[index]?.id)
        .filter((id) => typeof id === 'string');
    }

    function createCurvePath(parent, child) {
      if (parent.x === child.x) {
        return 'M' + parent.x + ',' + parent.y + ' L' + child.x + ',' + child.y;
      }

      const bend = Math.max(16, Math.abs(child.y - parent.y) * 0.55);
      return 'M' + parent.x + ',' + parent.y
        + ' C' + parent.x + ',' + (parent.y + bend)
        + ' ' + child.x + ',' + (child.y - bend)
        + ' ' + child.x + ',' + child.y;
    }

    function wireFallbackInteractions(model, layout) {
      const rows = getCommitElems();
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

      rows.forEach((row) => {
        const idValue = Number(row.dataset.id);
        if (!Number.isInteger(idValue)) {
          return;
        }

        row.addEventListener('mouseenter', () => activate(idValue));
        row.addEventListener('mouseleave', deactivate);
      });

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
      const width = layout.width;
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

        const circle = document.createElementNS(SVG_NAMESPACE, 'circle');
        circle.dataset.id = String(node.index);
        circle.dataset.current = String(node.isCurrent);
        circle.dataset.branchColor = COLORS[node.branchColorIndex % COLORS.length];
        circle.dataset.baseStrokeWidth = String(strokeWidth);
        circle.setAttribute('cx', String(node.x));
        circle.setAttribute('cy', String(node.y));
        circle.setAttribute('r', node.isCurrent ? '5.5' : '4');
        if (node.isCurrent) {
          circle.setAttribute('class', 'current');
          circle.setAttribute('fill', 'var(--vscode-editor-background)');
          circle.setAttribute('stroke', COLORS[node.branchColorIndex % COLORS.length]);
          circle.setAttribute('stroke-width', String(strokeWidth));
        } else {
          circle.setAttribute('fill', COLORS[node.branchColorIndex % COLORS.length]);
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
      }

      document.getElementById('commitGraph')?.appendChild(svg);
      renderSelectionDecorations(model, layout);
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

      const branchHeads = getBranchHeads(model);
      const orderedIndexes = getFallbackDisplayOrder(model);

      for (let pos = orderedIndexes.length - 1; pos >= 0; pos -= 1) {
        const index = orderedIndexes[pos];
        const commit = model.commits[index];
        const row = document.createElement('div');
        row.className = 'commit';
        row.dataset.id = String(index);

        const id = document.createElement('div');
        id.className = 'commit-id';
        id.textContent = commit.id;

        const branch = document.createElement('div');
        branch.className = 'commit-branch';
        branch.textContent = commit.branch;

        const message = document.createElement('div');
        message.className = 'commit-message';
        message.textContent = String(commit.message || '');

        row.appendChild(id);
        row.appendChild(branch);
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
          vscode.postMessage({
            type: 'commit-click',
            commitId: commit.id,
            branch: commit.branch
          });
        });

        row.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          setCommitSelection(model, index, true);
          vscode.postMessage({
            type: 'commit-context-menu',
            commitId: commit.id,
            branch: commit.branch,
            selectedCommitIds: getSelectedCommitIds(model)
          });
        });

        menuButton.addEventListener('click', (event) => {
          event.stopPropagation();
          setCommitSelection(model, index, true);
          vscode.postMessage({
            type: 'commit-context-menu',
            commitId: commit.id,
            branch: commit.branch,
            selectedCommitIds: getSelectedCommitIds(model)
          });
        });

        tableElem.appendChild(row);
      }

      applySelectionState();
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
    if (typeof ResizeObserver !== 'undefined') {
      const tableObserver = new ResizeObserver(() => {
        scheduleGraphRealign();
      });
      tableObserver.observe(tableElem);
    }

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'set-graph') {
        try {
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

    try {
      draw(initialPayload.model, initialPayload.config);
      scheduleGraphRealign();
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      showError('Unable to render initial graph.\\n\\n' + details);
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
  return {
    branches: ['main', 'feature/auth', 'release/1.1'],
    commits: [
      { id: 'A0', branch: 'main', parents: [] },
      { id: 'A1', branch: 'main', parents: ['A0'] },
      { id: 'F1', branch: 'feature/auth', parents: ['A1'] },
      { id: 'F2', branch: 'feature/auth', parents: ['F1'] },
      { id: 'M1', branch: 'main', parents: ['A1', 'F2'] },
      { id: 'R1', branch: 'release/1.1', parents: ['M1'] },
      { id: 'R2', branch: 'release/1.1', parents: ['R1'] }
    ]
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
