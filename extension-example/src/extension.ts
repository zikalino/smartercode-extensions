import * as vscode from 'vscode';
import { GitGraphPanel } from './gitGraphPanel';

const OPEN_DESIGNER_COMMAND = 'extensionExample.openDiagramDesigner';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(OPEN_DESIGNER_COMMAND, () => {
    GitGraphPanel.createOrShow(context);
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
}
