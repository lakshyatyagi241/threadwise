'use client';

import { useState } from 'react';
import { Input, cn, type InputProps } from '@crm/ui';

export interface TitledPasswordInputProps extends Omit<InputProps, 'type'> {
  showLabel: string;
  hideLabel: string;
}

/**
 * A password box with an eye button whose tooltip flips between "Show password"
 * and "Hide password" as Reference's does. `@crm/ui`'s PasswordInput names the
 * button for screen readers only; this one also sets the visible `title`.
 */
export function TitledPasswordInput({
  showLabel,
  hideLabel,
  className,
  ...rest
}: TitledPasswordInputProps) {
  const [shown, setShown] = useState(false);
  const label = shown ? hideLabel : showLabel;
  return (
    <div className="relative">
      <Input type={shown ? 'text' : 'password'} className={cn('pe-10', className)} {...rest} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={label}
        aria-pressed={shown}
        title={label}
        className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {shown ? (
            <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10.5 10.5 0 0 1 12 5c5 0 9 4 10 7a10.7 10.7 0 0 1-3.2 4.2M6.6 6.6C4.4 8 2.9 10 2 12c1 3 5 7 10 7 1.6 0 3-.4 4.3-1" />
          ) : (
            <>
              <path d="M2 12c1-3 5-7 10-7s9 4 10 7c-1 3-5 7-10 7S3 15 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}
