import {
  classifyClick,
  classifySelect,
  isSensitiveField,
  type RiskReason,
  type Verdict,
} from './risk';

/**
 * The gate every acting step of the Help assistant passes through (docs/specs/help-agent-assistant.md section 6.2). The page-agent
 * library has no "ask before acting" hook, so the three tools that act on the page (click, type, choose an option) are replaced by
 * these functions through the library's `customTools`. Each one finds the real element the model chose, classifies it, and either does
 * it, asks the person first, refuses, or (show mode) only highlights it. A failure to find the element refuses: the gate fails closed.
 *
 * The functions take the controller as a small interface so they can be tested without a browser layout.
 */

export interface GateController {
  clickElement(index: number): Promise<{ success: boolean; message: string }>;
  inputText(index: number, text: string): Promise<{ success: boolean; message: string }>;
  selectOption(index: number, optionText: string): Promise<{ success: boolean; message: string }>;
}

export interface ConfirmRequest {
  id: string;
  kind: 'click' | 'select';
  label: string;
  reason: RiskReason;
  /** What is about to be typed or chosen, for a select. */
  detail?: string;
}

export interface GateDeps {
  controller: GateController;
  mode: () => 'do' | 'show';
  origin: string;
  /** Resolves true when the person allows this one action; rejects when the task is stopped. */
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  /** A line for the live step list. */
  report: (line: {
    kind: 'click' | 'type' | 'select' | 'blocked' | 'declined' | 'shown';
    label: string;
  }) => void;
  highlight: (el: Element, label: string) => void;
  counters: { confirmed: number; denied: number };
  newId?: () => string;
}

/**
 * Finds the element behind an index. `selectorMap` is a private field of the library's PageController; the version is pinned and
 * `gate.shape.test.ts` runs the real controller to fail the build if this stops working. Anything unexpected returns null.
 */
export function elementAt(controller: unknown, index: number): Element | null {
  const map = (controller as { selectorMap?: unknown }).selectorMap;
  if (!(map instanceof Map)) return null;
  const node = map.get(index) as { ref?: unknown } | undefined;
  return node?.ref instanceof Element ? node.ref : null;
}

const MISSING =
  'The element was not found on the page any more. Look at the page again and choose another element.';

const refusal = (v: Verdict): string => {
  switch (v.reason) {
    case 'external':
      return `Blocked: "${v.label}" leads to another website. The assistant stays inside this application. Do not open it.`;
    case 'blocked_route':
      return `Blocked: "${v.label}" leads to a screen the assistant may not use. Do not open it; finish and tell the person.`;
    case 'new_tab':
      return `Blocked: "${v.label}" opens a new tab. Do not click it.`;
    case 'download':
      return `Blocked: "${v.label}" downloads a file. Do not click it.`;
    default:
      return `Blocked: "${v.label}" is not allowed.`;
  }
};

const declined = (label: string): string =>
  `The person declined "${label}". Do not try another way to do the same thing. Finish with done and say it was not done.`;

let counter = 0;
const defaultId = (): string => `c${Date.now().toString(36)}${(counter += 1).toString(36)}`;

async function ask(
  deps: GateDeps,
  verdict: Verdict,
  kind: ConfirmRequest['kind'],
  detail?: string,
): Promise<boolean> {
  const allowed = await deps.confirm({
    id: (deps.newId ?? defaultId)(),
    kind,
    label: verdict.label,
    reason: verdict.reason ?? 'submit',
    detail,
  });
  if (allowed) deps.counters.confirmed += 1;
  else {
    deps.counters.denied += 1;
    deps.report({ kind: 'declined', label: verdict.label });
  }
  return allowed;
}

export async function gatedClick(deps: GateDeps, index: number): Promise<string> {
  const el = elementAt(deps.controller, index);
  if (!el) return MISSING;
  const verdict = classifyClick(el, deps.origin);

  if (verdict.level === 'blocked') {
    deps.report({ kind: 'blocked', label: verdict.label });
    return refusal(verdict);
  }
  if (deps.mode() === 'show') {
    deps.highlight(el, verdict.label);
    deps.report({ kind: 'shown', label: verdict.label });
    return `Highlighted "${verdict.label}" for the person. It was not pressed. If this is the control they need, finish with done and explain the step.`;
  }
  if (verdict.level === 'confirm' && !(await ask(deps, verdict, 'click')))
    return declined(verdict.label);

  deps.report({ kind: 'click', label: verdict.label });
  return (await deps.controller.clickElement(index)).message;
}

export async function gatedInput(deps: GateDeps, index: number, text: string): Promise<string> {
  const el = elementAt(deps.controller, index);
  if (!el) return MISSING;
  const label = classifySelect(el).label;
  if (isSensitiveField(el)) {
    deps.report({ kind: 'blocked', label });
    return `Blocked: "${label}" holds a secret (a password, card, code or key). Never type it. Ask the person to type it themselves, then finish with done.`;
  }
  if (deps.mode() === 'show') {
    deps.highlight(el, label);
    deps.report({ kind: 'shown', label });
    return `Highlighted "${label}" for the person. Nothing was typed. Finish with done and tell them what to enter.`;
  }
  deps.report({ kind: 'type', label });
  return (await deps.controller.inputText(index, text)).message;
}

export async function gatedSelect(deps: GateDeps, index: number, option: string): Promise<string> {
  const el = elementAt(deps.controller, index);
  if (!el) return MISSING;
  const verdict = classifySelect(el);
  if (deps.mode() === 'show') {
    deps.highlight(el, verdict.label);
    deps.report({ kind: 'shown', label: verdict.label });
    return `Highlighted "${verdict.label}" for the person. Nothing was chosen. Finish with done and tell them which option to pick.`;
  }
  if (verdict.level === 'confirm' && !(await ask(deps, verdict, 'select', option)))
    return declined(verdict.label);
  deps.report({ kind: 'select', label: verdict.label });
  return (await deps.controller.selectOption(index, option)).message;
}
