'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Input, Select, cn } from '@crm/ui';
import { missingAddressParts, PALETTE_KINDS, sectionProperties } from '../lib/build-view';
import { isBound } from '../lib/builder-model';
import {
  FORM_HIDDEN_SOURCES,
  type CrmProperty,
  type FieldKind,
  type FormHiddenSource,
} from '../lib/types';

const ITEM =
  'flex w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-start text-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50';

/**
 * What can be added to the form: plain field kinds, text blocks, hidden tracking fields and the workspace's CRM properties (Contact and
 * Company, custom ones included). The same panel sits beside the list on a wide screen and in a dialog on a phone.
 */
export function BuildPalette({
  properties,
  propertiesState,
  bound,
  disabled,
  full,
  onField,
  onHidden,
  onBlock,
  onProperty,
  onProperties,
}: {
  properties: readonly CrmProperty[];
  propertiesState: 'loading' | 'ready' | 'failed';
  bound: ReadonlySet<string>;
  disabled: boolean;
  /** The form has reached the block limit: nothing more can be added. */
  full: boolean;
  onField: (kind: FieldKind) => void;
  onHidden: (source: FormHiddenSource) => void;
  onBlock: (type: 'heading' | 'paragraph' | 'divider') => void;
  onProperty: (p: CrmProperty) => void;
  /** Several properties at once (all the address fields of an object). */
  onProperties: (list: CrmProperty[]) => void;
}) {
  const t = useTranslations('web-forms.build.palette');
  const k = useTranslations('web-forms.kinds');
  const searchId = useId();
  const hiddenId = useId();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<FormHiddenSource>('utm_source');
  const sections = sectionProperties(properties, query);
  const off = disabled || full;

  return (
    <div className="space-y-6">
      {full && <p className="text-xs text-warning">{t('full')}</p>}

      <section aria-labelledby={`${searchId}-crm`}>
        <h3
          id={`${searchId}-crm`}
          className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t('crm')}
        </h3>
        <p className="mb-2 text-xs text-muted-foreground">{t('crmHint')}</p>
        <label htmlFor={searchId} className="sr-only">
          {t('searchProperties')}
        </label>
        <Input
          id={searchId}
          type="search"
          value={query}
          placeholder={t('searchProperties')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="mt-3 space-y-4" aria-live="polite">
          {propertiesState === 'loading' && (
            <p className="text-xs text-muted-foreground">{t('loadingProperties')}</p>
          )}
          {propertiesState === 'failed' && (
            <p className="text-xs text-danger">{t('propertiesFailed')}</p>
          )}
          {propertiesState === 'ready' && sections.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('noProperties')}</p>
          )}
          {sections.map((g) => {
            const missing = g.address ? missingAddressParts(g, (p) => isBound(bound, p)) : [];
            return (
              <div key={g.id} data-testid={`crm-section-${g.id}`}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{t(`section.${g.id}`)}</span>
                  {g.address && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={off || missing.length === 0}
                      onClick={() => onProperties(missing)}
                    >
                      {t('addAddress')}
                    </Button>
                  )}
                </div>
                <ul className="space-y-1.5">
                  {g.items.map((p) => {
                    const used = isBound(bound, p);
                    return (
                      <li key={`${p.object}:${p.property}`}>
                        <button
                          type="button"
                          className={cn(ITEM, 'py-1.5')}
                          disabled={off || used}
                          onClick={() => onProperty(p)}
                        >
                          <span className="min-w-0 truncate" dir="auto">
                            {p.label}
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            {p.source === 'custom' && <Badge>{t('custom')}</Badge>}
                            {p.requiredByWorkspace && (
                              <Badge tone="warning">{t('requiredByCrm')}</Badge>
                            )}
                            {used && <Badge tone="success">{t('inForm')}</Badge>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby={`${searchId}-fields`}>
        <h3
          id={`${searchId}-fields`}
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t('fields')}
        </h3>
        <ul className="grid grid-cols-2 gap-2 xl:grid-cols-1">
          {PALETTE_KINDS.map((kind) => (
            <li key={kind}>
              <button type="button" className={ITEM} disabled={off} onClick={() => onField(kind)}>
                <span>{k(kind)}</span>
                <span aria-hidden="true" className="text-muted-foreground">
                  +
                </span>
                <span className="sr-only">{t('add')}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={`${searchId}-content`}>
        <h3
          id={`${searchId}-content`}
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t('content')}
        </h3>
        <ul className="grid grid-cols-2 gap-2 xl:grid-cols-1">
          {(['heading', 'paragraph', 'divider'] as const).map((type) => (
            <li key={type}>
              <button type="button" className={ITEM} disabled={off} onClick={() => onBlock(type)}>
                <span>{t(`block.${type}`)}</span>
                <span aria-hidden="true" className="text-muted-foreground">
                  +
                </span>
                <span className="sr-only">{t('add')}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={`${searchId}-hidden`}>
        <h3
          id={`${searchId}-hidden`}
          className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t('hidden')}
        </h3>
        <p className="mb-2 text-xs text-muted-foreground">{t('hiddenHint')}</p>
        <label htmlFor={hiddenId} className="sr-only">
          {t('hiddenSource')}
        </label>
        <div className="flex gap-2">
          <Select
            id={hiddenId}
            value={source}
            disabled={off}
            onChange={(e) => setSource(e.target.value as FormHiddenSource)}
          >
            {FORM_HIDDEN_SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`source.${s}`)}
              </option>
            ))}
          </Select>
          <Button variant="secondary" disabled={off} onClick={() => onHidden(source)}>
            {t('add')}
          </Button>
        </div>
      </section>
    </div>
  );
}
