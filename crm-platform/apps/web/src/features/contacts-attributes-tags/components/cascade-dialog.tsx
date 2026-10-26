'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type {
  FieldDependencyResponse,
  FieldOptionDependencyResponse,
  FieldOptionResponse,
  FieldResponse,
} from '@crm/contracts';
import { Button, Checkbox, ConfirmDialog, Field, Modal, Select, Spinner, useToast } from '@crm/ui';
import {
  hasLazyOptions,
  invalidateProperties,
  removeCascade,
  replaceCascade,
} from '../api/properties';
import { errorKind } from '../lib/errors';
import { isCascadeLink } from '../lib/field-values';
import { isOptionType } from '../lib/property-model';
import { ErrorLine } from './error-line';
import { PencilIcon, TrashIcon } from './icons';

/** Which choices a dependent field offers under each choice of its parent: the cascade's option pairs, edited as a grid. */
export interface CascadeDialogProps {
  open: boolean;
  /** Every property of the module (inactive ones too: they are skipped as choices). */
  fields: readonly FieldResponse[];
  dependencies: readonly FieldDependencyResponse[];
  optionDependencies: readonly FieldOptionDependencyResponse[];
  /** Whether the person may change cascades; without it the dialog only lists them. */
  canEdit: boolean;
  onClose: () => void;
}

/** A pair as a key; ids are uuids, so the separator cannot clash. */
const pairKey = (parentOptionId: string, childOptionId: string) =>
  `${parentOptionId}|${childOptionId}`;

const byPosition = (a: FieldOptionResponse, b: FieldOptionResponse) => a.position - b.position;

export function CascadeDialog({
  open,
  fields,
  dependencies,
  optionDependencies,
  canEdit,
  onClose,
}: CascadeDialogProps) {
  const t = useTranslations('contacts-attributes-tags.properties.cascade');
  const qc = useQueryClient();
  const { toast } = useToast();
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;

  const byId = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
  // Only a property whose choices are all here can take part: a long list comes without them.
  const choiceFields = useMemo(
    () => fields.filter((f) => f.isActive && isOptionType(f.fieldType) && !hasLazyOptions(f)),
    [fields],
  );
  const cascadeLinks = useMemo(() => dependencies.filter(isCascadeLink), [dependencies]);
  const cascadeChildIds = useMemo(
    () => new Set(cascadeLinks.map((d) => d.fieldId)),
    [cascadeLinks],
  );
  const childrenWithParents = useMemo(
    () =>
      [...cascadeChildIds].flatMap((childId) => {
        const child = byId.get(childId);
        const parents = cascadeLinks
          .filter((d) => d.fieldId === childId)
          .flatMap((d) => byId.get(d.dependsOnFieldId) ?? []);
        return child && parents.length > 0 ? [{ child, parents }] : [];
      }),
    [cascadeChildIds, cascadeLinks, byId],
  );

  /** The editor is closed (`list`), adding a cascade (`new`), or editing the cascade of one dependent field (`edit`). */
  const [mode, setMode] = useState<{ kind: 'list' } | { kind: 'edit'; childId: string | null }>({
    kind: 'list',
  });
  const [parentId, setParentId] = useState('');
  const [childId, setChildId] = useState('');
  const [pairs, setPairs] = useState<ReadonlySet<string>>(new Set());
  const [removing, setRemoving] = useState<FieldResponse | null>(null);

  const parent = parentId ? byId.get(parentId) : undefined;
  const child = childId ? byId.get(childId) : undefined;
  const editingChildId = mode.kind === 'edit' ? mode.childId : null;

  const parentChoices = choiceFields;
  const childChoices = choiceFields.filter(
    (f) => f.id !== parentId && (!cascadeChildIds.has(f.id) || f.id === editingChildId),
  );

  /** The pairs stored for this parent and child, so the grid starts from what is saved. */
  function storedPairs(p: string, c: string): Set<string> {
    return new Set(
      optionDependencies
        .filter((o) => o.parentFieldId === p && o.childFieldId === c)
        .map((o) => pairKey(o.parentOptionId, o.childOptionId)),
    );
  }

  function openEditor(childFieldId: string | null, parentFieldId: string) {
    const parentField = parentFieldId ? byId.get(parentFieldId) : undefined;
    const childField = childFieldId ? byId.get(childFieldId) : undefined;
    setMode({ kind: 'edit', childId: childFieldId });
    setParentId(parentField?.id ?? '');
    setChildId(childField?.id ?? '');
    setPairs(parentField && childField ? storedPairs(parentField.id, childField.id) : new Set());
  }

  function pickParent(value: string) {
    setParentId(value);
    setPairs(value && childId ? storedPairs(value, childId) : new Set());
  }

  function pickChild(value: string) {
    setChildId(value);
    setPairs(value && parentId ? storedPairs(parentId, value) : new Set());
  }

  function togglePair(parentOptionId: string, childOptionId: string) {
    const key = pairKey(parentOptionId, childOptionId);
    setPairs((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!parent || !child) return;
      const parentOptionIds = new Set(parent.options?.map((o) => o.id) ?? []);
      const childOptionIds = new Set(child.options?.map((o) => o.id) ?? []);
      const optionPairs = [...pairs]
        .map((k) => k.split('|') as [string, string])
        .filter(([p, c]) => parentOptionIds.has(p) && childOptionIds.has(c))
        .map(([parentOptionId, childOptionId]) => ({ parentOptionId, childOptionId }));
      await replaceCascade(child.id, { dependsOnFieldId: parent.id, optionPairs });
    },
    onSuccess: async () => {
      await invalidateProperties(qc);
      toast(t('saved'), 'success');
      setMode({ kind: 'list' });
    },
    onError: () => void invalidateProperties(qc),
  });

  const remove = useMutation({
    mutationFn: (f: FieldResponse) => removeCascade(f.id),
    onSuccess: async () => {
      await invalidateProperties(qc);
      toast(t('removed'), 'success');
      setRemoving(null);
    },
    onError: () => {
      void invalidateProperties(qc);
      toast(t('removeFailed'), 'danger');
      setRemoving(null);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const editing = mode.kind === 'edit';
  const cycle = save.isError && errorKind(save.error) === 'dependencyCycle';
  const parentOptions = (parent?.options ?? []).filter((o) => !o.isHidden).sort(byPosition);
  const childOptions = (child?.options ?? []).filter((o) => !o.isHidden).sort(byPosition);

  return (
    <>
      <Modal open={open} onClose={onClose} size="lg" title={t('title')} closeLabel={t('close')}>
        {editing ? (
          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <p className="text-sm text-muted-foreground">{t('intro')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('parent')} htmlFor={id('parent')}>
                <Select
                  id={id('parent')}
                  value={parentId}
                  disabled={editingChildId !== null}
                  onChange={(e) => pickParent(e.target.value)}
                >
                  <option value="">{t('pickParent')}</option>
                  {parentChoices.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('child')} htmlFor={id('child')}>
                <Select
                  id={id('child')}
                  value={childId}
                  disabled={editingChildId !== null}
                  onChange={(e) => pickChild(e.target.value)}
                >
                  <option value="">{t('pickChild')}</option>
                  {childChoices.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {parent && child && (
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">
                  {t('allowed', { child: child.label, parent: parent.label })}
                </legend>
                {parentOptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noParentChoices')}</p>
                ) : childOptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noChildChoices')}</p>
                ) : (
                  parentOptions.map((po) => (
                    <div key={po.id} className="rounded-md border border-border p-3">
                      <div className="mb-2 text-sm font-medium" dir="auto">
                        {po.label}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {childOptions.map((co) => (
                          <Checkbox
                            key={co.id}
                            id={id(`${po.id}-${co.id}`)}
                            label={co.label}
                            checked={pairs.has(pairKey(po.id, co.id))}
                            onChange={() => togglePair(po.id, co.id)}
                          />
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </fieldset>
            )}

            {save.isError && (
              <div className="space-y-2">
                <ErrorLine error={save.error} />
                {cycle && <p className="text-xs text-muted-foreground">{t('cycle')}</p>}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button
                variant="secondary"
                disabled={save.isPending}
                onClick={() => setMode({ kind: 'list' })}
              >
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={save.isPending || !parent || !child}>
                {save.isPending && <Spinner />}
                {t('save')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('intro')}</p>
            {childrenWithParents.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                {t('empty')}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {childrenWithParents.map(({ child: c, parents }) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <span className="min-w-0 text-sm">
                      <span className="font-medium" dir="auto">
                        {c.label}
                      </span>{' '}
                      <span className="text-muted-foreground">
                        {t('dependsOn', { parent: parents.map((p) => p.label).join(', ') })}
                      </span>
                    </span>
                    {canEdit && (
                      <span className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('editLabel', { name: c.label })}
                          onClick={() => openEditor(c.id, parents[0]!.id)}
                        >
                          <PencilIcon className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('removeLabel', { name: c.label })}
                          onClick={() => setRemoving(c)}
                        >
                          <TrashIcon className="size-3.5" />
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <div className="flex justify-end">
                <Button disabled={choiceFields.length < 2} onClick={() => openEditor(null, '')}>
                  {t('add')}
                </Button>
              </div>
            )}
            {canEdit && choiceFields.length < 2 && (
              <p className="text-xs text-muted-foreground">{t('needTwoChoiceFields')}</p>
            )}
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={removing !== null}
        tone="danger"
        busy={remove.isPending}
        title={t('removeTitle', { name: removing?.label ?? '' })}
        message={t('removeMessage')}
        confirmLabel={t('removeConfirm')}
        cancelLabel={t('cancel')}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </>
  );
}
