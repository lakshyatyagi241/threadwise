import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

export function Checkbox({ label, className, id, ...rest }: CheckboxProps) {
  return (
    <label htmlFor={id} className={cn('flex cursor-pointer items-start gap-2 text-sm', className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 rounded border-border accent-[var(--primary)]"
        {...rest}
      />
      <span>{label}</span>
    </label>
  );
}
