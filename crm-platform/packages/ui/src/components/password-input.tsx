'use client';

import { useState } from 'react';
import { cn } from '../cn';
import { Input, type InputProps } from './input';

export interface PasswordInputProps extends Omit<InputProps, 'type'> {
  showLabel?: string;
  hideLabel?: string;
}

/** Password field with a show/hide toggle (a feature of every Reference password field). */
export function PasswordInput({
  className,
  showLabel = 'Show password',
  hideLabel = 'Hide password',
  ...rest
}: PasswordInputProps) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input type={shown ? 'text' : 'password'} className={cn('pe-10', className)} {...rest} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? hideLabel : showLabel}
        aria-pressed={shown}
        className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
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
