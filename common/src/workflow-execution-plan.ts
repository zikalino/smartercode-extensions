import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { executeCommand } from './terminal';

export type WorkflowStepStatus = 'successful' | 'failed' | 'running' | 'not-executed';

export interface WorkflowFailurePattern {
  pattern: RegExp;
  description: string;
}

export interface WorkflowStepExecutionResult {
  success: boolean;
  output?: string[];
  failureDescription?: string;
}

export type WorkflowVariableValue = string | string[] | boolean | number | null;
export type WorkflowVariableMap = Record<string, WorkflowVariableValue>;

export interface WorkflowConfirmStepOptions {
  name: string;
  description: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  storeResultAs?: string;
}

export interface WorkflowTextEntryStepOptions {
  name: string;
  description: string;
  title: string;
  placeHolder?: string;
  prompt?: string;
  value?: string;
  valueFromVariable?: string;
  storeAs: string;
  required?: boolean;
}

export interface WorkflowMultiTextEntryFieldOptions {
  label: string;
  placeHolder?: string;
  prompt?: string;
  value?: string;
  valueFromVariable?: string;
  storeAs: string;
  required?: boolean;
}

export interface WorkflowMultiTextEntryStepOptions {
  name: string;
  description: string;
  title: string;
  fields: WorkflowMultiTextEntryFieldOptions[];
}

export interface WorkflowSelectionStepOptions {
  name: string;
  description: string;
  title: string;
  placeHolder?: string;
  options?: string[];
  optionsFromVariable?: string;
  storeAs: string;
}

export interface WorkflowMultiSelectionStepOptions {
  name: string;
  description: string;
  title: string;
  placeHolder?: string;
  options?: string[];
  optionsFromVariable?: string;
  storeAs: string;
  requireAtLeastOne?: boolean;
}

export type WorkflowComboQueryProvider = (filter: string, context: WorkflowExecutionContext) => Promise<string[]>;

export interface WorkflowDynamicComboSelectionStepOptions {
  name: string;
  description: string;
  title: string;
  placeHolder?: string;
  queryProvider: WorkflowComboQueryProvider;
  storeAs: string;
}

export interface WorkflowInputProvider {
  initialize?(plan: WorkflowExecutionPlan): Promise<void> | void;
  onStepStarted?(plan: WorkflowExecutionPlan, stepIndex: number): Promise<void> | void;
  onStepFinished?(plan: WorkflowExecutionPlan, stepIndex: number): Promise<void> | void;
  complete?(plan: WorkflowExecutionPlan): Promise<void> | void;
  useMarkdownSnapshots?(): boolean;
  confirm(options: WorkflowConfirmStepOptions, context: WorkflowExecutionContext): Promise<boolean | null>;
  textEntry(options: WorkflowTextEntryStepOptions, context: WorkflowExecutionContext): Promise<string | null>;
  multiTextEntry(options: WorkflowMultiTextEntryStepOptions, context: WorkflowExecutionContext): Promise<Record<string, string> | null>;
  selection(options: WorkflowSelectionStepOptions, items: string[], context: WorkflowExecutionContext): Promise<string | null>;
  multiSelection(options: WorkflowMultiSelectionStepOptions, items: string[], context: WorkflowExecutionContext): Promise<string[] | null>;
  dynamicComboSelection(options: WorkflowDynamicComboSelectionStepOptions, context: WorkflowExecutionContext): Promise<string | null>;
}

class VsCodeWorkflowInputProvider implements WorkflowInputProvider {
  async confirm(options: WorkflowConfirmStepOptions, context: WorkflowExecutionContext): Promise<boolean | null> {
    const confirmLabel = options.confirmLabel ?? 'Continue';
    const cancelLabel = options.cancelLabel ?? 'Cancel';
    const selection = await vscode.window.showInformationMessage(
      context.resolveTemplate(options.message),
      { modal: true },
      confirmLabel,
      cancelLabel
    );

    if (!selection) {
      return null;
    }

    return selection === confirmLabel;
  }

  async textEntry(options: WorkflowTextEntryStepOptions, context: WorkflowExecutionContext): Promise<string | null> {
    const defaultValueFromVariable = options.valueFromVariable
      ? context.getVariable(options.valueFromVariable)
      : undefined;
    const initialValue = typeof defaultValueFromVariable === 'string'
      ? defaultValueFromVariable
      : (options.value ?? '');

    const value = await vscode.window.showInputBox({
      title: context.resolveTemplate(options.title),
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : undefined,
      prompt: options.prompt ? context.resolveTemplate(options.prompt) : undefined,
      value: context.resolveTemplate(initialValue)
    });

    return typeof value === 'string' ? value : null;
  }

  async multiTextEntry(options: WorkflowMultiTextEntryStepOptions, context: WorkflowExecutionContext): Promise<Record<string, string> | null> {
    const values: Record<string, string> = {};

    for (let index = 0; index < options.fields.length; index += 1) {
      const field = options.fields[index];
      const defaultValueFromVariable = field.valueFromVariable
        ? context.getVariable(field.valueFromVariable)
        : undefined;
      const initialValue = typeof defaultValueFromVariable === 'string'
        ? defaultValueFromVariable
        : (field.value ?? '');

      const value = await vscode.window.showInputBox({
        title: `${context.resolveTemplate(options.title)} (${index + 1}/${options.fields.length})`,
        placeHolder: field.placeHolder ? context.resolveTemplate(field.placeHolder) : undefined,
        prompt: field.prompt ? context.resolveTemplate(field.prompt) : context.resolveTemplate(field.label),
        value: context.resolveTemplate(initialValue)
      });

      if (typeof value !== 'string') {
        return null;
      }

      values[field.storeAs] = value;
    }

    return values;
  }

  async selection(options: WorkflowSelectionStepOptions, items: string[], context: WorkflowExecutionContext): Promise<string | null> {
    const selected = await vscode.window.showQuickPick(items, {
      title: context.resolveTemplate(options.title),
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : undefined
    });

    return selected ?? null;
  }

  async multiSelection(options: WorkflowMultiSelectionStepOptions, items: string[], context: WorkflowExecutionContext): Promise<string[] | null> {
    const selected = await vscode.window.showQuickPick(items, {
      title: context.resolveTemplate(options.title),
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : undefined,
      canPickMany: true
    });

    return selected ?? null;
  }

  async dynamicComboSelection(options: WorkflowDynamicComboSelectionStepOptions, context: WorkflowExecutionContext): Promise<string | null> {
    // Fallback: show a quick pick with initial items
    const initialItems = await options.queryProvider('', context);
    const selected = await vscode.window.showQuickPick(initialItems, {
      title: context.resolveTemplate(options.title),
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : undefined
    });
    return selected ?? null;
  }
}

export class WebviewWorkflowInputProvider implements WorkflowInputProvider {
  private panel: vscode.WebviewPanel | null = null;
  private plan: WorkflowExecutionPlan | null = null;
  private activeStepIndex = -1;
  private inputPayload: unknown = null;
  private pendingResolve: ((value: unknown) => void) | null = null;
  private currentQueryProvider: WorkflowComboQueryProvider | null = null;
  private currentQueryContext: WorkflowExecutionContext | null = null;

  public initialize(plan: WorkflowExecutionPlan): void {
    this.plan = plan;
    this.ensurePanel();
    if (this.panel) {
      this.panel.title = plan.name;
    }
    this.render();
  }

  public onStepStarted(plan: WorkflowExecutionPlan, stepIndex: number): void {
    this.plan = plan;
    this.activeStepIndex = stepIndex;
    this.inputPayload = null;
    if (this.panel) {
      this.panel.title = plan.name;
    }
    this.render();
  }

  public onStepFinished(plan: WorkflowExecutionPlan, stepIndex: number): void {
    this.plan = plan;
    this.activeStepIndex = stepIndex;
    this.inputPayload = null;
    if (this.panel) {
      this.panel.title = plan.name;
    }
    this.render();
  }

  public complete(plan: WorkflowExecutionPlan): void {
    this.plan = plan;
    this.inputPayload = null;
    if (this.panel) {
      this.panel.title = plan.name;
    }
    this.render();
  }

  public useMarkdownSnapshots(): boolean {
    return false;
  }

  async confirm(options: WorkflowConfirmStepOptions, context: WorkflowExecutionContext): Promise<boolean | null> {
    const response = await this.prompt({
      type: 'confirm',
      title: options.name,
      description: options.description,
      message: context.resolveTemplate(options.message),
      confirmLabel: options.confirmLabel ?? 'Continue',
      cancelLabel: options.cancelLabel ?? 'Cancel'
    }) as { cancelled?: boolean; confirmed?: boolean } | undefined;

    if (!response || response.cancelled) {
      return null;
    }

    return !!response.confirmed;
  }

  async textEntry(options: WorkflowTextEntryStepOptions, context: WorkflowExecutionContext): Promise<string | null> {
    const defaultValueFromVariable = options.valueFromVariable
      ? context.getVariable(options.valueFromVariable)
      : undefined;
    const initialValue = typeof defaultValueFromVariable === 'string'
      ? defaultValueFromVariable
      : (options.value ?? '');

    const response = await this.prompt({
      type: 'text',
      title: context.resolveTemplate(options.title),
      description: options.description,
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : '',
      prompt: options.prompt ? context.resolveTemplate(options.prompt) : '',
      value: context.resolveTemplate(initialValue)
    }) as { cancelled?: boolean; value?: string } | undefined;

    if (!response || response.cancelled) {
      return null;
    }

    return typeof response.value === 'string' ? response.value : '';
  }

  async multiTextEntry(options: WorkflowMultiTextEntryStepOptions, context: WorkflowExecutionContext): Promise<Record<string, string> | null> {
    const fields = options.fields.map(field => {
      const defaultValueFromVariable = field.valueFromVariable
        ? context.getVariable(field.valueFromVariable)
        : undefined;
      const initialValue = typeof defaultValueFromVariable === 'string'
        ? defaultValueFromVariable
        : (field.value ?? '');

      return {
        label: context.resolveTemplate(field.label),
        placeHolder: field.placeHolder ? context.resolveTemplate(field.placeHolder) : '',
        prompt: field.prompt ? context.resolveTemplate(field.prompt) : '',
        value: context.resolveTemplate(initialValue),
        storeAs: field.storeAs,
        required: !!field.required
      };
    });

    const response = await this.prompt({
      type: 'multi-text',
      title: context.resolveTemplate(options.title),
      description: options.description,
      fields
    }) as { cancelled?: boolean; values?: Record<string, string> } | undefined;

    if (!response || response.cancelled) {
      return null;
    }

    return typeof response.values === 'object' && response.values !== null
      ? response.values
      : {};
  }

  async selection(options: WorkflowSelectionStepOptions, items: string[], context: WorkflowExecutionContext): Promise<string | null> {
    const response = await this.prompt({
      type: 'single-select',
      title: context.resolveTemplate(options.title),
      description: options.description,
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : '',
      items
    }) as { cancelled?: boolean; value?: string } | undefined;

    if (!response || response.cancelled) {
      return null;
    }

    return typeof response.value === 'string' ? response.value : null;
  }

  async multiSelection(options: WorkflowMultiSelectionStepOptions, items: string[], context: WorkflowExecutionContext): Promise<string[] | null> {
    const response = await this.prompt({
      type: 'multi-select',
      title: context.resolveTemplate(options.title),
      description: options.description,
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : '',
      items
    }) as { cancelled?: boolean; values?: string[] } | undefined;

    if (!response || response.cancelled) {
      return null;
    }

    return Array.isArray(response.values) ? response.values : [];
  }

  async dynamicComboSelection(options: WorkflowDynamicComboSelectionStepOptions, context: WorkflowExecutionContext): Promise<string | null> {
    this.currentQueryProvider = options.queryProvider;
    this.currentQueryContext = context;
    
    // Get initial results
    const initialResults = await options.queryProvider('', context);
    
    const response = await this.prompt({
      type: 'dynamic-combo',
      title: context.resolveTemplate(options.title),
      description: options.description,
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : '',
      initialResults
    }) as { cancelled?: boolean; value?: string } | undefined;

    this.currentQueryProvider = null;
    this.currentQueryContext = null;

    if (!response || response.cancelled) {
      return null;
    }

    return typeof response.value === 'string' ? response.value : null;
  }

  private async prompt(payload: unknown): Promise<unknown> {
    this.ensurePanel();
    if (!this.panel) {
      return { cancelled: true };
    }

    this.inputPayload = payload;
    this.render();
    this.panel.reveal(vscode.ViewColumn.Active);

    if (this.pendingResolve) {
      this.pendingResolve({ cancelled: true });
      this.pendingResolve = null;
    }

    return new Promise(resolve => {
      this.pendingResolve = resolve;
    });
  }

  private ensurePanel(): void {
    if (this.panel) {
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'workflowExecution',
      this.plan?.name ?? 'Workflow Execution',
      vscode.ViewColumn.Active,
      { enableScripts: true }
    );

    this.panel.onDidDispose(() => {
      this.panel = null;
      if (this.pendingResolve) {
        this.pendingResolve({ cancelled: true });
        this.pendingResolve = null;
      }
    });

    this.panel.webview.onDidReceiveMessage(message => {
      if (message?.type === 'query' && this.currentQueryProvider && this.currentQueryContext) {
        const filter = String(message.filter ?? '');
        void this.currentQueryProvider(filter, this.currentQueryContext).then(results => {
          if (this.panel) {
            this.panel.webview.postMessage({ type: 'query-results', results });
          }
        });
        return;
      }

      if (message?.type === 'submit' && this.pendingResolve) {
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        this.inputPayload = null;
        this.render();
        resolve(message.payload ?? {});
      }

      if (message?.type === 'cancel' && this.pendingResolve) {
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        this.inputPayload = null;
        this.render();
        resolve({ cancelled: true });
      }
    });
  }

  private render(): void {
    if (!this.panel) {
      return;
    }

    this.panel.webview.html = this.getHtml();
  }

  private statusLabel(status: WorkflowStepStatus): string {
    if (status === 'successful') {
      return '✓';
    }
    if (status === 'failed') {
      return 'X';
    }
    if (status === 'running') {
      return '↻';
    }
    return '...';
  }

  private getHtml(): string {
    const data = JSON.stringify(this.inputPayload ?? {}).replace(/</g, '\\u003c');
    const steps = this.plan ? this.plan.getSteps() : [];
    const variables = this.plan ? this.plan.getVariables() : {};
    const visibleSteps = steps
      .map((step, index) => ({ step, index }))
      .filter(item => item.step.isVisible(variables));

    const rows = visibleSteps.map((item) => {
      const step = item.step;
      const isActive = item.index === this.activeStepIndex;
      const failure = step.failureDescription ? `<div class="failure">${escapeHtml(step.failureDescription)}</div>` : '';
      const details = step.output.length > 0
        ? `<div class="step-details"><div class="step-details-separator"></div>${step.output.map(line => `<div class="step-detail-line">${escapeHtml(line)}</div>`).join('')}</div>`
        : '';
      const input = isActive ? '<div id="inline-input" class="inline-input"></div>' : '';
      return `<div class="step ${isActive ? 'active' : ''}">
        <div class="step-head">
          <span class="name">${escapeHtml(step.name)}</span>
          <span class="status status-${step.status}">${this.statusLabel(step.status)}</span>
        </div>
        <div class="desc">${escapeHtml(step.description)}</div>
        ${details}
        ${failure}
        ${input}
      </div>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
    h2 { margin: 0 0 12px 0; }
    .step { border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; padding: 10px; margin-bottom: 10px; }
    .step.active { border-color: var(--vscode-focusBorder); }
    .step-head { display: flex; gap: 8px; align-items: center; }
    .name { font-weight: 600; font-size: 14px; }
    .status { margin-left: auto; font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--vscode-editorWidget-border); }
    .status-successful { color: var(--vscode-testing-iconPassed); }
    .status-failed { color: var(--vscode-testing-iconFailed); }
    .status-running { color: transparent; position: relative; }
    .status-running::before {
      content: '↻';
      color: var(--vscode-charts-blue);
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      display: inline-block;
      animation: status-spin-centered 1s linear infinite;
    }
    .status-not-executed { color: var(--vscode-descriptionForeground); }
    @keyframes status-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @keyframes status-spin-centered {
      from { transform: translate(-50%, -50%) rotate(0deg); }
      to { transform: translate(-50%, -50%) rotate(360deg); }
    }
    .desc { margin-top: 4px; color: var(--vscode-descriptionForeground); }
    .failure { margin-top: 6px; color: var(--vscode-errorForeground); }
    .step-details { margin-top: 8px; }
    .step-details-separator { border-top: 1px dotted var(--vscode-editorWidget-border); margin-bottom: 6px; }
    .step-detail-line { color: var(--vscode-descriptionForeground); margin-top: 3px; }
    .inline-input { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--vscode-editorWidget-border); }
    input[type='text'], select { width: 100%; padding: 6px; box-sizing: border-box; }
    .actions { display: flex; gap: 8px; margin-top: 16px; }
    button { padding: 6px 12px; }
    .list { border: 1px solid var(--vscode-editorWidget-border); padding: 8px; max-height: 260px; overflow: auto; }
    label { display: block; margin: 4px 0; }
    .empty { color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <h2>${escapeHtml(this.plan?.name ?? 'Workflow Execution')}</h2>
  ${rows || '<div class="empty">No steps.</div>'}
  <script>
    const vscode = acquireVsCodeApi();
    const payload = ${data};
    const inputRoot = document.getElementById('inline-input');

    if (!inputRoot || !payload.type) {
      // no interactive input active for current step
    } else {
      const title = document.createElement('div');
      title.textContent = payload.title || 'Input';
      title.style.fontWeight = '600';
      title.style.marginBottom = '8px';
      inputRoot.appendChild(title);

      if (payload.description) {
        const description = document.createElement('div');
        description.textContent = payload.description;
        description.style.marginBottom = '8px';
        description.style.color = 'var(--vscode-descriptionForeground)';
        inputRoot.appendChild(description);
      }

      const content = document.createElement('div');
      inputRoot.appendChild(content);

      const actions = document.createElement('div');
      actions.className = 'actions';
      const ok = document.createElement('button');
      ok.textContent = 'Continue';
      actions.appendChild(ok);
      inputRoot.appendChild(actions);

      if (payload.type === 'confirm') {
        const message = document.createElement('p');
        message.textContent = payload.message || '';
        content.appendChild(message);
        ok.textContent = payload.confirmLabel || 'Continue';
        ok.onclick = () => vscode.postMessage({ type: 'submit', payload: { confirmed: true } });
      }

      if (payload.type === 'text') {
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = payload.placeHolder || '';
        input.value = payload.value || '';
        content.appendChild(input);
        if (payload.prompt) {
          const p = document.createElement('p');
          p.textContent = payload.prompt;
          content.prepend(p);
        }
        ok.onclick = () => vscode.postMessage({ type: 'submit', payload: { value: input.value } });
      }

      if (payload.type === 'multi-text') {
        const entries = [];

        (payload.fields || []).forEach(field => {
          const wrapper = document.createElement('div');
          wrapper.style.marginBottom = '10px';

          const label = document.createElement('div');
          label.textContent = field.label || field.storeAs || 'Field';
          label.style.marginBottom = '4px';
          wrapper.appendChild(label);

          if (field.prompt) {
            const prompt = document.createElement('div');
            prompt.textContent = field.prompt;
            prompt.style.marginBottom = '4px';
            prompt.style.color = 'var(--vscode-descriptionForeground)';
            wrapper.appendChild(prompt);
          }

          const input = document.createElement('input');
          input.type = 'text';
          input.placeholder = field.placeHolder || '';
          input.value = field.value || '';
          wrapper.appendChild(input);

          content.appendChild(wrapper);
          entries.push({ input, field });
        });

        ok.onclick = () => {
          const values = {};
          for (const entry of entries) {
            values[entry.field.storeAs] = entry.input.value || '';
          }
          vscode.postMessage({ type: 'submit', payload: { values } });
        };
      }

      if (payload.type === 'single-select') {
        const select = document.createElement('select');
        (payload.items || []).forEach(item => {
          const option = document.createElement('option');
          option.value = item;
          option.textContent = item;
          select.appendChild(option);
        });
        content.appendChild(select);
        ok.onclick = () => vscode.postMessage({ type: 'submit', payload: { value: select.value } });
      }

      if (payload.type === 'multi-select') {
        const list = document.createElement('div');
        list.className = 'list';
        (payload.items || []).forEach(item => {
          const label = document.createElement('label');
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.value = item;
          label.appendChild(input);
          label.append(' ' + item);
          list.appendChild(label);
        });
        content.appendChild(list);
        ok.onclick = () => {
          const values = Array.from(list.querySelectorAll('input[type="checkbox"]'))
            .filter(input => input.checked)
            .map(input => input.value);
          vscode.postMessage({ type: 'submit', payload: { values } });
        };
      }

      if (payload.type === 'dynamic-combo') {
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = payload.placeHolder || 'Search...';
        searchInput.style.marginBottom = '8px';
        content.appendChild(searchInput);

        const optionsList = document.createElement('div');
        optionsList.className = 'list';
        optionsList.style.maxHeight = '300px';
        content.appendChild(optionsList);

        let selectedValue = '';
        let debounceTimer = 0;

        const renderOptions = (items) => {
          optionsList.innerHTML = '';
          if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty';
            empty.textContent = 'No matches found';
            optionsList.appendChild(empty);
            return;
          }
          items.forEach(item => {
            const div = document.createElement('div');
            div.style.padding = '4px 8px';
            div.style.cursor = 'pointer';
            div.style.borderRadius = '4px';
            div.textContent = item;
            div.onmouseover = () => div.style.backgroundColor = 'var(--vscode-list-hoverBackground)';
            div.onmouseout = () => div.style.backgroundColor = '';
            div.ondblclick = () => {
              vscode.postMessage({ type: 'submit', payload: { value: item, filter: searchInput.value } });
            };
            div.onclick = (e) => {
              e.stopPropagation();
              selectedValue = item;
              searchInput.value = item;
              searchInput.focus();
            };
            optionsList.appendChild(div);
          });
        };

        const performQuery = () => {
          const filter = searchInput.value.toLowerCase();
          vscode.postMessage({ type: 'query', filter: filter });
        };

        renderOptions(payload.initialResults || []);

        searchInput.oninput = () => {
          clearTimeout(debounceTimer);
          debounceTimer = window.setTimeout(performQuery, 250);
        };

        searchInput.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const value = selectedValue || searchInput.value.trim();
            if (value) {
              vscode.postMessage({ type: 'submit', payload: { value: value, filter: searchInput.value } });
            }
          } else if (e.key === 'Tab') {
            e.preventDefault();
            performQuery();
          }
        };

        window.addEventListener('message', (event) => {
          const msg = event.data;
          if (msg && msg.type === 'query-results') {
            renderOptions(msg.results || []);
          }
        });

        ok.textContent = 'Select';
        ok.onclick = () => {
          const value = selectedValue || searchInput.value.trim();
          if (!value) {
            return;
          }
          vscode.postMessage({ type: 'submit', payload: { value: value, filter: searchInput.value } });
        };
      }

    }
  </script>
</body>
</html>`;
  }
}

export class WorkflowExecutionContext {
  constructor(private readonly plan: WorkflowExecutionPlan,
              private readonly inputProvider: WorkflowInputProvider) {}

  public getVariable(name: string): WorkflowVariableValue {
    return this.plan.getVariable(name);
  }

  public setVariable(name: string, value: WorkflowVariableValue): void {
    this.plan.setVariable(name, value);
  }

  public resolveTemplate(input: string): string {
    return this.plan.resolveTemplate(input);
  }

  public resolveTemplates(inputs: string[]): string[] {
    return inputs.map(value => this.resolveTemplate(value));
  }

  public getInputProvider(): WorkflowInputProvider {
    return this.inputProvider;
  }
}

export type WorkflowStepExecutor = (context: WorkflowExecutionContext) => Promise<WorkflowStepExecutionResult>;
export type WorkflowStepExecution = WorkflowStepExecutor | string;
export type WorkflowStepVisibilityCondition = (variables: WorkflowVariableMap) => boolean;

export class WorkflowExecutionStep {
  constructor(public readonly name: string,
              public readonly description: string,
              public readonly execution: WorkflowStepExecution,
              public readonly failurePatterns: WorkflowFailurePattern[] = [],
              public readonly visibilityCondition?: WorkflowStepVisibilityCondition) {}

  public status: WorkflowStepStatus = 'not-executed';
  public failureDescription = '';
  public output: string[] = [];

  public matchFailureDescription(output: string[]): string | null {
    const text = output.join('\n');
    for (const pattern of this.failurePatterns) {
      if (pattern.pattern.test(text)) {
        return pattern.description;
      }
    }
    return null;
  }

  public isVisible(variables: WorkflowVariableMap): boolean {
    if (!this.visibilityCondition) {
      return true;
    }

    return this.visibilityCondition(variables);
  }

  public static createConfirmStep(options: WorkflowConfirmStepOptions): WorkflowExecutionStep {
    return new WorkflowExecutionStep(
      options.name,
      options.description,
      async context => {
        const confirmed = await context.getInputProvider().confirm(options, context);
        if (options.storeResultAs) {
          context.setVariable(options.storeResultAs, confirmed === true);
        }

        if (confirmed !== true) {
          return {
            success: false,
            output: ['User cancelled at confirmation step.'],
            failureDescription: 'Cancelled by user.'
          };
        }

        return {
          success: true,
          output: ['User confirmed step.']
        };
      }
    );
  }

  public static createTextEntryStep(options: WorkflowTextEntryStepOptions): WorkflowExecutionStep {
    return new WorkflowExecutionStep(
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
      }
    );
  }

  public static createMultiTextEntryStep(options: WorkflowMultiTextEntryStepOptions): WorkflowExecutionStep {
    return new WorkflowExecutionStep(
      options.name,
      options.description,
      async context => {
        const values = await context.getInputProvider().multiTextEntry(options, context);

        if (values === null) {
          return {
            success: false,
            output: ['User cancelled multi text entry.'],
            failureDescription: 'Cancelled by user.'
          };
        }

        for (const field of options.fields) {
          const value = String(values[field.storeAs] ?? '');
          if (field.required && value.trim() === '') {
            return {
              success: false,
              output: [`Field '${field.label}' is required but empty.`],
              failureDescription: 'Required input is empty.'
            };
          }
          context.setVariable(field.storeAs, value);
        }

        return {
          success: true,
          output: [`Stored values for ${options.fields.length} fields.`]
        };
      }
    );
  }

  public static createSelectionStep(options: WorkflowSelectionStepOptions): WorkflowExecutionStep {
    return new WorkflowExecutionStep(
      options.name,
      options.description,
      async context => {
        const items = resolveSelectionItems(context, options.options, options.optionsFromVariable);
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
      }
    );
  }

  public static createMultiSelectionStep(options: WorkflowMultiSelectionStepOptions): WorkflowExecutionStep {
    return new WorkflowExecutionStep(
      options.name,
      options.description,
      async context => {
        const items = resolveSelectionItems(context, options.options, options.optionsFromVariable);
        if (items.length === 0) {
          return {
            success: false,
            output: ['Selection list is empty.'],
            failureDescription: 'No options available for selection.'
          };
        }

        const selected = await context.getInputProvider().multiSelection(options, items, context);

        if (!selected) {
          return {
            success: false,
            output: ['User cancelled multi-selection.'],
            failureDescription: 'Cancelled by user.'
          };
        }

        if (options.requireAtLeastOne && selected.length === 0) {
          return {
            success: false,
            output: ['No items selected.'],
            failureDescription: 'At least one item must be selected.'
          };
        }

        context.setVariable(options.storeAs, selected);
        return {
          success: true,
          output: [`Stored multi-selection in variable: ${options.storeAs}`]
        };
      }
    );
  }

  public static createDynamicComboSelectionStep(options: WorkflowDynamicComboSelectionStepOptions): WorkflowExecutionStep {
    return new WorkflowExecutionStep(
      options.name,
      options.description,
      async context => {
        const selected = await context.getInputProvider().dynamicComboSelection(options, context);

        if (!selected) {
          return {
            success: false,
            output: ['User cancelled dynamic combo selection.'],
            failureDescription: 'Cancelled by user.'
          };
        }

        context.setVariable(options.storeAs, selected);
        return {
          success: true,
          output: [`Selected: ${selected}`]
        };
      }
    );
  }
}

export class WorkflowExecutionPlan {
  constructor(public readonly name: string,
              private readonly steps: WorkflowExecutionStep[] = [],
              public summary = '',
              public details = '',
              private readonly variables: WorkflowVariableMap = {}) {}

  public addStep(step: WorkflowExecutionStep): void {
    this.steps.push(step);
  }

  public getSteps(): WorkflowExecutionStep[] {
    return this.steps;
  }

  public getVariables(): WorkflowVariableMap {
    return { ...this.variables };
  }

  public setVariable(name: string, value: WorkflowVariableValue): void {
    this.variables[name] = value;
  }

  public getVariable(name: string): WorkflowVariableValue {
    return this.variables[name];
  }

  public resolveTemplate(input: string): string {
    if (!input) {
      return input;
    }

    return input.replace(/\$\{([a-zA-Z0-9_.-]+)\}/g, (_full, variableName: string) => {
      const value = this.variables[variableName];
      if (Array.isArray(value)) {
        return value.join(', ');
      }
      if (value === null || typeof value === 'undefined') {
        return '';
      }
      return String(value);
    });
  }

  public toMarkdownLines(): string[] {
    const rows: string[] = [];

    rows.push(`# Workflow Execution Plan: ${this.name}`);
    rows.push('');

    if (this.summary.trim() !== '') {
      rows.push(`**Summary:** ${escapeTableCell(this.summary)}`);
      rows.push('');
    }

    if (this.details.trim() !== '') {
      rows.push('<details>');
      rows.push('<summary><strong>Details</strong></summary>');
      rows.push('');
      rows.push(escapeTableCell(this.details));
      rows.push('');
      rows.push('</details>');
      rows.push('');
    }

    rows.push('| Status | Step | Description | Failure |');
    rows.push('|---|---|---|---|');

    const allSteps = this.getSteps();
    for (let i = 0; i < allSteps.length; i += 1) {
      const step = allSteps[i];
      rows.push(`| ${getStatusIcon(step.status)} | ${escapeTableCell(step.name)} | ${escapeTableCell(step.description)} | ${escapeTableCell(step.failureDescription)} |`);
    }

    rows.push('');

    return rows;
  }
}

export async function executeFlow(
  plan: WorkflowExecutionPlan,
  inputProvider: WorkflowInputProvider = new VsCodeWorkflowInputProvider()
): Promise<WorkflowExecutionPlan> {
  let continueExecution = true;
  const context = new WorkflowExecutionContext(plan, inputProvider);
  await inputProvider.initialize?.(plan);
  const useMarkdownSnapshots = inputProvider.useMarkdownSnapshots ? inputProvider.useMarkdownSnapshots() : true;

  const steps = plan.getSteps();
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];

    if (!step.isVisible(plan.getVariables())) {
      step.status = 'not-executed';
      step.failureDescription = '';
      step.output = [];
      continue;
    }

    step.status = 'running';
    await inputProvider.onStepStarted?.(plan, i);
    if (!continueExecution) {
      step.status = 'not-executed';
      await inputProvider.onStepFinished?.(plan, i);
      if (useMarkdownSnapshots) {
        await publishExecutionProgress(plan, i + 1);
      }
      continue;
    }

    try {
      const result = await executeStep(step, context);
      const output = result.output ?? [];
      step.output = output;

      if (result.success) {
        step.status = 'successful';
        step.failureDescription = '';
      } else {
        step.status = 'failed';
        step.failureDescription = result.failureDescription
          ?? step.matchFailureDescription(output)
          ?? 'Step failed.';
        continueExecution = false;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const output = [message];
      step.output = output;
      step.status = 'failed';
      step.failureDescription = step.matchFailureDescription(output) ?? message;
      continueExecution = false;
    }

    await inputProvider.onStepFinished?.(plan, i);
    if (useMarkdownSnapshots) {
      await publishExecutionProgress(plan, i + 1);
    }
  }

  await inputProvider.complete?.(plan);

  return plan;
}

export function writeExecutionPlanMarkdown(plan: WorkflowExecutionPlan): string {
  const reportsRoot = getReportsRoot();
  fs.mkdirSync(reportsRoot, { recursive: true });

  const timestamp = Math.floor(Date.now() / 1000);
  const safeName = plan.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const filePath = path.join(reportsRoot, `workflow-plan-${safeName || 'plan'}-${timestamp}.md`);

  fs.writeFileSync(filePath, plan.toMarkdownLines().join('\n'), 'utf8');
  return filePath;
}

function writeExecutionPlanMarkdownSnapshot(plan: WorkflowExecutionPlan, stepIndex: number): string {
  const reportsRoot = getReportsRoot();
  fs.mkdirSync(reportsRoot, { recursive: true });

  const timestamp = Math.floor(Date.now() / 1000);
  const safeName = plan.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const filePath = path.join(reportsRoot, `workflow-plan-${safeName || 'plan'}-step-${stepIndex}-${timestamp}.md`);

  fs.writeFileSync(filePath, plan.toMarkdownLines().join('\n'), 'utf8');
  return filePath;
}

function getStatusIcon(status: WorkflowStepStatus): string {
  if (status === 'successful') {
    return 'SUCCESS';
  }
  if (status === 'failed') {
    return 'FAILED';
  }
  if (status === 'running') {
    return 'RUNNING';
  }
  return 'PENDING';
}

function escapeTableCell(input: string): string {
  return (input ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br/>');
}

function escapeHtml(input: string): string {
  return (input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function executeStep(step: WorkflowExecutionStep, context: WorkflowExecutionContext): Promise<WorkflowStepExecutionResult> {
  if (typeof step.execution === 'string') {
    const resolvedExecution = context.resolveTemplate(step.execution);
    const result = await executeWorkflowCommand(resolvedExecution);
    const outputWithCommand = [`$ ${resolvedExecution}`, ...result.output];
    if (result.success) {
      return {
        success: true,
        output: outputWithCommand
      };
    }

    return {
      success: false,
      output: outputWithCommand,
      failureDescription: `Command failed: ${resolvedExecution}`
    };
  }

  return step.execution(context);
}

function resolveSelectionItems(
  context: WorkflowExecutionContext,
  directOptions?: string[],
  optionsFromVariable?: string
): string[] {
  if (directOptions && directOptions.length > 0) {
    return context.resolveTemplates(directOptions);
  }

  if (!optionsFromVariable) {
    return [];
  }

  const value = context.getVariable(optionsFromVariable);
  if (Array.isArray(value)) {
    return context.resolveTemplates(value.map(item => String(item)));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return [context.resolveTemplate(value)];
  }

  return [];
}

async function publishExecutionProgress(plan: WorkflowExecutionPlan, stepIndex: number): Promise<void> {
  const markdownPath = writeExecutionPlanMarkdownSnapshot(plan, stepIndex);
  const uri = vscode.Uri.file(markdownPath);
  await vscode.commands.executeCommand('markdown.showPreview', uri);
}

function getReportsRoot(): string {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceFolder) {
    return path.join(workspaceFolder, 'reports');
  }

  return path.join(os.tmpdir(), 'smartercode-workflow-reports');
}

async function executeWorkflowCommand(command: string): Promise<{ success: boolean; output: string[] }> {
  const output = await executeCommand(command);
  if (output === false) {
    return {
      success: false,
      output: ['Command failed in terminal shell integration.']
    };
  }

  return {
    success: true,
    output
  };
}
