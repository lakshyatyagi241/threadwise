'use client';

import type { PublicProduct } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useId, useRef } from 'react';
import { valueState, type Selection } from '../lib/variants';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * One selector per product option (size, colour, anything), shared by every theme (the look comes from the `sf-` tokens). Each option
 * is a radio group: arrow keys move between the values that can still be bought, a sold-out value (given the other chosen options)
 * is struck through and disabled. Picking the same value again clears it.
 */
export function VariantPicker({
  product,
  selection,
  onChange,
}: {
  product: Pick<PublicProduct, 'options' | 'variants'>;
  selection: Selection;
  onChange: (next: Selection) => void;
}) {
  const t = useTranslations('shopPublic');
  const uid = useId();
  const groups = useRef<Array<HTMLDivElement | null>>([]);
  const options = product.options ?? [];

  const pick = (index: number, value: string | null) =>
    onChange(selection.map((v, i) => (i === index ? value : v)));

  return (
    <div className="sf-variants">
      {options.map((option, index) => {
        const chosen = selection[index] ?? null;
        const states = option.values.map((value) => ({
          value,
          ...valueState(product, selection, index, value),
        }));
        const enabled = states.filter((s) => s.available).map((s) => s.value);
        // Roving tabindex: the chosen value, else the first one that can be bought.
        const tabbable = chosen && enabled.includes(chosen) ? chosen : enabled[0];
        const labelId = `${uid}-opt-${index}`;
        return (
          <div key={option.name} className="sf-variant-group">
            <div className="sf-variant-label" id={labelId}>
              <span>{option.name}</span>
              {chosen ? <b>{chosen}</b> : null}
            </div>
            <div
              className="sf-variant-values"
              role="radiogroup"
              aria-labelledby={labelId}
              ref={(el) => {
                groups.current[index] = el;
              }}
              onKeyDown={(e) => {
                const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
                if (!keys.includes(e.key) || enabled.length === 0) return;
                e.preventDefault();
                const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
                const forward =
                  e.key === 'ArrowDown' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
                const at = chosen ? enabled.indexOf(chosen) : -1;
                const base = at >= 0 ? at : forward ? -1 : 0;
                const next =
                  enabled[(base + (forward ? 1 : -1) + enabled.length) % enabled.length]!;
                pick(index, next);
                const target = [...(groups.current[index]?.querySelectorAll('button') ?? [])].find(
                  (b) => b.dataset.value === next,
                );
                (target as HTMLElement | undefined)?.focus();
              }}
            >
              {states.map((s) => {
                const on = chosen === s.value;
                const swatch = HEX.test(s.value);
                return (
                  <button
                    key={s.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-value={s.value}
                    disabled={!s.available && !on}
                    tabIndex={s.value === tabbable ? 0 : -1}
                    className={`sf-variant${on ? ' is-on' : ''}${s.available ? '' : ' is-out'}${swatch ? ' is-swatch' : ''}`}
                    onClick={() => pick(index, on ? null : s.value)}
                  >
                    {swatch ? (
                      <span
                        className="sf-variant-dot"
                        style={{ background: s.value }}
                        aria-hidden="true"
                      />
                    ) : null}
                    {swatch ? null : <span>{s.value}</span>}
                    {swatch ? <span className="sf-sr">{s.value}</span> : null}
                    {!s.available ? (
                      <span className="sf-sr">{t('variant.soldOutValue')}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
