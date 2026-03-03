import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  getDescriptionFromRecord,
  getLabelFromRecord,
  ResourceRecord,
  toPrettyJson
} from '@upcloud/common';

const execFileAsync = promisify(execFile);

type NodeType = 'category' | 'resource' | 'info' | 'error';

interface CategoryDefinition {
  label: string;
  args: string[];
  icon: vscode.ThemeIcon;
}

class UpcloudTreeItem extends vscode.TreeItem {
  constructor(
    public readonly nodeType: NodeType,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly category?: CategoryDefinition,
    public readonly resource?: ResourceRecord
  ) {
    super(label, collapsibleState);
  }
}

class UpcloudResourceProvider implements vscode.TreeDataProvider<UpcloudTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<UpcloudTreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly categories: CategoryDefinition[] = [
    { label: 'Servers', args: ['server', 'list'], icon: new vscode.ThemeIcon('vm') },
    { label: 'Storages', args: ['storage', 'list'], icon: new vscode.ThemeIcon('database') },
    { label: 'Networks', args: ['network', 'list'], icon: new vscode.ThemeIcon('organization') },
    { label: 'Load Balancers', args: ['load-balancer', 'list'], icon: new vscode.ThemeIcon('settings-gear') },
    { label: 'Databases', args: ['database', 'list'], icon: new vscode.ThemeIcon('server-environment') },
    { label: 'Kubernetes', args: ['kubernetes', 'list'], icon: new vscode.ThemeIcon('symbol-namespace') },
    { label: 'Object Storage', args: ['object-storage', 'list'], icon: new vscode.ThemeIcon('package') },
    { label: 'File Storage', args: ['file-storage', 'list'], icon: new vscode.ThemeIcon('files') },
    { label: 'IP Addresses', args: ['ip-address', 'list'], icon: new vscode.ThemeIcon('globe') }
  ];

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: UpcloudTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: UpcloudTreeItem): Promise<UpcloudTreeItem[]> {
    if (!element) {
      return this.categories.map((category) => {
        const item = new UpcloudTreeItem(
          'category',
          category.label,
          vscode.TreeItemCollapsibleState.Collapsed,
          category
        );
        item.contextValue = 'upcloudCategory';
        item.iconPath = category.icon;
        item.description = `${category.args.join(' ')}`;
        return item;
      });
    }

    if (element.nodeType !== 'category' || !element.category) {
      return [];
    }

    const commandArgs = [...element.category.args, '--output', 'json'];

    try {
      const records = await runUpctlList(commandArgs);
      if (records.length === 0) {
        const emptyItem = new UpcloudTreeItem(
          'info',
          'No resources found',
          vscode.TreeItemCollapsibleState.None,
          element.category
        );
        emptyItem.iconPath = new vscode.ThemeIcon('circle-slash');
        return [emptyItem];
      }

      return records.map((record) => {
        const label = getLabelFromRecord(record);
        const item = new UpcloudTreeItem(
          'resource',
          label,
          vscode.TreeItemCollapsibleState.None,
          element.category,
          record
        );
        item.iconPath = new vscode.ThemeIcon('symbol-object');
        item.description = getDescriptionFromRecord(record);
        item.tooltip = new vscode.MarkdownString(`\`\`\`json\n${toPrettyJson(record)}\n\`\`\``);
        return item;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const errorItem = new UpcloudTreeItem(
        'error',
        `Failed: ${message}`,
        vscode.TreeItemCollapsibleState.None,
        element.category
      );
      errorItem.iconPath = new vscode.ThemeIcon('error');
      return [errorItem];
    }
  }
}

async function runUpctlList(args: string[]): Promise<ResourceRecord[]> {
  const { stdout } = await execFileAsync('upctl', args, {
    timeout: 20_000,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  });

  const parsed = JSON.parse(stdout) as unknown;
  return extractRecords(parsed);
}

function extractRecords(input: unknown): ResourceRecord[] {
  if (Array.isArray(input)) {
    return input.filter(isRecord);
  }

  if (!isRecord(input)) {
    return [];
  }

  const preferredKeys = [
    'servers',
    'storages',
    'networks',
    'load_balancers',
    'loadBalancers',
    'databases',
    'kubernetes_clusters',
    'kubernetesClusters',
    'object_storages',
    'objectStorages',
    'file_storages',
    'fileStorages',
    'ip_addresses',
    'ipAddresses'
  ];

  for (const key of preferredKeys) {
    const value = input[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  const queue: unknown[] = [input];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);

    if (Array.isArray(current)) {
      const records = current.filter(isRecord);
      if (records.length > 0) {
        return records;
      }
      continue;
    }

    if (isRecord(current)) {
      for (const value of Object.values(current)) {
        if (typeof value === 'object' && value !== null) {
          queue.push(value);
        }
      }
    }
  }

  return [];
}

function isRecord(value: unknown): value is ResourceRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new UpcloudResourceProvider();

  const tree = vscode.window.createTreeView('upcloudResourceManager', {
    treeDataProvider: provider,
    showCollapseAll: true
  });

  context.subscriptions.push(tree);

  context.subscriptions.push(
    vscode.commands.registerCommand('upcloudExplorer.refresh', () => {
      provider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('upcloudExplorer.runUpctl', (item?: UpcloudTreeItem) => {
      if (!item?.category) {
        return;
      }

      const commandText = ['upctl', ...item.category.args].join(' ');
      const terminal = vscode.window.createTerminal('UpCloud upctl');
      terminal.show(true);
      terminal.sendText(commandText);
    })
  );
}

export function deactivate(): void {
  // no-op
}
