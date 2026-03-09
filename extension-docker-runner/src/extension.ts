import * as vscode from 'vscode';
import type { ExtensionContext } from 'vscode';
import { execSync } from 'child_process';
import { JSONPath } from 'jsonpath-plus';
import {
  executeFlow,
  terminalChangedShellIntegration,
  terminalDidClose,
  WebviewWorkflowInputProvider,
  WorkflowExecutionPlan,
  WorkflowExecutionStep
} from '@upcloud/common';

import * as helpers from '@zim.kalinowski/vscode-helper-toolkit';

const VIEW_ID = 'vscode-docker-runner.tree';
const TREE_CONTEXT = 'dockerRunnerItem';
const TERMINAL_NAME = 'Docker Runner';

type YamlValue = string | number | boolean | null | YamlObject | YamlValue[];
interface YamlObject {
  [key: string]: YamlValue;
}

interface TreeNode {
  id: string;
  name: string;
  type: string;
  genericType: string;
  icon?: string;
  details?: string;
  raw: Record<string, unknown>;
  parentId?: string;
  subitems?: TreeNode[];
  childrenLoaded?: boolean;
  detailsLoaded?: boolean;
  [key: string]: unknown;
}

interface TreeTemplates {
  itemSources: YamlObject[];
  detailSources: YamlObject[];
  extractors: YamlObject[];
  operations: YamlObject[];
}

interface OperationChoice {
  label: string;
  description?: string;
  operation: YamlObject;
}

class DockerTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private readonly terminal: vscode.Terminal;
  private readonly roots: TreeNode[];
  private readonly templates: TreeTemplates;
  private readonly nodeMap = new Map<string, TreeNode>();
  private selectedItem?: TreeNode;

  constructor(private readonly context: ExtensionContext) {
    this.terminal = vscode.window.createTerminal(TERMINAL_NAME, process.platform === 'win32' ? 'powershell' : undefined);
    const loader = new helpers.DefinitionLoader(context.extensionPath, 'defs/____tree.yaml');
    const yamlRoot = loader.getYaml() as YamlObject | null;

    if (!yamlRoot) {
      const message = loader.getErrors().join('\n') || 'Unknown YAML load error';
      vscode.window.showErrorMessage(`Docker Runner: unable to load tree definition. ${message}`);
      this.roots = [];
      this.templates = {
        itemSources: [],
        detailSources: [],
        extractors: [],
        operations: []
      };
      return;
    }

    this.templates = {
      itemSources: this.readArray(yamlRoot['item-sources']),
      detailSources: this.readArray(yamlRoot['detail-sources']),
      extractors: this.readArray(yamlRoot.extractors),
      operations: this.readArray(yamlRoot.operations)
    };
    this.roots = this.mapInitialItems(this.readArray(yamlRoot.items), undefined);
  }

  setSelectedItem(item: TreeNode | undefined): void {
    this.selectedItem = item;
  }

  getSelectedItem(): TreeNode | undefined {
    return this.selectedItem;
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const canExpand = this.canHaveChildren(element);
    const item = new vscode.TreeItem(
      element.name,
      canExpand ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );

    item.id = element.id;
    item.contextValue = TREE_CONTEXT;
    item.tooltip = element.name;

    if (element.icon) {
      item.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', element.icon);
    }

    if (!canExpand) {
      item.command = {
        command: 'vscode-docker-runner.itemOperations',
        title: 'Docker Runner: Operations',
        arguments: [element]
      };
    }

    return item;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      return this.roots;
    }

    if (this.canHaveChildren(element) && !element.childrenLoaded) {
      await this.loadChildren(element);
    }

    return element.subitems ?? [];
  }

  refresh(item?: TreeNode): void {
    if (!item) {
      this.roots.forEach((root) => this.resetNode(root, true));
      this.onDidChangeTreeDataEmitter.fire(undefined);
      return;
    }

    this.resetNode(item, false);
    this.onDidChangeTreeDataEmitter.fire(item);
  }

  async runOperations(item?: TreeNode): Promise<void> {
    const target = item ?? this.getSelectedItem();
    if (!target) {
      vscode.window.showInformationMessage('Docker Runner: select a tree item first.');
      return;
    }

    await this.ensureDetailsLoaded(target);

    const available = this.getMatchingOperations(target).filter((op) => this.matchesCondition(target, op));
    if (available.length === 0) {
      vscode.window.showInformationMessage(`Docker Runner: no operations available for '${target.name}'.`);
      return;
    }

    const choice = await vscode.window.showQuickPick<OperationChoice>(
      available.map((operation) => ({
        label: String(operation.name ?? operation.type ?? 'Operation'),
        description: String(operation.type ?? ''),
        operation
      })),
      { title: `Docker Runner operations: ${target.name}` }
    );

    if (!choice) {
      return;
    }

    await this.executeOperation(target, choice.operation);
  }

  private readArray(value: YamlValue | undefined): YamlObject[] {
    return Array.isArray(value) ? (value as YamlObject[]) : [];
  }

  private mapInitialItems(items: YamlObject[], parentId: string | undefined): TreeNode[] {
    return items.map((item) => {
      const node: TreeNode = {
        id: String(item.id),
        name: String(item.name),
        type: String(item.type),
        genericType: String(item['generic-type'] ?? item.type),
        icon: typeof item.icon === 'string' ? item.icon : undefined,
        details: typeof item.details === 'string' ? item.details : undefined,
        raw: typeof item.raw === 'object' && item.raw !== null ? item.raw as Record<string, unknown> : {},
        parentId,
        subitems: [],
        childrenLoaded: false,
        detailsLoaded: false
      };

      this.nodeMap.set(node.id, node);

      const staticChildren = Array.isArray(item.subitems) ? this.mapInitialItems(item.subitems as YamlObject[], node.id) : [];
      node.subitems = staticChildren;
      node.childrenLoaded = staticChildren.length > 0;
      return node;
    });
  }

  private canHaveChildren(node: TreeNode): boolean {
    if (node.subitems && node.subitems.length > 0) {
      return true;
    }

    return this.findChildrenQuery(node) !== undefined;
  }

  private resetNode(node: TreeNode, recursive: boolean): void {
    node.childrenLoaded = Array.isArray(node.subitems) && node.subitems.length > 0;
    node.detailsLoaded = false;
    if (!node.childrenLoaded) {
      node.subitems = [];
    }

    if (recursive && node.subitems) {
      node.subitems.forEach((child) => this.resetNode(child, true));
    }
  }

  private async loadChildren(node: TreeNode): Promise<void> {
    const query = this.findChildrenQuery(node);
    if (!query) {
      node.childrenLoaded = true;
      return;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `Docker Runner: loading ${node.name}...` },
      async () => {
        const parser = typeof query.parser === 'string' ? query.parser : 'json';
        const data = this.runQuery(query, node, parser);
        const ids = this.pathValues(query['path-id'], data);
        const names = this.pathValues(query['path-name'], data);
        const raws = this.pathValues(query['path-raw'], data);

        const children: TreeNode[] = [];
        for (let index = 0; index < ids.length; index += 1) {
          const raw = (raws[index] ?? {}) as Record<string, unknown>;
          const explicitType = typeof query['item-type'] === 'string' ? query['item-type'] : 'unknown';
          const resolvedType = explicitType.startsWith('$')
            ? String(this.pathValues(explicitType, raw)[0] ?? explicitType)
            : explicitType;

          const child: TreeNode = {
            id: String(ids[index]),
            name: String(names[index] ?? ids[index]),
            type: resolvedType,
            genericType: String(query['item-type-generic'] ?? resolvedType),
            icon: node.icon,
            raw,
            parentId: node.id,
            subitems: [],
            childrenLoaded: false,
            detailsLoaded: false
          };

          this.applyExtractors(child);
          this.nodeMap.set(child.id, child);
          children.push(child);
        }

        children.sort((a, b) => a.name.localeCompare(b.name));
        node.subitems = children;
        node.childrenLoaded = true;
      }
    );
  }

  private async ensureDetailsLoaded(node: TreeNode): Promise<void> {
    if (node.detailsLoaded) {
      return;
    }

    const detailQuery = this.findDetailQuery(node);
    if (detailQuery) {
      const data = this.runQuery(detailQuery, node, 'json');
      if (Array.isArray(data) && data.length > 0) {
        node.raw = data[0] as Record<string, unknown>;
      } else if (typeof data === 'object' && data !== null) {
        node.raw = data as Record<string, unknown>;
      }
    }

    this.applyExtractors(node);
    node.detailsLoaded = true;
  }

  private runQuery(query: YamlObject, node: TreeNode, parser: string): unknown {
    const cmd = this.resolveCommand(query.cmd, node);
    if (!cmd) {
      return parser === 'rows-json' ? [] : {};
    }

    try {
      const shell = process.platform === 'win32' ? 'powershell' : '/bin/bash';
      const output = execSync(cmd, { shell, encoding: 'utf8' });

      if (parser === 'rows-json') {
        return output
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line));
      }

      return JSON.parse(output);
    } catch (error) {
      vscode.window.showErrorMessage(`Docker Runner command failed: ${cmd}`);
      return parser === 'rows-json' ? [] : {};
    }
  }

  private resolveCommand(cmdDefinition: unknown, node: TreeNode): string {
    if (typeof cmdDefinition === 'string') {
      return this.replacePlaceholders(cmdDefinition, node);
    }

    if (Array.isArray(cmdDefinition) && cmdDefinition.length > 0) {
      const first = cmdDefinition[0];
      return typeof first === 'string' ? this.replacePlaceholders(first, node) : '';
    }

    return '';
  }

  private replacePlaceholders(template: string, node: TreeNode): string {
    return template.replace(/\$\{([a-zA-Z0-9_-]+)\}/g, (_, key: string) => {
      const value = node[key] ?? node.raw[key];
      return value !== undefined ? String(value) : 'unknown';
    });
  }

  private pathValues(pathDef: unknown, json: unknown): unknown[] {
    if (typeof pathDef !== 'string') {
      return [];
    }

    try {
      const result = JSONPath({
        path: pathDef,
        json: json as string | number | boolean | object | any[] | null,
        wrap: true
      }) as unknown;
      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }

  private applyExtractors(node: TreeNode): void {
    const extractors = this.findMatchingTemplates(node, this.templates.extractors);
    for (const extractor of extractors) {
      const fields = typeof extractor.fields === 'object' && extractor.fields !== null
        ? extractor.fields as Record<string, YamlObject>
        : {};

      for (const fieldName of Object.keys(fields)) {
        const fieldDef = fields[fieldName];
        const path = fieldDef.path;
        if (typeof path !== 'string') {
          continue;
        }

        const values = this.pathValues(path, node.raw);
        let value: unknown = values.length > 0 ? values[0] : undefined;

        if (fieldDef.map && typeof fieldDef.map === 'object') {
          const map = fieldDef.map as Record<string, unknown>;
          const key = String(value);
          if (key in map) {
            value = map[key];
          }
        }

        node[fieldName] = value;
      }
    }
  }

  private findChildrenQuery(node: TreeNode): YamlObject | undefined {
    return this.findMatchingTemplates(node, this.templates.itemSources)[0];
  }

  private findDetailQuery(node: TreeNode): YamlObject | undefined {
    return this.findMatchingTemplates(node, this.templates.detailSources)[0];
  }

  private getMatchingOperations(node: TreeNode): YamlObject[] {
    return this.findMatchingTemplates(node, this.templates.operations);
  }

  private findMatchingTemplates(node: TreeNode, templates: YamlObject[]): YamlObject[] {
    return templates.filter((template) => {
      const itemTypes = template['item-types'];

      if (typeof itemTypes === 'string') {
        return itemTypes === node.type || itemTypes === node.genericType;
      }

      if (Array.isArray(itemTypes)) {
        const types = itemTypes.map((value) => String(value));
        return types.includes(node.type) || types.includes(node.genericType);
      }

      return false;
    });
  }

  private matchesCondition(node: TreeNode, operation: YamlObject): boolean {
    const when = operation.when;
    if (!when || typeof when !== 'object') {
      return true;
    }

    const condition = when as Record<string, unknown>;
    if (typeof condition.path !== 'string') {
      return true;
    }

    const values = this.pathValues(condition.path, node.raw);
    const actual = values[0];
    const expected = condition.value;
    const compare = condition.compare === 'ne' ? 'ne' : 'eq';

    return compare === 'eq' ? actual === expected : actual !== expected;
  }

  private async executeOperation(node: TreeNode, operation: YamlObject): Promise<void> {
    const hasTemplate = typeof operation.template === 'object' && operation.template !== null;
    const hasCommand = typeof operation.cmd === 'string';

    if (hasTemplate && hasCommand) {
      const method = await vscode.window.showQuickPick(
        [
          { label: 'Run command', description: 'Execute shell command directly' },
          { label: 'Open form', description: 'Run operation via YAML form' }
        ],
        { title: String(operation.name ?? 'Choose operation mode') }
      );

      if (!method) {
        return;
      }

      if (method.label === 'Open form') {
        await this.openOperationForm(node, operation);
      } else {
        this.executeOperationCommand(node, operation);
      }
    } else if (hasTemplate) {
      await this.openOperationForm(node, operation);
    } else if (hasCommand) {
      this.executeOperationCommand(node, operation);
    }

    this.applyRefresh(node, operation);
  }

  private executeOperationCommand(node: TreeNode, operation: YamlObject): void {
    const cmd = this.resolveCommand(operation.cmd, node);
    if (!cmd) {
      return;
    }

    this.terminal.show(true);
    this.terminal.sendText(cmd, true);
  }

  private async openOperationForm(node: TreeNode, operation: YamlObject): Promise<void> {
    const template = operation.template as Record<string, unknown>;
    const templateName = typeof template.name === 'string' ? template.name : undefined;
    if (!templateName) {
      return;
    }

    await openFormView(this.context, templateName, this.readTemplateVariables(template, node));
  }

  private readTemplateVariables(template: Record<string, unknown>, node: TreeNode): Record<string, string> {
    const variables: Record<string, string> = {};
    const parameters = template.parameters;
    if (!parameters || typeof parameters !== 'object') {
      return variables;
    }

    for (const [key, value] of Object.entries(parameters as Record<string, unknown>)) {
      if (typeof value === 'string') {
        variables[key] = this.replacePlaceholders(value, node);
      }
    }

    return variables;
  }

  private applyRefresh(node: TreeNode, operation: YamlObject): void {
    const refresh = operation.refresh;
    if (typeof refresh !== 'string' || refresh === 'none') {
      return;
    }

    if (refresh === 'self') {
      this.refresh(node);
      return;
    }

    if (refresh === 'parent') {
      if (node.parentId) {
        const parent = this.nodeMap.get(node.parentId);
        if (parent) {
          this.refresh(parent);
        }
      } else {
        this.refresh();
      }
      return;
    }

    const target = this.nodeMap.get(refresh);
    if (target) {
      this.refresh(target);
    } else {
      this.refresh();
    }
  }
}

const openForms: unknown[] = [];

async function openFormView(
  context: ExtensionContext,
  definitionPath: string,
  variables: Record<string, string> = {}
): Promise<void> {
  const loader = new helpers.DefinitionLoader(context.extensionPath, `defs/${definitionPath}`);
  const form = loader.getYaml();

  if (!form) {
    const errors = loader.getErrors().join('\n') || 'Unknown form loading error';
    vscode.window.showErrorMessage(`Docker Runner: unable to open form '${definitionPath}'. ${errors}`);
    return;
  }

  const view = new helpers.GenericWebView(context, 'Docker Runner', TERMINAL_NAME, vscode);
  Object.entries(variables).forEach(([key, value]) => view.setVariable(key, value));
  view.createPanel(form, 'media/icon.png');
  openForms.push(view);
}

export function activate(context: ExtensionContext): void {
  const provider = new DockerTreeProvider(context);
  const treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider, showCollapseAll: true });
  const shellIntegrationDisposable = vscode.window.onDidChangeTerminalShellIntegration(event => {
    terminalChangedShellIntegration(event.shellIntegration);
  });
  const terminalCloseDisposable = vscode.window.onDidCloseTerminal(terminalDidClose);

  context.subscriptions.push(
    treeView,
    shellIntegrationDisposable,
    terminalCloseDisposable,
    vscode.commands.registerCommand('vscode-docker-runner.displayExplorer', async () => {
      await vscode.commands.executeCommand('workbench.view.explorer');
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }),
    vscode.commands.registerCommand('vscode-docker-runner.displayDiscoverImages', async () => {
      await openFormView(context, 'docker/docker_image_import.yaml');
    }),
    vscode.commands.registerCommand('vscode-docker-runner.displayCreateContainers', async () => {
      await openFormView(context, 'docker/docker_run.yaml');
    }),
    vscode.commands.registerCommand('vscode-docker-runner.itemOperations', async (item?: TreeNode) => {
      await provider.runOperations(item);
    }),
    vscode.commands.registerCommand('vscode-docker-runner.refreshTree', (item?: TreeNode) => {
      provider.refresh(item);
    }),
    vscode.commands.registerCommand('vscode-docker-runner.showWelcome', async () => {
      const plan = createWelcomeWorkflowExecutionPlan();
      await executeFlow(plan, new WebviewWorkflowInputProvider());
    })
  );

  treeView.onDidChangeSelection((event) => {
    provider.setSelectedItem(event.selection[0]);
  });
}

export function deactivate(): void {}

function createWelcomeWorkflowExecutionPlan(): WorkflowExecutionPlan {
  const plan = new WorkflowExecutionPlan(
    'Docker Runner Welcome',
    [],
    'Welcome workflow for Docker Runner.',
    'Run the single verification item to confirm Docker CLI is installed and available on PATH.'
  );

  plan.addStep(new WorkflowExecutionStep(
    'verify docker',
    'Check Docker CLI availability by reading its version.',
    'docker --version',
    [
      {
        pattern: /not recognized|command not found|no such file/i,
        description: 'Docker CLI is not available. Install Docker and ensure it is available on PATH.'
      }
    ]
  ));

  return plan;
}
