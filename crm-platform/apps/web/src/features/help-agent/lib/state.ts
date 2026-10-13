import type { FailureKey } from './failure';
import type { ConfirmRequest } from './gate';
import type { AssistantMode } from './prompt';
import type { RunnerEvent, StepView, Outcome } from './runner';

/**
 * What the assistant panel shows, as one value. The panel is a pure function of it (so every state is rendered in a test), and one
 * reducer moves it: nothing else changes what the person sees.
 */
export type Phase = 'idle' | 'starting' | 'running' | 'finished' | 'error';

export interface ActivityLine {
  kind: 'click' | 'type' | 'select' | 'blocked' | 'declined' | 'shown';
  label: string;
}

export interface PanelError {
  key: FailureKey;
  requestId: string | null;
  retryAfter: number | null;
  /** Why the runner ended the task, when it was not a failure (`person`, `budget`, `location`). */
  stoppedBy?: 'person' | 'budget' | 'location' | null;
}

export interface PanelState {
  phase: Phase;
  task: string;
  mode: AssistantMode;
  steps: StepView[];
  thinking: boolean;
  /** The latest thing done on the page, for the line under the step list. */
  activity: ActivityLine | null;
  /** Everything done, newest last, for the finished card. */
  log: ActivityLine[];
  confirm: ConfirmRequest | null;
  question: string | null;
  stopping: boolean;
  result: {
    outcome: Outcome;
    message: string;
    steps: number;
    confirmed: number;
    denied: number;
    stoppedBy: 'person' | 'budget' | 'location' | null;
  } | null;
  error: PanelError | null;
}

export const initialState: PanelState = {
  phase: 'idle',
  task: '',
  mode: 'do',
  steps: [],
  thinking: false,
  activity: null,
  log: [],
  confirm: null,
  question: null,
  stopping: false,
  result: null,
  error: null,
};

export type PanelAction =
  | { type: 'start'; task: string; mode: AssistantMode }
  | { type: 'running' }
  | { type: 'event'; event: RunnerEvent }
  | { type: 'confirm'; request: ConfirmRequest | null }
  | { type: 'question'; question: string | null }
  | { type: 'stopping' }
  | { type: 'finished'; result: NonNullable<PanelState['result']>; error: PanelError | null }
  | { type: 'failed'; error: PanelError }
  | { type: 'reset' };

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'start':
      return { ...initialState, phase: 'starting', task: action.task, mode: action.mode };
    case 'running':
      return { ...state, phase: 'running', thinking: true };
    case 'event': {
      const e = action.event;
      if (e.type === 'thinking') return { ...state, thinking: true };
      if (e.type === 'steps') return { ...state, steps: e.steps, thinking: false };
      const line: ActivityLine = { kind: e.kind, label: e.label };
      return { ...state, activity: line, log: [...state.log, line].slice(-50), thinking: false };
    }
    case 'confirm':
      return {
        ...state,
        confirm: action.request,
        thinking: action.request === null ? state.thinking : false,
      };
    case 'question':
      return { ...state, question: action.question };
    case 'stopping':
      return { ...state, stopping: true };
    case 'finished':
      return {
        ...state,
        phase: action.error ? 'error' : 'finished',
        thinking: false,
        confirm: null,
        question: null,
        stopping: false,
        result: action.result,
        error: action.error,
      };
    case 'failed':
      return {
        ...state,
        phase: 'error',
        thinking: false,
        confirm: null,
        question: null,
        stopping: false,
        error: action.error,
      };
    case 'reset':
      return initialState;
    default:
      return state;
  }
}
