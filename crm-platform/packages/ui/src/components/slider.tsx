import type { ComponentProps } from 'react';
import { cn } from '../cn';

export interface SliderProps extends Omit<ComponentProps<'input'>, 'type' | 'onChange' | 'value'> {
  value: number;
  onValueChange: (value: number) => void;
}

/**
 * A native range input (keyboard: arrows, Home, End, PageUp/Down come for free). Give it an accessible name with `aria-label`
 * or a `<label htmlFor>`, and put the live number in `aria-valuetext` when the raw value is not what a person should hear.
 */
export function Slider({
  value,
  onValueChange,
  className,
  min = 0,
  max = 1,
  step = 0.01,
  ...rest
}: SliderProps) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onValueChange(Number(e.target.value))}
      className={cn(
        'h-6 w-full cursor-pointer accent-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
      {...rest}
    />
  );
}
