'use client';

import { useState } from 'react';
import { Input } from '@crm/ui';
import { addTag } from './lib/draft';

/** Free-text tags: Enter or comma adds one, Backspace on an empty box removes the last, leaving the box adds what is typed. */
export function TagInput({
  id,
  tags,
  onChange,
  placeholder,
  removeLabel,
  describedBy,
}: {
  id: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
  removeLabel: (tag: string) => string;
  describedBy?: string;
}) {
  const [text, setText] = useState('');
  const commit = () => {
    if (text.trim() !== '') onChange(addTag(tags, text));
    setText('');
  };
  return (
    <div className="space-y-2">
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 ps-2.5 pe-1 font-mono text-xs"
              dir="ltr"
            >
              {tag}
              <button
                type="button"
                aria-label={removeLabel(tag)}
                onClick={() => onChange(tags.filter((x) => x !== tag))}
                className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        dir="ltr"
        value={text}
        maxLength={80}
        placeholder={placeholder}
        aria-describedby={describedBy}
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(',')) {
            const parts = v.split(',');
            const rest = parts.pop() ?? '';
            onChange(parts.reduce((acc, p) => addTag(acc, p), tags));
            setText(rest);
          } else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && text === '' && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}
