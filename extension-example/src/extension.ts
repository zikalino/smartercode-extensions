import * as vscode from 'vscode';
import { GitGraphPanel } from '@upcloud/common';

const OPEN_DESIGNER_COMMAND = 'extensionExample.openDiagramDesigner';

export function activate(context: vscode.ExtensionContext): void {
  const gitGraphPanel = new GitGraphPanel({
    panelId: 'extensionExample.gitGraph',
    title: 'Git Commit Graph',
    branchLaneDistance: 100,
    strokeWidth: 2.5,
    onCommitClick: (commitId, branch) => {
      void vscode.window.showInformationMessage(`Clicked ${commitId} on ${branch}`);
    }
  });

  const disposable = vscode.commands.registerCommand(OPEN_DESIGNER_COMMAND, () => {
    gitGraphPanel.show(`%%{init: {'gitGraph': {'mainBranchName': 'main'}} }%%
gitGraph
  commit id: "Initial"
  branch feature/auth
  checkout feature/auth
  commit id: "Login UI"
  commit id: "OAuth"
  checkout main
  commit id: "Hotfix"
  merge feature/auth
  commit id: "Release v1.1"`);
  });

  context.subscriptions.push(disposable, gitGraphPanel);
}

export function deactivate(): void {
}
