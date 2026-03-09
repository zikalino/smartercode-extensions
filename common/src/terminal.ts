import * as vscode from 'vscode';
import { stripVTControlCharacters } from 'node:util';

let startingShell = false;
let terminal: vscode.Terminal | null = null;
let shell: vscode.TerminalShellIntegration | null = null;

export function terminalChangedShellIntegration(shellIntegration: vscode.TerminalShellIntegration): void {
  if (startingShell && shell !== shellIntegration) {
    shell = shellIntegration;
  }
}

export function terminalDidClose(closedTerminal: vscode.Terminal): void {
  if (closedTerminal === terminal) {
    terminal = null;
    shell = null;
    startingShell = false;
  }
}

export async function executeCommand(cmd: string, ignoreFailure = false): Promise<string[] | false> {
  await ensureShell();
  if (!shell) {
    return false;
  }

  const command = shell.executeCommand(cmd);

  const exitStatusPromise: Promise<vscode.TerminalShellExecutionEndEvent> = new Promise(resolve => {
    const disposable = vscode.window.onDidEndTerminalShellExecution(event => {
      if (event.execution.commandLine.value === cmd) {
        disposable.dispose();
        resolve(event);
      }
    });
  });

  let response = '';
  for await (const chunk of command.read()) {
    response += chunk;
  }
  response = stripVTControlCharacters(response);

  const executionEndEvent = await exitStatusPromise;
  const exitStatus = executionEndEvent.exitCode === 0;

  if (exitStatus || ignoreFailure) {
    if (!response) {
      response = 'OK';
    }
    return response.split(/\r?\n/).filter(line => line.length > 0);
  }

  return false;
}

export function getShellCwd(): string {
  if (terminal?.shellIntegration) {
    return terminal.shellIntegration.cwd?.fsPath ?? '';
  }

  return '';
}

async function ensureShell(): Promise<void> {
  if (shell === null && !startingShell) {
    startingShell = true;
    terminal = vscode.window.createTerminal({
      name: 'SmarterCode Workflow',
      shellPath: process.platform === 'win32'
        ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
        : '/bin/bash',
      shellArgs: []
    });
    terminal.show();
  }

  while (shell === null) {
    if (terminal?.shellIntegration) {
      shell = terminal.shellIntegration;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
