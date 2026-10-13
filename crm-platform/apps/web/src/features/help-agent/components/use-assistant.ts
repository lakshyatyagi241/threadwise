'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { ApiError } from '@/lib/api/errors';
import { redirectOnIdle } from '@/lib/auth/idle-redirect';
import { finishTask, startTask } from '../api/help-agent';
import { failureKey } from '../lib/failure';
import type { ConfirmRequest } from '../lib/gate';
import type { AssistantMode } from '../lib/prompt';
import { TaskRunner, type RunnerOptions } from '../lib/runner';
import { initialState, panelReducer, type PanelError } from '../lib/state';

interface Pending<T> {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

const aborted = () => new DOMException('The task was stopped', 'AbortError');

/** Wires the panel to a task: starts it on the server, runs it, hands the person's answers to the runner, closes it on the server. */
export function useAssistant(
  locale: string,
  overrides: Partial<Pick<RunnerOptions, 'load' | 'fetchImpl'>> = {},
) {
  const [state, dispatch] = useReducer(panelReducer, initialState);
  const pathname = usePathname();
  const runner = useRef<TaskRunner | null>(null);
  const confirmWait = useRef<Pending<boolean> | null>(null);
  const answerWait = useRef<Pending<string> | null>(null);

  const submit = useCallback(
    async (task: string, mode: AssistantMode) => {
      const text = task.trim();
      if (text === '' || runner.current) return;
      dispatch({ type: 'start', task: text, mode });

      let started;
      try {
        started = await startTask({ locale, taskLength: text.length, route: pathname || '/' });
      } catch (err) {
        if (err instanceof ApiError) {
          redirectOnIdle(err);
          dispatch({
            type: 'failed',
            error: {
              key: failureKey({
                status: err.status,
                code: err.code,
                requestId: err.requestId ?? null,
                retryAfter: null,
              }),
              requestId: err.requestId ?? null,
              retryAfter: null,
            },
          });
        } else {
          dispatch({
            type: 'failed',
            error: { key: 'network', requestId: null, retryAfter: null },
          });
        }
        return;
      }

      const instance = new TaskRunner({
        taskId: started.taskId,
        locale,
        maxSteps: started.maxSteps,
        mode,
        confirm: (request: ConfirmRequest, signal) =>
          new Promise<boolean>((resolve, reject) => {
            confirmWait.current = { resolve, reject };
            signal.addEventListener('abort', () => reject(aborted()), { once: true });
            dispatch({ type: 'confirm', request });
          }),
        ask: (question, signal) =>
          new Promise<string>((resolve, reject) => {
            answerWait.current = { resolve, reject };
            signal.addEventListener('abort', () => reject(aborted()), { once: true });
            dispatch({ type: 'question', question });
          }),
        onEvent: (event) => dispatch({ type: 'event', event }),
        ...overrides,
      });
      runner.current = instance;
      dispatch({ type: 'running' });

      const result = await instance.run(text);
      runner.current = null;
      confirmWait.current = null;
      answerWait.current = null;
      await finishTask(started.taskId, {
        outcome: result.outcome,
        steps: result.steps,
        confirmedActions: result.confirmed,
        deniedActions: result.denied,
      }).catch(() => undefined);

      let error: PanelError | null = null;
      if (result.outcome === 'error') {
        error = result.failure
          ? {
              key: failureKey(result.failure),
              requestId: result.failure.requestId,
              retryAfter: result.failure.retryAfter,
            }
          : { key: 'generic', requestId: null, retryAfter: null };
      }
      dispatch({
        type: 'finished',
        error,
        result: {
          outcome: result.outcome,
          message: result.message,
          steps: result.steps,
          confirmed: result.confirmed,
          denied: result.denied,
          stoppedBy: result.stoppedBy,
        },
      });
    },
    [locale, pathname, overrides],
  );

  const stop = useCallback(async () => {
    if (!runner.current) return;
    dispatch({ type: 'stopping' });
    await runner.current.stop();
  }, []);

  const decide = useCallback((allowed: boolean) => {
    const wait = confirmWait.current;
    confirmWait.current = null;
    dispatch({ type: 'confirm', request: null });
    wait?.resolve(allowed);
  }, []);

  const answer = useCallback((text: string) => {
    const wait = answerWait.current;
    answerWait.current = null;
    dispatch({ type: 'question', question: null });
    wait?.resolve(text);
  }, []);

  const reset = useCallback(() => {
    if (!runner.current) dispatch({ type: 'reset' });
  }, []);

  // A task never outlives the shell: leaving the app (or closing the tab) stops it.
  useEffect(() => {
    return () => {
      void runner.current?.stop();
    };
  }, []);

  return {
    state,
    running: state.phase === 'starting' || state.phase === 'running',
    submit,
    stop,
    allow: () => decide(true),
    deny: () => decide(false),
    answer,
    reset,
  };
}
