/** The emoji the composer offers, grouped the way a picker shows them. Plain characters: no dependency, and they render natively. */
export const EMOJI_GROUPS = [
  {
    id: 'smileys',
    icon: '😀',
    emoji: [
      '😀',
      '😃',
      '😄',
      '😁',
      '😆',
      '😅',
      '😂',
      '🤣',
      '🙂',
      '😉',
      '😊',
      '😇',
      '🥰',
      '😍',
      '🤩',
      '😘',
      '😋',
      '😛',
      '😜',
      '🤪',
      '🤔',
      '🤗',
      '🤭',
      '😏',
      '😌',
      '😴',
      '😎',
      '🤓',
      '🥳',
      '😕',
      '😟',
      '🙁',
      '😮',
      '😢',
      '😭',
      '😤',
      '😡',
      '🥺',
      '😱',
      '🤝',
    ],
  },
  {
    id: 'gestures',
    icon: '👍',
    emoji: [
      '👍',
      '👎',
      '👌',
      '✌️',
      '🤞',
      '🤟',
      '🤙',
      '👏',
      '🙌',
      '🙏',
      '💪',
      '👋',
      '🤚',
      '✋',
      '👀',
      '🫡',
    ],
  },
  {
    id: 'hearts',
    icon: '❤️',
    emoji: [
      '❤️',
      '🧡',
      '💛',
      '💚',
      '💙',
      '💜',
      '🖤',
      '🤍',
      '💔',
      '💕',
      '💖',
      '💯',
      '🔥',
      '✨',
      '⭐',
      '🎉',
    ],
  },
  {
    id: 'objects',
    icon: '📦',
    emoji: [
      '📦',
      '📞',
      '📱',
      '💻',
      '📧',
      '📅',
      '📍',
      '🔔',
      '💰',
      '💳',
      '🎁',
      '🛒',
      '🚚',
      '✅',
      '❌',
      '⚠️',
      '❓',
      '❗',
      '⏰',
      '📎',
      '📝',
      '🔗',
      '🏷️',
      '🎯',
    ],
  },
] as const;

export type EmojiGroupId = (typeof EMOJI_GROUPS)[number]['id'];

/** The ones a person used last, newest first, kept short; the list lives in this browser only. */
const KEY = 'inbox.recentEmoji';
const MAX_RECENT = 16;

export function readRecentEmoji(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}

export function pushRecentEmoji(emoji: string): string[] {
  const next = [emoji, ...readRecentEmoji().filter((e) => e !== emoji)].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage is off (private window): the picker still works, it just does not remember.
  }
  return next;
}
