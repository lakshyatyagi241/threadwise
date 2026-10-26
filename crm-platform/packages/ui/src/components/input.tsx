'use client';

import {
  createContext,
  useContext,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '../cn';

export interface InputProps extends ComponentProps<'input'> {
  invalid?: boolean;
  /** `type="search"` only: the accessible name of the clear button (defaults to the label set with `SearchClearLabelProvider`). */
  clearLabel?: string;
}

const SearchClearLabel = createContext('Clear search');

/** Sets the (translated) accessible name of the clear "x" that every `type="search"` Input shows while it has text. */
export function SearchClearLabelProvider({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return <SearchClearLabel.Provider value={label}>{children}</SearchClearLabel.Provider>;
}

/** The classes that size and place a box in its parent; on a search field they go on the wrapper, the rest stay on the input. */
const LAYOUT =
  /^(?:[a-z0-9-]+:)*-?(?:w|min-w|max-w|flex|basis|grow|shrink|self|order|m|mx|my|ms|me|mt|mb|ml|mr)(?:-|$)/;

/** Splits a class list into the classes that place the field in its parent and the ones that style the input itself. */
export function splitLayout(className: string | undefined) {
  const layout: string[] = [];
  const own: string[] = [];
  for (const token of (className ?? '').split(/\s+/).filter(Boolean)) {
    (LAYOUT.test(token) ? layout : own).push(token);
  }
  return { layout: layout.join(' '), own: own.join(' ') };
}

function setRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === 'function') ref(node);
  else if (ref) (ref as { current: T | null }).current = node;
}

const base =
  'h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary';

export function Input({ className, invalid, clearLabel, ...rest }: InputProps) {
  if (rest.type === 'search') {
    return (
      <SearchInput className={className} invalid={invalid} clearLabel={clearLabel} {...rest} />
    );
  }
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(base, invalid ? 'border-danger' : 'border-border', className)}
      {...rest}
    />
  );
}

/**
 * A search field with a clear "x" while it holds text. The "x" empties the field through a real input event (so the owner's
 * `onChange` runs and the results refresh), puts focus back in the field, and is a labelled button the keyboard reaches. It sits
 * at the end edge (logical, so right-to-left safe); the browser's own clear is hidden so there is one.
 */
function SearchInput({ className, invalid, clearLabel, ...rest }: InputProps) {
  const fallback = useContext(SearchClearLabel);
  const node = useRef<HTMLInputElement | null>(null);
  const [typed, setTyped] = useState(() => String(rest.defaultValue ?? '') !== '');
  const hasText = rest.value !== undefined ? String(rest.value) !== '' : typed;
  const { layout, own } = splitLayout(className);
  const { ref, onChange, ...input } = rest;

  const clear = () => {
    const el = node.current;
    if (!el) return;
    // React tracks the value itself: set it through the prototype setter, then fire the event it listens to.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  };

  return (
    <span className={cn('relative block w-full', layout)}>
      <input
        {...input}
        ref={(el) => {
          node.current = el;
          setRef(ref, el);
        }}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setTyped(e.target.value !== '');
          onChange?.(e);
        }}
        className={cn(
          base,
          invalid ? 'border-danger' : 'border-border',
          '[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none',
          own,
          'w-full',
          hasText && 'pe-9',
        )}
      />
      {hasText && !rest.disabled && !rest.readOnly && (
        <button
          type="button"
          aria-label={clearLabel ?? fallback}
          onClick={clear}
          className="absolute end-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      )}
    </span>
  );
}
