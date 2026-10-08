interface MessageLike {
  role?: string;
  content?: unknown;
}

function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content.trim() || null;
  if (Array.isArray(content)) {
    const text = content
      .map((p) =>
        p && typeof p === 'object' && (p as { type?: string }).type === 'text'
          ? String((p as { text?: unknown }).text ?? '').trim()
          : '',
      )
      .filter(Boolean)
      .join(' ');
    return text || null;
  }
  return null;
}

/**
 * Which question a block answers. A turn is "the n-th message the person sent"; every block shown while answering it belongs to the
 * same report. The prompt is that message's text, kept so "Refresh data" can ask the same thing again.
 */
export function turnOf(messages: readonly MessageLike[] | undefined): {
  turn: string;
  prompt: string | null;
} {
  const users = (messages ?? []).filter((m) => m.role === 'user');
  const last = users.at(-1);
  return { turn: String(users.length), prompt: last ? textOf(last.content) : null };
}
