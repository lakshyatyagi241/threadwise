import type { InboxTemplateOption } from '@crm/contracts';
import { useSyncExternalStore } from 'react';
import type { TemplateValues } from './template-model';

/**
 * The template being sent and what has been typed for it, shared by the three pages (choose, set variables, preview). It lives in
 * memory only: what a person types into a message is never put in a route address, stored, or logged, and it is gone when the message is
 * sent, when the person backs out to the list, or when the app is closed.
 */
export interface TemplateDraft {
  conversationId: string;
  template: InboxTemplateOption;
  values: TemplateValues;
}

let current: TemplateDraft | null = null;
const listeners = new Set<() => void>();

const publish = (next: TemplateDraft | null) => {
  current = next;
  listeners.forEach((listener) => listener());
};

/** Starts a draft for a template the person picked (anything typed for another template is dropped). */
export const startTemplateDraft = (conversationId: string, template: InboxTemplateOption): void =>
  publish({ conversationId, template, values: {} });

export const setTemplateValue = (key: string, value: string): void => {
  if (current) publish({ ...current, values: { ...current.values, [key]: value } });
};

export const clearTemplateDraft = (): void => publish(null);

export const getTemplateDraft = (): TemplateDraft | null => current;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The draft, redrawn when it changes; null when none was started (a reloaded app opens on a page that has nothing to show). */
export const useTemplateDraft = (): TemplateDraft | null =>
  useSyncExternalStore(subscribe, getTemplateDraft, getTemplateDraft);
