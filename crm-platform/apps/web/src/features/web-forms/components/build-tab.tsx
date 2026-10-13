'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FORM_LIMITS } from '@crm/contracts';
import { Badge, Button, EmptyState, Field, Input, Modal, Textarea, cn } from '@crm/ui';
import { blockTitle, findProperty } from '../lib/build-view';
import {
  addBlock,
  blockCount,
  boundKeys,
  canMove,
  definitionProblems,
  duplicateBlock,
  fieldFromProperty,
  findBlock,
  moveBlock,
  newDivider,
  newField,
  newHeading,
  newHiddenField,
  newParagraph,
  removeBlock,
  updateBlock,
} from '../lib/builder-model';
import type { Block, CrmProperty, FieldKind, FormHiddenSource } from '../lib/types';
import type { BuilderTabProps } from './builder-types';
import { BlockInspector } from './build-inspector';
import { BuildPalette } from './build-palette';

export interface BuildTabProps extends BuilderTabProps {
  propertiesState: 'loading' | 'ready' | 'failed';
}

/**
 * The Build tab: a palette on the left (field kinds, text blocks, hidden tracking fields, CRM properties), the ordered list of blocks
 * in the middle (select, move up or down, duplicate, delete) and the selected block's settings on the right. No drag and drop (decision
 * D3): moving is a button, which is faster to ship, keyboard complete and works on a phone. On a narrow screen the palette is a dialog.
 */
export function BuildTab(props: BuildTabProps) {
  const { draft, setDraft, canEdit, properties, propertiesState } = props;
  const t = useTranslations('web-forms.build');
  const k = useTranslations('web-forms.kinds');
  const titleId = useId();
  const descId = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const lastAdded = useRef<string | null>(null);

  const blocks = draft.steps[0]?.blocks ?? [];
  const bound = useMemo(() => boundKeys(draft), [draft]);
  const problems = useMemo(() => definitionProblems(draft, properties), [draft, properties]);
  // A deleted block simply stops being selected; nothing has to reset the stored id.
  const selectedBlock = selected ? (findBlock(draft, selected)?.block ?? null) : null;
  const full = blockCount(draft) >= FORM_LIMITS.maxBlocks;

  // On a phone the settings open under the block just added; bring them into view.
  useEffect(() => {
    if (
      lastAdded.current &&
      selected === lastAdded.current &&
      window.matchMedia('(max-width: 1279px)').matches
    ) {
      inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    lastAdded.current = null;
  }, [selected]);

  const add = (block: Block) => {
    setDraft((d) => addBlock(d, block));
    lastAdded.current = block.id;
    setSelected(block.id);
    setPaletteOpen(false);
  };
  const addField = (kind: FieldKind) =>
    add(newField(kind, k(kind), [t('optionDefault', { n: 1 }), t('optionDefault', { n: 2 })]));
  const addHidden = (source: FormHiddenSource) =>
    add(newHiddenField(source, t(`palette.source.${source}`)));
  const addBlockOf = (type: 'heading' | 'paragraph' | 'divider') =>
    add(
      type === 'heading'
        ? newHeading(t('palette.block.heading'))
        : type === 'paragraph'
          ? newParagraph('')
          : newDivider(),
    );
  const addProperty = (p: CrmProperty) => add(fieldFromProperty(p));
  /** Several properties in one go (all the address fields): they land in order, the first one selected. */
  const addProperties = (list: CrmProperty[]) => {
    const blocks = list.map(fieldFromProperty);
    if (blocks.length === 0) return;
    setDraft((d) => blocks.reduce((acc, b) => addBlock(acc, b), d));
    lastAdded.current = blocks[0]!.id;
    setSelected(blocks[0]!.id);
    setPaletteOpen(false);
  };

  const palette = (
    <BuildPalette
      properties={properties}
      propertiesState={propertiesState}
      bound={bound}
      disabled={!canEdit}
      full={full}
      onField={addField}
      onHidden={addHidden}
      onBlock={addBlockOf}
      onProperty={addProperty}
      onProperties={addProperties}
    />
  );

  const fallback = { divider: t('palette.block.divider'), paragraph: t('palette.block.paragraph') };
  const problemIds = new Set(problems.flatMap((p) => ('blockId' in p ? [p.blockId] : [])));

  return (
    <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
      <aside className="hidden xl:block" aria-label={t('palette.title')}>
        <div className="sticky top-4 max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-md border border-border bg-background p-3">
          {palette}
        </div>
      </aside>

      <section className="min-w-0 space-y-4" aria-label={t('list.title')}>
        <div className="rounded-md border border-border bg-background p-4">
          <div className="space-y-4">
            <Field label={t('formTitle')} htmlFor={titleId}>
              <Input
                id={titleId}
                value={draft.title}
                maxLength={FORM_LIMITS.maxLabel}
                invalid={draft.title.trim() === ''}
                disabled={!canEdit}
                dir="auto"
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
            </Field>
            <Field label={t('formDescription')} htmlFor={descId} hint={t('formDescriptionHint')}>
              <Textarea
                id={descId}
                rows={2}
                value={draft.description ?? ''}
                maxLength={FORM_LIMITS.maxRichText}
                disabled={!canEdit}
                dir="auto"
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value || undefined }))
                }
              />
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 xl:hidden">
          <span className="text-sm font-medium">{t('list.count', { count: blocks.length })}</span>
          <Button variant="secondary" disabled={!canEdit} onClick={() => setPaletteOpen(true)}>
            {t('palette.open')}
          </Button>
        </div>

        {blocks.length === 0 ? (
          <EmptyState
            title={t('list.emptyTitle')}
            message={t('list.emptyMessage')}
            actions={
              canEdit ? (
                <Button
                  variant="secondary"
                  className="xl:hidden"
                  onClick={() => setPaletteOpen(true)}
                >
                  {t('palette.open')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ol className="space-y-2">
            {blocks.map((b, i) => {
              const active = b.id === selected;
              const title = blockTitle(b, fallback);
              const property = b.type === 'field' ? findProperty(properties, b.bind) : null;
              const label = title || t('list.untitled');
              return (
                <li
                  key={b.id}
                  className={cn(
                    'rounded-md border bg-background transition',
                    active ? 'border-primary ring-1 ring-primary' : 'border-border',
                    problemIds.has(b.id) && !active && 'border-warning/60',
                  )}
                >
                  <div className="flex items-center gap-2 p-2">
                    <button
                      type="button"
                      aria-pressed={active}
                      aria-label={t('list.select', { name: label })}
                      onClick={() => setSelected(active ? null : b.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded px-2 py-1.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span
                        className="w-6 shrink-0 text-center font-mono text-xs text-muted-foreground"
                        aria-hidden="true"
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium" dir="auto">
                          {label}
                          {b.type === 'field' && b.required && (
                            <span className="ms-1 text-danger" aria-hidden="true">
                              *
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>
                            {b.type === 'field' ? k(b.kind) : t(`palette.block.${b.type}`)}
                          </span>
                          {b.type === 'field' && b.width === 'half' && (
                            <span>{t('list.half')}</span>
                          )}
                          {b.type === 'field' && b.bind && (
                            <Badge tone="success">
                              {t(`palette.object.${b.bind.object}`)}:{' '}
                              {property?.label ?? b.bind.property}
                            </Badge>
                          )}
                          {b.type === 'field' && b.kind === 'hidden' && b.hiddenSource && (
                            <Badge>{t(`palette.source.${b.hiddenSource}`)}</Badge>
                          )}
                          {problemIds.has(b.id) && (
                            <Badge tone="warning">{t('list.needsAttention')}</Badge>
                          )}
                        </span>
                      </span>
                    </button>
                    {canEdit && (
                      <div className="flex shrink-0 items-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t('list.up', { name: label })}
                          disabled={!canMove(draft, b.id, -1)}
                          onClick={() => setDraft((d) => moveBlock(d, b.id, -1))}
                        >
                          <span aria-hidden="true">&#8593;</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t('list.down', { name: label })}
                          disabled={!canMove(draft, b.id, 1)}
                          onClick={() => setDraft((d) => moveBlock(d, b.id, 1))}
                        >
                          <span aria-hidden="true">&#8595;</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t('list.duplicate', { name: label })}
                          disabled={full}
                          onClick={() => {
                            const copy = duplicateBlock(draft, b.id);
                            if (!copy) return;
                            setDraft(copy.def);
                            setSelected(copy.id);
                          }}
                        >
                          <span aria-hidden="true">&#10064;</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t('list.remove', { name: label })}
                          onClick={() => setDraft((d) => removeBlock(d, b.id))}
                        >
                          <span aria-hidden="true">&#215;</span>
                        </Button>
                      </div>
                    )}
                  </div>
                  {active && (
                    <div className="border-t border-border p-3 xl:hidden">
                      <BlockInspector
                        block={b}
                        properties={properties}
                        bound={bound}
                        canEdit={canEdit}
                        onChange={(next) => setDraft((d) => updateBlock(d, b.id, () => next))}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <aside className="hidden xl:block" aria-label={t('inspector.title')}>
        <div
          ref={inspectorRef}
          className="sticky top-4 max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-md border border-border bg-background p-4"
        >
          <h2 className="mb-3 text-sm font-semibold">{t('inspector.title')}</h2>
          {selectedBlock ? (
            <BlockInspector
              block={selectedBlock}
              properties={properties}
              bound={bound}
              canEdit={canEdit}
              onChange={(next) => setDraft((d) => updateBlock(d, selectedBlock.id, () => next))}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t('inspector.none')}</p>
          )}
        </div>
      </aside>

      {paletteOpen && (
        <Modal
          open
          onClose={() => setPaletteOpen(false)}
          title={t('palette.title')}
          closeLabel={t('palette.close')}
          size="md"
        >
          {palette}
        </Modal>
      )}
    </div>
  );
}
