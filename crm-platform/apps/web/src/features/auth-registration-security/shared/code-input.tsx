'use client';

import { Input, cn, type InputProps } from '@crm/ui';

/** Keeps digits only, at most `length` of them. Exported for tests and for pasted codes with spaces ("123 456"). */
export function sanitizeCode(raw: string, length = 6): string {
  return raw.replace(/\D/g, '').slice(0, length);
}

interface Props extends Omit<InputProps, 'value' | 'onChange' | 'type'> {
  value: string;
  onValueChange: (value: string) => void;
  length?: number;
}

/** A one-time-code box: numeric keypad on phones, one-time-code autofill, centred monospace digits. */
export function CodeInput({ value, onValueChange, length = 6, className, ...rest }: Props) {
  return (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={length + 2}
      spellCheck={false}
      dir="ltr"
      value={value}
      onChange={(e) => onValueChange(sanitizeCode(e.target.value, length))}
      className={cn('text-center font-mono text-lg tracking-[0.4em]', className)}
      {...rest}
    />
  );
}
