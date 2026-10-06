'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@crm/ui';
import { HEX } from '../lib/theme';

/**
 * A text box whose typing is kept apart from the saved value: what the person types stays on screen while it is incomplete, and only
 * an accepted value is handed on. That is how a half-typed colour or address never reaches the draft (the contract would refuse it).
 * A value that changes from outside (a preset, Reset) replaces the text; the value this hook sent itself does not echo back.
 */
export function useBufferedText(
  external: string,
  accept: (text: string) => boolean,
  commit: (text: string) => void,
) {
  const [text, setText] = useState(external);
  const sent = useRef(external);
  useEffect(() => {
    if (external !== sent.current) {
      sent.current = external;
      setText(external);
    }
  }, [external]);
  const onChange = (next: string) => {
    setText(next);
    if (accept(next)) {
      sent.current = next;
      commit(next);
    }
  };
  return { text, onChange, invalid: !accept(text) };
}

/**
 * A colour token: the native swatch and a hex box on one value. Unlike the chatbot designer's field this one takes `#rrggbb` only
 * (the form contract has no other shape), and an invalid hex is flagged and held back instead of written.
 */
export function DesignColorField({
  id,
  value,
  onChange,
  swatchLabel,
  disabled,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (hex: string) => void;
  swatchLabel: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  const { text, onChange: type, invalid } = useBufferedText(value, (v) => HEX.test(v), onChange);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={swatchLabel}
        disabled={disabled}
        value={HEX.test(text) ? text.toLowerCase() : value.toLowerCase()}
        onChange={(e) => type(e.target.value.toLowerCase())}
        className="size-10 shrink-0 cursor-pointer rounded-md border border-border bg-muted p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
      />
      <input
        id={id}
        type="text"
        dir="ltr"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={text}
        maxLength={7}
        onChange={(e) => type(e.target.value)}
        className={cn(
          'h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-start font-mono text-[12.5px] outline-none',
          'focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60',
          invalid ? 'border-danger ring-2 ring-danger/40' : 'border-border',
        )}
      />
    </div>
  );
}
