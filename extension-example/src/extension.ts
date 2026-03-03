import * as vscode from 'vscode';
import { buildExtensionGreeting } from '@upcloud/common';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('extensionExample.hello', () => {
    vscode.window.showInformationMessage(buildExtensionGreeting('extension-example'));
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // no-op
}
