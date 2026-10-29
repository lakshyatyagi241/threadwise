import type { TFunction } from 'i18next';

/** "follow_up" is "Follow up": the word for a type of the workspace that has no translation. */
const humanKey = (key: string): string => {
  const words = key
    .replace(/^custom_/, '')
    .replace(/_/g, ' ')
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
};

/** A task type's name: the workspace's own name for it, or (a default type carries none) the app's translated word. */
export const taskTypeName = (t: TFunction, o: { key: string; name: string | null }): string =>
  o.name ?? t(`tasks.form.typeNames.${o.key}`, { defaultValue: humanKey(o.key) });
