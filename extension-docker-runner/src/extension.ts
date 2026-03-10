import * as vscode from 'vscode';
import type { ExtensionContext } from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'child_process';
import { JSONPath } from 'jsonpath-plus';
import {
  executeCommand,
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
const LOCAL_REGISTRY_LIST_TYPE = 'container-registry-list';
const LOCAL_REGISTRY_ITEM_TYPE = 'container-registry';
const LOCAL_REGISTRY_YAML_RELATIVE_PATH = '.smartercode/container-registries.yaml';
const PUBLIC_IMAGE_REGISTRIES = [
  'Docker Hub',
  'GitHub Container Registry',
  'Quay.io',
  'Google Container Registry',
  'Microsoft Container Registry',
  'Distroless / Chainguard',
  'Red Hat public registry'
];

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

type LocalContainerRegistryEntry = {
  id: string;
  name: string;
  provider: string;
  location: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: string;
};

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
    if (node.type === LOCAL_REGISTRY_LIST_TYPE) {
      return true;
    }

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
    if (node.type === LOCAL_REGISTRY_LIST_TYPE) {
      const children = readStoredContainerRegistries().map((entry, index) => {
        const idValue = entry.id || `${entry.provider}-${entry.name}-${index + 1}`;
        const child: TreeNode = {
          id: `container-registry-${idValue}`,
          name: entry.name || `Registry ${index + 1}`,
          type: LOCAL_REGISTRY_ITEM_TYPE,
          genericType: LOCAL_REGISTRY_ITEM_TYPE,
          icon: node.icon,
          raw: {
            ...entry,
            details: `${entry.provider || 'Unknown provider'}${entry.location ? ` | ${entry.location}` : ''}`
          },
          parentId: node.id,
          subitems: [],
          childrenLoaded: true,
          detailsLoaded: true
        };

        this.nodeMap.set(child.id, child);
        return child;
      });

      node.subitems = children;
      node.childrenLoaded = true;
      return;
    }

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
    const hasWorkflow = typeof operation.workflow === 'string';

    if (hasWorkflow) {
      await this.executeOperationWorkflow(String(operation.workflow), node);
      this.applyRefresh(node, operation);
      return;
    }

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

  private async executeOperationWorkflow(workflow: string, node: TreeNode): Promise<void> {
    if (workflow === 'container-registry-provision') {
      const plan = createContainerRegistryWorkflowExecutionPlan();
      await executeFlow(plan, new WebviewWorkflowInputProvider());
      return;
    }

    if (workflow === 'container-deploy') {
      const plan = createContainerDeploymentWorkflowExecutionPlan();
      await executeFlow(plan, new WebviewWorkflowInputProvider());
      return;
    }

    if (workflow === 'container-registry-copy-login') {
      await copyRegistryLoginCommand(node);
      return;
    }

    if (workflow === 'container-registry-open-console') {
      await openRegistryConsole(node);
      return;
    }

    if (workflow === 'container-registry-remove-local') {
      const id = String(node.raw.id ?? node.id).trim();
      const provider = String(node.raw.provider ?? '').trim();
      const name = String(node.raw.name ?? node.name).trim();
      const removed = removeStoredContainerRegistry(id, provider, name);
      if (!removed) {
        vscode.window.showWarningMessage(`Docker Runner: no local registry entry found for '${name}'.`);
      } else {
        vscode.window.showInformationMessage(`Docker Runner: removed '${name}' from local registry store.`);
      }
      return;
    }

    vscode.window.showWarningMessage(`Docker Runner: unknown workflow '${workflow}'.`);
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
    }),
    vscode.commands.registerCommand('vscode-docker-runner.provisionContainerRegistry', async () => {
      const plan = createContainerRegistryWorkflowExecutionPlan();
      await executeFlow(plan, new WebviewWorkflowInputProvider());
    }),
    vscode.commands.registerCommand('vscode-docker-runner.createContainer', async () => {
      const plan = createContainerDeploymentWorkflowExecutionPlan();
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

function createContainerRegistryWorkflowExecutionPlan(): WorkflowExecutionPlan {
  const providerAzure = 'Azure ACR';
  const providerAws = 'AWS ECR';
  const providerGcp = 'GCP Artifact Registry';
  const providerDigitalOcean = 'DigitalOcean Container Registry';
  const providerUpCloud = 'UpCloud VM with Docker Distribution';
  const providerStepVariable = 'registry_provider';

  const providerIs = (provider: string) =>
    (variables: Record<string, unknown>): boolean => String(variables[providerStepVariable] ?? '') === provider;

  const plan = new WorkflowExecutionPlan(
    'Container Registry Provisioning',
    [],
    'Provision a container registry using provider-specific CLI tooling.',
    'This workflow supports Azure ACR, AWS ECR, GCP Artifact Registry, DigitalOcean Container Registry, and an UpCloud VM-based Docker Distribution registry.'
  );

  const addConditionalTextEntryStep = (
    options: Parameters<typeof WorkflowExecutionStep.createTextEntryStep>[0],
    condition: (variables: Record<string, unknown>) => boolean
  ): void => {
    plan.addStep(new WorkflowExecutionStep(
      options.name,
      options.description,
      async context => {
        const value = await context.getInputProvider().textEntry(options, context);

        if (value === null) {
          return {
            success: false,
            output: ['User cancelled text entry.'],
            failureDescription: 'Cancelled by user.'
          };
        }

        if (options.required && value.trim() === '') {
          return {
            success: false,
            output: ['Text value is required but empty.'],
            failureDescription: 'Required input is empty.'
          };
        }

        context.setVariable(options.storeAs, value);
        return {
          success: true,
          output: [`Stored value in variable: ${options.storeAs}`]
        };
      },
      [],
      condition
    ));
  };

  const addConditionalSelectionStep = (
    options: Parameters<typeof WorkflowExecutionStep.createSelectionStep>[0],
    condition: (variables: Record<string, unknown>) => boolean
  ): void => {
    plan.addStep(new WorkflowExecutionStep(
      options.name,
      options.description,
      async context => {
        const items = options.options && options.options.length > 0
          ? context.resolveTemplates(options.options)
          : [];

        if (items.length === 0) {
          return {
            success: false,
            output: ['Selection list is empty.'],
            failureDescription: 'No options available for selection.'
          };
        }

        const selected = await context.getInputProvider().selection(options, items, context);

        if (!selected) {
          return {
            success: false,
            output: ['User cancelled single selection.'],
            failureDescription: 'Cancelled by user.'
          };
        }

        context.setVariable(options.storeAs, selected);
        return {
          success: true,
          output: [`Selected: ${selected}`]
        };
      },
      [],
      condition
    ));
  };

  plan.addStep(WorkflowExecutionStep.createSelectionStep({
    name: 'Provider Selection',
    description: 'Choose which provider to use for provisioning.',
    title: 'Provider Selection',
    placeHolder: 'Select a container registry provider',
    options: [providerAzure, providerAws, providerGcp, providerDigitalOcean, providerUpCloud],
    storeAs: providerStepVariable
  }));

  plan.addStep(WorkflowExecutionStep.createTextEntryStep({
    name: 'Registry Name',
    description: 'Set a registry name to be reused in provider-specific commands.',
    title: 'Registry Name',
    placeHolder: 'e.g. teamregistry',
    prompt: 'Use a globally unique lower-case name when your provider requires it.',
    storeAs: 'registry_name',
    required: true
  }));

  plan.addStep(new WorkflowExecutionStep(
    'Check Azure CLI',
    'Validate that Azure CLI is installed and available in PATH.',
    'az --version',
    [
      {
        pattern: /not recognized|command not found|no such file/i,
        description: 'Azure CLI is not available. Install Azure CLI and log in using az login.'
      }
    ],
    providerIs(providerAzure)
  ));

  addConditionalTextEntryStep({
    name: 'Azure Resource Group',
    description: 'Set the Azure resource group for the new ACR.',
    title: 'Azure Resource Group',
    placeHolder: 'e.g. rg-containers',
    storeAs: 'azure_resource_group',
    required: true
  }, providerIs(providerAzure));

  addConditionalTextEntryStep({
    name: 'Azure Location',
    description: 'Choose Azure region for ACR creation.',
    title: 'Azure Location',
    placeHolder: 'e.g. eastus',
    value: 'eastus',
    storeAs: 'azure_location',
    required: true
  }, providerIs(providerAzure));

  addConditionalSelectionStep({
    name: 'Azure ACR SKU',
    description: 'Choose the SKU tier for Azure Container Registry.',
    title: 'Azure ACR SKU',
    placeHolder: 'Select SKU',
    options: ['Basic', 'Standard', 'Premium'],
    storeAs: 'azure_acr_sku'
  }, providerIs(providerAzure));

  plan.addStep(new WorkflowExecutionStep(
    'Create Azure ACR',
    'Create Azure Container Registry using Azure CLI.',
    'az acr create --name ${registry_name} --resource-group ${azure_resource_group} --location ${azure_location} --sku ${azure_acr_sku}',
    [
      {
        pattern: /already exists|invalid|error/i,
        description: 'Azure ACR creation failed. Validate inputs and Azure subscription permissions.'
      }
    ],
    providerIs(providerAzure)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Verify Azure ACR',
    'Validate that the newly created Azure registry can be queried.',
    'az acr show --name ${registry_name} --resource-group ${azure_resource_group}',
    [],
    providerIs(providerAzure)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Check doctl CLI',
    'Validate that DigitalOcean CLI is installed and authenticated.',
    'doctl version',
    [
      {
        pattern: /not recognized|command not found|no such file/i,
        description: 'doctl is not available. Install doctl and authenticate first.'
      }
    ],
    providerIs(providerDigitalOcean)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Check AWS CLI',
    'Validate that AWS CLI is installed and authenticated.',
    'aws --version',
    [
      {
        pattern: /not recognized|command not found|no such file/i,
        description: 'AWS CLI is not available. Install AWS CLI and configure credentials first.'
      }
    ],
    providerIs(providerAws)
  ));

  addConditionalTextEntryStep({
    name: 'AWS Region',
    description: 'Set AWS region where ECR repository should be created.',
    title: 'AWS Region',
    placeHolder: 'e.g. us-east-1',
    value: 'us-east-1',
    storeAs: 'aws_region',
    required: true
  }, providerIs(providerAws));

  plan.addStep(new WorkflowExecutionStep(
    'Create AWS ECR Repository',
    'Create an Amazon ECR repository with AWS CLI.',
    'aws ecr create-repository --repository-name ${registry_name} --region ${aws_region}',
    [
      {
        pattern: /already exists|AccessDenied|UnrecognizedClient|error/i,
        description: 'AWS ECR repository creation failed. Verify credentials, region, and repository name.'
      }
    ],
    providerIs(providerAws)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Verify AWS ECR Repository',
    'Confirm the ECR repository can be queried.',
    'aws ecr describe-repositories --repository-names ${registry_name} --region ${aws_region}',
    [],
    providerIs(providerAws)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Check gcloud CLI',
    'Validate that Google Cloud CLI is installed and authenticated.',
    'gcloud --version',
    [
      {
        pattern: /not recognized|command not found|no such file/i,
        description: 'gcloud CLI is not available. Install Google Cloud CLI and authenticate first.'
      }
    ],
    providerIs(providerGcp)
  ));

  addConditionalTextEntryStep({
    name: 'GCP Project ID',
    description: 'Set Google Cloud project ID for Artifact Registry.',
    title: 'GCP Project ID',
    placeHolder: 'e.g. my-gcp-project',
    storeAs: 'gcp_project_id',
    required: true
  }, providerIs(providerGcp));

  addConditionalTextEntryStep({
    name: 'GCP Location',
    description: 'Set Artifact Registry location.',
    title: 'GCP Location',
    placeHolder: 'e.g. us-central1',
    value: 'us-central1',
    storeAs: 'gcp_location',
    required: true
  }, providerIs(providerGcp));

  plan.addStep(new WorkflowExecutionStep(
    'Create GCP Artifact Registry Repository',
    'Create a Docker Artifact Registry repository using gcloud.',
    'gcloud artifacts repositories create ${registry_name} --repository-format=docker --location=${gcp_location} --project=${gcp_project_id} --description="Docker registry created by Docker Runner workflow"',
    [
      {
        pattern: /already exists|PERMISSION_DENIED|NOT_FOUND|error/i,
        description: 'GCP Artifact Registry creation failed. Verify project, location, and permissions.'
      }
    ],
    providerIs(providerGcp)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Verify GCP Artifact Registry Repository',
    'Confirm the repository can be queried from Artifact Registry.',
    'gcloud artifacts repositories describe ${registry_name} --location=${gcp_location} --project=${gcp_project_id}',
    [],
    providerIs(providerGcp)
  ));

  addConditionalTextEntryStep({
    name: 'DigitalOcean Region',
    description: 'Set region slug for the DigitalOcean registry.',
    title: 'DigitalOcean Region',
    placeHolder: 'e.g. nyc3',
    value: 'nyc3',
    storeAs: 'do_region',
    required: true
  }, providerIs(providerDigitalOcean));

  addConditionalSelectionStep({
    name: 'DigitalOcean Subscription Tier',
    description: 'Choose the registry tier.',
    title: 'DigitalOcean Subscription Tier',
    placeHolder: 'Select tier',
    options: ['basic', 'professional'],
    storeAs: 'do_subscription_tier'
  }, providerIs(providerDigitalOcean));

  plan.addStep(new WorkflowExecutionStep(
    'Create DigitalOcean Registry',
    'Create a container registry with doctl.',
    'doctl registry create ${registry_name} --region ${do_region} --subscription-tier ${do_subscription_tier}',
    [
      {
        pattern: /already exists|unauthorized|forbidden|error/i,
        description: 'DigitalOcean registry creation failed. Validate token, region, and registry name.'
      }
    ],
    providerIs(providerDigitalOcean)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Verify DigitalOcean Registry',
    'Query the created DigitalOcean registry to confirm provisioning.',
    'doctl registry get ${registry_name}',
    [],
    providerIs(providerDigitalOcean)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Check upctl CLI',
    'Validate that UpCloud CLI is installed and authenticated.',
    'upctl version',
    [
      {
        pattern: /not recognized|command not found|no such file/i,
        description: 'upctl is not available. Install upctl and authenticate first.'
      }
    ],
    providerIs(providerUpCloud)
  ));

  addConditionalTextEntryStep({
    name: 'UpCloud VM Name',
    description: 'Name for VM hosting Docker Distribution registry.',
    title: 'UpCloud VM Name',
    value: '${registry_name}-registry-vm',
    storeAs: 'upcloud_vm_name',
    required: true
  }, providerIs(providerUpCloud));

  addConditionalTextEntryStep({
    name: 'UpCloud Zone',
    description: 'Zone where VM will be created.',
    title: 'UpCloud Zone',
    value: 'fi-hel1',
    storeAs: 'upcloud_zone',
    required: true
  }, providerIs(providerUpCloud));

  addConditionalTextEntryStep({
    name: 'UpCloud VM Plan',
    description: 'VM plan used for registry host.',
    title: 'UpCloud VM Plan',
    value: '1xCPU-2GB',
    storeAs: 'upcloud_plan',
    required: true
  }, providerIs(providerUpCloud));

  addConditionalTextEntryStep({
    name: 'UpCloud SSH Public Key Path',
    description: 'Path to SSH public key to inject to VM.',
    title: 'UpCloud SSH Public Key Path',
    value: '~/.ssh/id_rsa.pub',
    storeAs: 'upcloud_ssh_public_key',
    required: true
  }, providerIs(providerUpCloud));

  plan.addStep(new WorkflowExecutionStep(
    'Create UpCloud VM',
    'Provision a VM that will host Docker Distribution.',
    'upctl server create --hostname ${upcloud_vm_name} --title ${upcloud_vm_name} --zone ${upcloud_zone} --plan ${upcloud_plan} --ssh-keys ${upcloud_ssh_public_key} --wait',
    [
      {
        pattern: /already exists|unauthorized|forbidden|error/i,
        description: 'UpCloud VM creation failed. Check credentials, zone, plan, and SSH key path.'
      }
    ],
    providerIs(providerUpCloud)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Deploy Docker Distribution',
    'Install Docker and run the Docker Distribution registry container on the VM.',
    'upctl server ssh ${upcloud_vm_name} --command "sudo apt-get update && sudo apt-get install -y docker.io && sudo docker run -d --restart always --name registry -p 5000:5000 registry:2"',
    [
      {
        pattern: /not found|permission denied|error/i,
        description: 'Registry deployment on UpCloud VM failed. Verify VM reachability and SSH access.'
      }
    ],
    providerIs(providerUpCloud)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Verify UpCloud Registry Container',
    'Confirm the registry container is running on the VM.',
    'upctl server ssh ${upcloud_vm_name} --command "sudo docker ps --filter name=registry --format \"{{.Names}}\""',
    [
      {
        pattern: /^\s*$/i,
        description: 'Registry container was not detected on the UpCloud VM.'
      }
    ],
    providerIs(providerUpCloud)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Persist Registry Metadata Locally',
    'Save registry metadata to local YAML file for tree view tracking.',
    async context => persistContainerRegistryMetadata(context),
    []
  ));

  return plan;
}

function createContainerDeploymentWorkflowExecutionPlan(): WorkflowExecutionPlan {
  const providerAzure = 'Azure Container Instance';
  const providerAws = 'AWS App Runner';
  const providerGcp = 'Google Cloud Run';
  const providerDigitalOcean = 'DigitalOcean App Platform';
  const providerUpCloud = 'UpCloud VM (Docker)';
  const providerStepVariable = 'deploy_provider';

  const providerIs = (provider: string) =>
    (variables: Record<string, unknown>): boolean => String(variables[providerStepVariable] ?? '') === provider;

  const plan = new WorkflowExecutionPlan(
    'Container Deployment',
    [],
    'Deploy a container workload using provider-specific compute services.',
    'This workflow supports Azure Container Instances, AWS App Runner, Google Cloud Run, DigitalOcean App Platform, and an UpCloud VM with Docker.'
  );

  const addConditionalTextEntryStep = (
    options: Parameters<typeof WorkflowExecutionStep.createTextEntryStep>[0],
    condition: (variables: Record<string, unknown>) => boolean
  ): void => {
    plan.addStep(new WorkflowExecutionStep(
      options.name,
      options.description,
      async context => {
        const value = await context.getInputProvider().textEntry(options, context);

        if (value === null) {
          return {
            success: false,
            output: ['User cancelled text entry.'],
            failureDescription: 'Cancelled by user.'
          };
        }

        if (options.required && value.trim() === '') {
          return {
            success: false,
            output: ['Text value is required but empty.'],
            failureDescription: 'Required input is empty.'
          };
        }

        context.setVariable(options.storeAs, value);
        return {
          success: true,
          output: [`Stored value in variable: ${options.storeAs}`]
        };
      },
      [],
      condition
    ));
  };

  plan.addStep(WorkflowExecutionStep.createSelectionStep({
    name: 'Provider Selection',
    description: 'Choose the provider where the container will run.',
    title: 'Provider Selection',
    placeHolder: 'Select deployment provider',
    options: [providerAzure, providerAws, providerGcp, providerDigitalOcean, providerUpCloud],
    storeAs: providerStepVariable
  }));

  plan.addStep(new WorkflowExecutionStep(
    'Load Registries For Provider',
    'Load local registries for provider plus supported public registries.',
    async context => {
      const deploymentProvider = String(context.getVariable(providerStepVariable) ?? '').trim();
      const registryProvider = getRegistryProviderForDeploymentProvider(deploymentProvider);
      if (!registryProvider) {
        return {
          success: false,
          output: [`No registry provider mapping found for '${deploymentProvider}'.`],
          failureDescription: 'Provider mapping is not available.'
        };
      }

      const entries = readStoredContainerRegistries()
        .filter(entry => entry.provider === registryProvider)
        .sort((a, b) => a.name.localeCompare(b.name));

      const localOptions = entries.map(entry => `Local: ${entry.name}`);
      const publicOptions = PUBLIC_IMAGE_REGISTRIES.map(name => `Public: ${name}`);
      context.setVariable('deploy_registry_options', [...localOptions, ...publicOptions]);
      return {
        success: true,
        output: [
          `Local registries for ${registryProvider}: ${entries.length}`,
          `Public registries available: ${publicOptions.length}`
        ]
      };
    }
  ));

  plan.addStep(WorkflowExecutionStep.createSelectionStep({
    name: 'Registry Selection',
    description: 'Pick a registry to source container images from.',
    title: 'Registry Selection',
    placeHolder: 'Select registry',
    optionsFromVariable: 'deploy_registry_options',
    storeAs: 'deploy_registry_name'
  }));

  plan.addStep(new WorkflowExecutionStep(
    'Resolve Registry Metadata',
    'Resolve provider-specific metadata for the selected registry.',
    async context => {
      const deploymentProvider = String(context.getVariable(providerStepVariable) ?? '').trim();
      const registryProvider = getRegistryProviderForDeploymentProvider(deploymentProvider);
      const selectedName = String(context.getVariable('deploy_registry_name') ?? '').trim();

      if (selectedName.startsWith('Public: ')) {
        const publicSource = selectedName.replace(/^Public:\s*/, '').trim();
        context.setVariable('selected_registry_provider', 'Public Registry');
        context.setVariable('selected_registry_name', publicSource);
        context.setVariable('selected_registry_location', 'global');
        context.setVariable('selected_registry_project_id', '');
        context.setVariable('selected_registry_vm_name', '');
        context.setVariable('selected_registry_resource_group', '');
        context.setVariable('selected_registry_is_public', true);
        return {
          success: true,
          output: [`Registry source: ${publicSource}`, 'Type: Public registry']
        };
      }

      const localRegistryName = selectedName.replace(/^Local:\s*/, '').trim();
      const entry = readStoredContainerRegistries().find(item => item.provider === registryProvider && item.name === localRegistryName);

      if (!entry) {
        return {
          success: false,
          output: [`Registry '${selectedName}' not found in local store.`],
          failureDescription: 'Selected registry metadata is missing.'
        };
      }

      context.setVariable('selected_registry_provider', entry.provider);
      context.setVariable('selected_registry_name', entry.name);
      context.setVariable('selected_registry_location', entry.location);
      context.setVariable('selected_registry_project_id', entry.projectId ?? '');
      context.setVariable('selected_registry_vm_name', entry.vmName ?? '');
      context.setVariable('selected_registry_resource_group', entry.resourceGroup ?? '');
      context.setVariable('selected_registry_is_public', false);

      return {
        success: true,
        output: [`Registry: ${entry.name}`, `Provider: ${entry.provider}`, `Location: ${entry.location}`]
      };
    }
  ));

  plan.addStep(WorkflowExecutionStep.createTextEntryStep({
    name: 'Image Filter',
    description: 'Optional filter used when querying images from selected registry.',
    title: 'Image Filter',
    placeHolder: 'e.g. api or web',
    storeAs: 'image_filter',
    required: false
  }));

  plan.addStep(new WorkflowExecutionStep(
    'Query Available Images',
    'Query a limited image list from selected registry.',
    async context => {
      const provider = String(context.getVariable('selected_registry_provider') ?? '').trim();
      const name = String(context.getVariable('selected_registry_name') ?? '').trim();
      const location = String(context.getVariable('selected_registry_location') ?? '').trim();
      const projectId = String(context.getVariable('selected_registry_project_id') ?? '').trim();
      const vmName = String(context.getVariable('selected_registry_vm_name') ?? '').trim();
      const filter = String(context.getVariable('image_filter') ?? '').trim().toLowerCase();
      const isPublic = context.getVariable('selected_registry_is_public') === true;

      const queried = isPublic
        ? await queryPublicRegistryImageCandidates(name, filter, 25)
        : await queryRegistryImageCandidates(provider, name, location, projectId, vmName, 25);

      const filtered = queried
        .filter(item => filter === '' || item.toLowerCase().includes(filter))
        .slice(0, 25);

      const finalFallback = isPublic ? inferDefaultPublicImage(name) : `${name}:latest`;
      const finalList = filtered.length > 0 ? filtered : [finalFallback];
      context.setVariable('deploy_image_options', finalList);

      return {
        success: true,
        output: [`Available images: ${finalList.length}${filter ? ` (filtered by '${filter}')` : ''}`]
      };
    }
  ));

  plan.addStep(WorkflowExecutionStep.createSelectionStep({
    name: 'Container Image',
    description: 'Choose container image from selected registry list. Type to filter in the picker.',
    title: 'Container Image',
    placeHolder: 'Select image',
    optionsFromVariable: 'deploy_image_options',
    storeAs: 'container_image'
  }));

  plan.addStep(WorkflowExecutionStep.createConfirmStep({
    name: 'Use Selected Image',
    description: 'Keep selected image or switch to a custom image reference.',
    message: 'Use selected image ${container_image}? Choose Cancel to enter a custom image reference.',
    confirmLabel: 'Use Selected',
    cancelLabel: 'Use Custom',
    storeResultAs: 'use_selected_image'
  }));

  addConditionalTextEntryStep({
    name: 'Custom Container Image',
    description: 'Override with a manually entered container image reference.',
    title: 'Custom Container Image',
    placeHolder: 'e.g. ghcr.io/my-org/my-app:1.2.3',
    valueFromVariable: 'container_image',
    storeAs: 'container_image',
    required: true
  }, (variables: Record<string, unknown>) => variables.use_selected_image !== true);

  plan.addStep(WorkflowExecutionStep.createTextEntryStep({
    name: 'Container Name',
    description: 'Name used by provider-specific deployment target.',
    title: 'Container Name',
    placeHolder: 'e.g. hello-app',
    storeAs: 'container_name',
    required: true
  }));

  plan.addStep(WorkflowExecutionStep.createTextEntryStep({
    name: 'Container Port',
    description: 'Container port exposed by the workload.',
    title: 'Container Port',
    placeHolder: 'e.g. 80',
    value: '80',
    storeAs: 'container_port',
    required: true
  }));

  plan.addStep(new WorkflowExecutionStep(
    'Check Azure CLI',
    'Validate Azure CLI availability for Azure Container Instance deployment.',
    'az --version',
    [
      {
        pattern: /not recognized|command not found|no such file/i,
        description: 'Azure CLI is not available. Install Azure CLI and authenticate with az login.'
      }
    ],
    providerIs(providerAzure)
  ));

  addConditionalTextEntryStep({
    name: 'Azure Resource Group',
    description: 'Resource group that will host the container instance.',
    title: 'Azure Resource Group',
    placeHolder: 'e.g. rg-containers',
    storeAs: 'azure_resource_group',
    required: true
  }, providerIs(providerAzure));

  addConditionalTextEntryStep({
    name: 'Azure Location',
    description: 'Azure region for Azure Container Instance.',
    title: 'Azure Location',
    placeHolder: 'e.g. eastus',
    value: 'eastus',
    storeAs: 'azure_location',
    required: true
  }, providerIs(providerAzure));

  addConditionalTextEntryStep({
    name: 'Azure DNS Label',
    description: 'Public DNS label for the Azure Container Instance endpoint.',
    title: 'Azure DNS Label',
    value: '${container_name}',
    storeAs: 'azure_dns_label',
    required: true
  }, providerIs(providerAzure));

  plan.addStep(new WorkflowExecutionStep(
    'Deploy Azure Container Instance',
    'Deploy container image to Azure Container Instances.',
    'az container create --resource-group ${azure_resource_group} --name ${container_name} --image ${container_image} --ports ${container_port} --dns-name-label ${azure_dns_label} --location ${azure_location} --restart-policy Always',
    [
      {
        pattern: /invalid|error|failed/i,
        description: 'Azure Container Instance deployment failed. Validate image, region, and resource group permissions.'
      }
    ],
    providerIs(providerAzure)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Verify Azure Container Instance',
    'Confirm Azure container instance is provisioned.',
    'az container show --resource-group ${azure_resource_group} --name ${container_name}',
    [],
    providerIs(providerAzure)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Check AWS CLI',
    'Validate AWS CLI availability for App Runner deployment.',
    'aws --version',
    [
      {
        pattern: /not recognized|command not found|no such file/i,
        description: 'AWS CLI is not available. Install AWS CLI and configure credentials.'
      }
    ],
    providerIs(providerAws)
  ));

  addConditionalTextEntryStep({
    name: 'AWS Region',
    description: 'AWS region where App Runner service will be deployed.',
    title: 'AWS Region',
    placeHolder: 'e.g. us-east-1',
    value: 'us-east-1',
    storeAs: 'aws_region',
    required: true
  }, providerIs(providerAws));

  addConditionalTextEntryStep({
    name: 'AWS App Runner Service Name',
    description: 'Service name for App Runner deployment.',
    title: 'AWS App Runner Service Name',
    value: '${container_name}',
    storeAs: 'aws_service_name',
    required: true
  }, providerIs(providerAws));

  plan.addStep(new WorkflowExecutionStep(
    'Deploy AWS App Runner Service',
    'Deploy container image to AWS App Runner (ECR Public image flow).',
    'aws apprunner create-service --service-name ${aws_service_name} --source-configuration "ImageRepository={ImageIdentifier=${container_image},ImageRepositoryType=ECR_PUBLIC,ImageConfiguration={Port=${container_port}}}" --region ${aws_region}',
    [
      {
        pattern: /AccessDenied|ValidationException|error|failed/i,
        description: 'AWS App Runner deployment failed. Validate region, image reference, and IAM permissions.'
      }
    ],
    providerIs(providerAws)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Verify AWS App Runner Service',
    'Confirm App Runner service appears in service list.',
    'aws apprunner list-services --region ${aws_region} --query "ServiceSummaryList[?ServiceName==\'${aws_service_name}\'].ServiceName" --output text',
    [],
    providerIs(providerAws)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Check gcloud CLI',
    'Validate gcloud CLI availability for Cloud Run deployment.',
    'gcloud --version',
    [
      {
        pattern: /not recognized|command not found|no such file/i,
        description: 'gcloud CLI is not available. Install gcloud CLI and authenticate first.'
      }
    ],
    providerIs(providerGcp)
  ));

  addConditionalTextEntryStep({
    name: 'GCP Project ID',
    description: 'Google Cloud project where Cloud Run service will be deployed.',
    title: 'GCP Project ID',
    placeHolder: 'e.g. my-gcp-project',
    storeAs: 'gcp_project_id',
    required: true
  }, providerIs(providerGcp));

  addConditionalTextEntryStep({
    name: 'GCP Location',
    description: 'Google Cloud region for Cloud Run.',
    title: 'GCP Location',
    placeHolder: 'e.g. us-central1',
    value: 'us-central1',
    storeAs: 'gcp_location',
    required: true
  }, providerIs(providerGcp));

  plan.addStep(new WorkflowExecutionStep(
    'Deploy Cloud Run Service',
    'Deploy container image to Google Cloud Run.',
    'gcloud run deploy ${container_name} --image=${container_image} --port=${container_port} --region=${gcp_location} --project=${gcp_project_id} --platform=managed --allow-unauthenticated --quiet',
    [
      {
        pattern: /PERMISSION_DENIED|NOT_FOUND|invalid|error/i,
        description: 'Cloud Run deployment failed. Validate project, location, image, and IAM permissions.'
      }
    ],
    providerIs(providerGcp)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Verify Cloud Run Service',
    'Confirm Cloud Run service is available.',
    'gcloud run services describe ${container_name} --region=${gcp_location} --project=${gcp_project_id} --platform=managed',
    [],
    providerIs(providerGcp)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Check doctl CLI',
    'Validate doctl CLI availability for DigitalOcean App Platform deployment.',
    'doctl version',
    [
      {
        pattern: /not recognized|command not found|no such file/i,
        description: 'doctl is not available. Install doctl and authenticate first.'
      }
    ],
    providerIs(providerDigitalOcean)
  ));

  addConditionalTextEntryStep({
    name: 'DigitalOcean App Spec Path',
    description: 'Path to doctl app spec that defines your container deployment.',
    title: 'DigitalOcean App Spec Path',
    placeHolder: 'e.g. .do/app.yaml',
    storeAs: 'do_app_spec_path',
    required: true
  }, providerIs(providerDigitalOcean));

  plan.addStep(new WorkflowExecutionStep(
    'Deploy DigitalOcean App Platform App',
    'Deploy container using doctl app spec.',
    'doctl apps create --spec ${do_app_spec_path}',
    [
      {
        pattern: /not found|invalid|error|failed/i,
        description: 'DigitalOcean deployment failed. Validate doctl auth and app spec file path.'
      }
    ],
    providerIs(providerDigitalOcean)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Verify DigitalOcean App Platform Deployment',
    'Confirm DigitalOcean app list is accessible after deployment.',
    'doctl apps list',
    [],
    providerIs(providerDigitalOcean)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Check upctl CLI',
    'Validate upctl CLI availability for VM-based deployment.',
    'upctl version',
    [
      {
        pattern: /not recognized|command not found|no such file/i,
        description: 'upctl is not available. Install upctl and authenticate first.'
      }
    ],
    providerIs(providerUpCloud)
  ));

  addConditionalTextEntryStep({
    name: 'UpCloud VM Name',
    description: 'VM host name for container deployment.',
    title: 'UpCloud VM Name',
    value: '${container_name}-host',
    storeAs: 'upcloud_vm_name',
    required: true
  }, providerIs(providerUpCloud));

  addConditionalTextEntryStep({
    name: 'UpCloud Zone',
    description: 'UpCloud zone where VM will be created.',
    title: 'UpCloud Zone',
    value: 'fi-hel1',
    storeAs: 'upcloud_zone',
    required: true
  }, providerIs(providerUpCloud));

  addConditionalTextEntryStep({
    name: 'UpCloud VM Plan',
    description: 'VM plan for container host.',
    title: 'UpCloud VM Plan',
    value: '1xCPU-2GB',
    storeAs: 'upcloud_plan',
    required: true
  }, providerIs(providerUpCloud));

  addConditionalTextEntryStep({
    name: 'UpCloud SSH Public Key Path',
    description: 'SSH public key path injected into the VM.',
    title: 'UpCloud SSH Public Key Path',
    value: '~/.ssh/id_rsa.pub',
    storeAs: 'upcloud_ssh_public_key',
    required: true
  }, providerIs(providerUpCloud));

  plan.addStep(new WorkflowExecutionStep(
    'Create UpCloud VM Host',
    'Provision an UpCloud VM to host Docker workload.',
    'upctl server create --hostname ${upcloud_vm_name} --title ${upcloud_vm_name} --zone ${upcloud_zone} --plan ${upcloud_plan} --ssh-keys ${upcloud_ssh_public_key} --wait',
    [
      {
        pattern: /already exists|unauthorized|forbidden|error/i,
        description: 'UpCloud VM creation failed. Validate credentials, zone, plan, and SSH key path.'
      }
    ],
    providerIs(providerUpCloud)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Deploy Container on UpCloud VM',
    'Install Docker and run target container on UpCloud VM.',
    'upctl server ssh ${upcloud_vm_name} --command "sudo apt-get update && sudo apt-get install -y docker.io && sudo docker rm -f ${container_name} 2>/dev/null || true && sudo docker run -d --restart always --name ${container_name} -p ${container_port}:${container_port} ${container_image}"',
    [
      {
        pattern: /not found|permission denied|error|failed/i,
        description: 'UpCloud container deployment failed. Verify VM access, image reference, and port values.'
      }
    ],
    providerIs(providerUpCloud)
  ));

  plan.addStep(new WorkflowExecutionStep(
    'Verify UpCloud Container',
    'Confirm target container is running on UpCloud VM.',
    'upctl server ssh ${upcloud_vm_name} --command "sudo docker ps --filter name=${container_name} --format \"{{.Names}}\""',
    [],
    providerIs(providerUpCloud)
  ));

  return plan;
}

function getRegistryProviderForDeploymentProvider(deploymentProvider: string): string {
  if (deploymentProvider === 'Azure Container Instance') {
    return 'Azure ACR';
  }
  if (deploymentProvider === 'AWS App Runner') {
    return 'AWS ECR';
  }
  if (deploymentProvider === 'Google Cloud Run') {
    return 'GCP Artifact Registry';
  }
  if (deploymentProvider === 'DigitalOcean App Platform') {
    return 'DigitalOcean Container Registry';
  }
  if (deploymentProvider === 'UpCloud VM (Docker)') {
    return 'UpCloud VM with Docker Distribution';
  }
  return '';
}

async function queryRegistryImageCandidates(
  provider: string,
  registryName: string,
  location: string,
  projectId: string,
  vmName: string,
  maxCount: number
): Promise<string[]> {
  if (provider === 'Azure ACR') {
    const output = await executeCommand(`az acr repository list --name ${registryName} --top ${maxCount} --output tsv`, true);
    return normalizeImageCandidates(output, maxCount, item => item.includes(':') ? item : `${item}:latest`);
  }

  if (provider === 'AWS ECR') {
    const region = location || 'us-east-1';
    const tags = await executeCommand(
      `aws ecr list-images --repository-name ${registryName} --region ${region} --query "imageIds[?imageTag!=null].imageTag" --output text`,
      true
    );
    return normalizeImageCandidates(tags, maxCount, tag => `${registryName}:${tag}`);
  }

  if (provider === 'GCP Artifact Registry') {
    if (!location || !projectId || !registryName) {
      return [`${location || '<region>'}-docker.pkg.dev/${projectId || '<project>'}/${registryName || '<repo>'}/image:latest`];
    }

    const host = `${location}-docker.pkg.dev/${projectId}/${registryName}`;
    const output = await executeCommand(
      `gcloud artifacts docker images list ${host} --include-tags --limit=${maxCount} --format="value(IMAGE)"`,
      true
    );
    return normalizeImageCandidates(output, maxCount);
  }

  if (provider === 'DigitalOcean Container Registry') {
    const output = await executeCommand(`doctl registry repository list-v2 ${registryName} --format Name --no-header`, true);
    return normalizeImageCandidates(output, maxCount, item => `${registryName}/${item}:latest`);
  }

  if (provider === 'UpCloud VM with Docker Distribution') {
    const host = vmName || '<upcloud-vm-host>';
    const output = await executeCommand(
      `upctl server ssh ${vmName} --command "curl -fsS http://localhost:5000/v2/_catalog | jq -r '.repositories[]'"`,
      true
    );
    const values = normalizeImageCandidates(output, maxCount, item => `${host}:5000/${item}:latest`);
    if (values.length > 0) {
      return values;
    }
    return [`${host}:5000/${registryName}:latest`];
  }

  return [`${registryName}:latest`];
}

async function queryPublicRegistryImageCandidates(source: string, filter: string, maxCount: number): Promise<string[]> {
  if (source === 'Docker Hub') {
    const query = filter || 'nginx';
    const output = await executeCommand(`docker search --limit ${maxCount} ${query}`, true);
    const parsed = normalizeDockerSearchResults(output, maxCount);
    if (parsed.length > 0) {
      return parsed;
    }
  }

  const seeded = getPublicRegistrySeedImages(source)
    .filter(image => filter === '' || image.toLowerCase().includes(filter.toLowerCase()))
    .slice(0, maxCount);

  if (seeded.length > 0) {
    return seeded;
  }

  return [inferDefaultPublicImage(source)];
}

function normalizeDockerSearchResults(output: string[] | false, maxCount: number): string[] {
  if (!output || output.length === 0) {
    return [];
  }

  const rows = output
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => !line.startsWith('NAME'));

  const names = rows
    .map(row => row.split(/\s+/)[0])
    .filter(value => value.length > 0)
    .map(name => `${name}:latest`);

  return Array.from(new Set(names)).slice(0, maxCount);
}

function inferDefaultPublicImage(source: string): string {
  const defaults: Record<string, string> = {
    'Docker Hub': 'nginx:latest',
    'GitHub Container Registry': 'ghcr.io/github/super-linter:latest',
    'Quay.io': 'quay.io/prometheus/prometheus:latest',
    'Google Container Registry': 'gcr.io/google-containers/pause:3.9',
    'Microsoft Container Registry': 'mcr.microsoft.com/dotnet/aspnet:8.0',
    'Distroless / Chainguard': 'cgr.dev/chainguard/nginx:latest',
    'Red Hat public registry': 'registry.access.redhat.com/ubi9/ubi:latest'
  };

  return defaults[source] ?? 'nginx:latest';
}

function getPublicRegistrySeedImages(source: string): string[] {
  if (source === 'GitHub Container Registry') {
    return [
      'ghcr.io/github/super-linter:latest',
      'ghcr.io/actions/actions-runner:latest',
      'ghcr.io/stargz-containers/python:3.11-org'
    ];
  }

  if (source === 'Quay.io') {
    return [
      'quay.io/prometheus/prometheus:latest',
      'quay.io/keycloak/keycloak:latest',
      'quay.io/centos/centos:stream9'
    ];
  }

  if (source === 'Google Container Registry') {
    return [
      'gcr.io/google-containers/pause:3.9',
      'gcr.io/distroless/base:latest',
      'gcr.io/distroless/static:latest'
    ];
  }

  if (source === 'Microsoft Container Registry') {
    return [
      'mcr.microsoft.com/dotnet/aspnet:8.0',
      'mcr.microsoft.com/dotnet/runtime:8.0',
      'mcr.microsoft.com/oss/nginx/nginx:1.25.3'
    ];
  }

  if (source === 'Distroless / Chainguard') {
    return [
      'cgr.dev/chainguard/nginx:latest',
      'cgr.dev/chainguard/python:latest',
      'gcr.io/distroless/base:latest'
    ];
  }

  if (source === 'Red Hat public registry') {
    return [
      'registry.access.redhat.com/ubi9/ubi:latest',
      'registry.access.redhat.com/ubi9/python-311:latest',
      'registry.access.redhat.com/ubi9/nodejs-20:latest'
    ];
  }

  return [];
}

function normalizeImageCandidates(
  output: string[] | false,
  maxCount: number,
  mapItem: (value: string) => string = (value) => value
): string[] {
  if (!output || output.length === 0) {
    return [];
  }

  const values = output
    .flatMap(line => line.split(/[\s\t,]+/))
    .map(item => item.trim())
    .filter(item => item.length > 0)
    .filter(item => !/error|failed|exception|traceback/i.test(item))
    .map(mapItem);

  const unique = Array.from(new Set(values));
  return unique.slice(0, maxCount);
}

function persistContainerRegistryMetadata(context: { getVariable(name: string): unknown }): { success: boolean; output?: string[]; failureDescription?: string } {
  const provider = String(context.getVariable('registry_provider') ?? '').trim();
  const registryName = String(context.getVariable('registry_name') ?? '').trim();

  if (!provider || !registryName) {
    return {
      success: false,
      output: ['Missing provider or registry name.'],
      failureDescription: 'Unable to persist metadata without provider and registry name.'
    };
  }

  const filePath = getLocalRegistryFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const nowIso = new Date().toISOString();
  const location = firstNonEmptyString([
    context.getVariable('azure_location'),
    context.getVariable('aws_region'),
    context.getVariable('gcp_location'),
    context.getVariable('do_region'),
    context.getVariable('upcloud_zone')
  ]);
  const resourceGroup = firstNonEmptyString([context.getVariable('azure_resource_group')]);
  const projectId = firstNonEmptyString([context.getVariable('gcp_project_id')]);
  const vmName = firstNonEmptyString([context.getVariable('upcloud_vm_name')]);

  const entries = readStoredContainerRegistries();
  const existingIndex = entries.findIndex(entry =>
    entry.provider.toLowerCase() === provider.toLowerCase()
    && entry.name.toLowerCase() === registryName.toLowerCase());

  const existing = existingIndex >= 0 ? entries[existingIndex] : undefined;
  const entry: LocalContainerRegistryEntry = {
    id: existing?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: registryName,
    provider,
    location: location || existing?.location || 'n/a',
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso
  };

  if (resourceGroup) {
    entry.resourceGroup = resourceGroup;
  }
  if (projectId) {
    entry.projectId = projectId;
  }
  if (vmName) {
    entry.vmName = vmName;
  }

  if (existingIndex >= 0) {
    entries[existingIndex] = entry;
  } else {
    entries.push(entry);
  }

  writeStoredContainerRegistries(entries);

  return {
    success: true,
    output: [
      `${existingIndex >= 0 ? 'Updated' : 'Stored'} registry metadata for '${registryName}'.`,
      `Metadata file: ${filePath}`
    ]
  };
}

function getLocalRegistryFilePath(): string {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    return path.join(workspaceRoot, LOCAL_REGISTRY_YAML_RELATIVE_PATH);
  }

  return path.join(process.cwd(), LOCAL_REGISTRY_YAML_RELATIVE_PATH);
}

function readStoredContainerRegistries(): LocalContainerRegistryEntry[] {
  const filePath = getLocalRegistryFilePath();
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const items: LocalContainerRegistryEntry[] = [];
  let current: Record<string, string> | null = null;

  for (const line of lines) {
    const startMatch = line.match(/^\s*-\s+id:\s*(.+)$/);
    if (startMatch) {
      if (current) {
        items.push(normalizeLocalRegistryEntry(current));
      }
      current = { id: parseYamlScalar(startMatch[1]) };
      continue;
    }

    if (!current) {
      continue;
    }

    const fieldMatch = line.match(/^\s+([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!fieldMatch) {
      continue;
    }

    const key = fieldMatch[1];
    const value = parseYamlScalar(fieldMatch[2]);
    current[key] = value;
  }

  if (current) {
    items.push(normalizeLocalRegistryEntry(current));
  }

  return items;
}

function writeStoredContainerRegistries(entries: LocalContainerRegistryEntry[]): void {
  const filePath = getLocalRegistryFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const lines: string[] = ['registries:'];
  for (const entry of entries) {
    lines.push(`  - id: '${escapeYamlString(entry.id)}'`);
    lines.push(`    name: '${escapeYamlString(entry.name)}'`);
    lines.push(`    provider: '${escapeYamlString(entry.provider)}'`);
    lines.push(`    location: '${escapeYamlString(entry.location)}'`);
    lines.push(`    createdAt: '${escapeYamlString(entry.createdAt)}'`);
    lines.push(`    updatedAt: '${escapeYamlString(entry.updatedAt)}'`);

    const extraKeys = Object.keys(entry)
      .filter(key => !['id', 'name', 'provider', 'location', 'createdAt', 'updatedAt'].includes(key))
      .sort((a, b) => a.localeCompare(b));

    for (const key of extraKeys) {
      lines.push(`    ${key}: '${escapeYamlString(entry[key])}'`);
    }
  }

  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function normalizeLocalRegistryEntry(entry: Record<string, string>): LocalContainerRegistryEntry {
  const nowIso = new Date().toISOString();
  return {
    id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: entry.name || 'Unnamed Registry',
    provider: entry.provider || 'Unknown provider',
    location: entry.location || 'n/a',
    createdAt: entry.createdAt || nowIso,
    updatedAt: entry.updatedAt || entry.createdAt || nowIso,
    ...entry
  };
}

function removeStoredContainerRegistry(id: string, provider: string, name: string): boolean {
  const entries = readStoredContainerRegistries();
  const originalLength = entries.length;
  const remaining = entries.filter(entry => {
    if (id && entry.id === id) {
      return false;
    }

    return !(
      entry.provider.toLowerCase() === provider.toLowerCase()
      && entry.name.toLowerCase() === name.toLowerCase()
    );
  });

  if (remaining.length === originalLength) {
    return false;
  }

  writeStoredContainerRegistries(remaining);
  return true;
}

async function copyRegistryLoginCommand(node: TreeNode): Promise<void> {
  const provider = String(node.raw.provider ?? '').trim();
  const name = String(node.raw.name ?? node.name).trim();
  const location = String(node.raw.location ?? '').trim();
  const projectId = String(node.raw.projectId ?? '').trim();
  const vmName = String(node.raw.vmName ?? '').trim();

  const command = buildRegistryLoginCommand(provider, name, location, projectId, vmName);
  await vscode.env.clipboard.writeText(command);
  vscode.window.showInformationMessage(`Docker Runner: login command copied for '${name}'.`);
}

function buildRegistryLoginCommand(provider: string, name: string, location: string, projectId: string, vmName: string): string {
  if (provider === 'Azure ACR') {
    return `az acr login --name ${name}`;
  }

  if (provider === 'AWS ECR') {
    const region = location || '<aws-region>';
    return `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin <aws-account-id>.dkr.ecr.${region}.amazonaws.com`;
  }

  if (provider === 'GCP Artifact Registry') {
    const host = location ? `${location}-docker.pkg.dev` : '<region>-docker.pkg.dev';
    const project = projectId || '<gcp-project-id>';
    return `gcloud auth configure-docker ${host} ; docker login ${host}/${project}`;
  }

  if (provider === 'DigitalOcean Container Registry') {
    return 'doctl registry login';
  }

  if (provider === 'UpCloud VM with Docker Distribution') {
    const host = vmName || '<upcloud-vm-ip-or-host>';
    return `docker login ${host}:5000`;
  }

  return 'docker login <registry-host>';
}

async function openRegistryConsole(node: TreeNode): Promise<void> {
  const provider = String(node.raw.provider ?? '').trim();
  const name = String(node.raw.name ?? node.name).trim();
  const location = String(node.raw.location ?? '').trim();
  const projectId = String(node.raw.projectId ?? '').trim();

  const url = buildRegistryConsoleUrl(provider, name, location, projectId);
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

function buildRegistryConsoleUrl(provider: string, name: string, location: string, projectId: string): string {
  if (provider === 'Azure ACR') {
    return `https://portal.azure.com/#search/${encodeURIComponent(name)}`;
  }

  if (provider === 'AWS ECR') {
    const region = location || 'us-east-1';
    return `https://${region}.console.aws.amazon.com/ecr/repositories`;
  }

  if (provider === 'GCP Artifact Registry') {
    const projectQuery = projectId ? `?project=${encodeURIComponent(projectId)}` : '';
    return `https://console.cloud.google.com/artifacts${projectQuery}`;
  }

  if (provider === 'DigitalOcean Container Registry') {
    return 'https://cloud.digitalocean.com/registry';
  }

  if (provider === 'UpCloud VM with Docker Distribution') {
    return 'https://hub.upcloud.com/';
  }

  return 'https://www.google.com';
}

function parseYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function escapeYamlString(value: string): string {
  return value.replace(/'/g, "''");
}

function firstNonEmptyString(values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return '';
}
