/** The emoji the composer offers, grouped the way a picker shows them. Plain characters: no dependency, and they render natively (the same sets as the web inbox). */
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

const MAX_RECENT = 16;
/** The ones a person used last, newest first. Kept for this session only: the app stores nothing about message content. */
let recent: readonly string[] = [];

export const readRecentEmoji = (): readonly string[] => recent;

export function pushRecentEmoji(emoji: string): readonly string[] {
  recent = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, MAX_RECENT);
  return recent;
}

/** For tests: forget what was used. */
export const resetRecentEmoji = () => {
  recent = [];
};
