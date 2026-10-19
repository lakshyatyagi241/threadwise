import {
  NOTIFICATION_CATALOG,
  type NotificationPrefType,
  type NotificationPreferenceItem,
} from '@crm/contracts';

/** A preference item as the server sends it: the catalogue defaults, nothing chosen, the workspace allowing the bell. */
export const prefItem = (
  type: NotificationPrefType,
  over: Partial<NotificationPreferenceItem> = {},
): NotificationPreferenceItem => {
  const c = NOTIFICATION_CATALOG[type];
  return {
    type,
    group: c.group,
    bell: true,
    toast: c.toast,
    sound: c.sound,
    push: c.push,
    defaults: { bell: true, toast: c.toast, sound: c.sound, push: c.push },
    overrides: { bell: null, toast: null, sound: null, push: null },
    workspaceInapp: true,
    ...over,
  };
};

/** The person turned the pop-up of `new_message` off for themselves. */
export const popupOff = prefItem('new_message', {
  toast: false,
  overrides: { bell: null, toast: false, sound: null, push: null },
});

/** The bell of `task_due` is off (their own choice): its pop-up, sound and push cannot be chosen. */
export const bellOff = prefItem('task_due', {
  bell: false,
  toast: false,
  sound: false,
  push: false,
  overrides: { bell: false, toast: null, sound: null, push: null },
});

/** The workspace owner has `new_chat` off by default. */
export const workspaceOff = prefItem('new_chat', {
  bell: false,
  toast: true,
  workspaceInapp: false,
  defaults: { bell: false, toast: true, sound: true, push: true },
});

export const prefsOf = (...items: NotificationPreferenceItem[]) => ({ items });
