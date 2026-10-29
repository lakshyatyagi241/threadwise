'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { optionLabel } from '@/lib/option-label';
import { Button, Checkbox, Input, Popover, Select, Spinner, Textarea } from '@crm/ui';
import { CONSENT_CHANNELS, type ConsentAction, type ConsentChannel } from '@crm/contracts';
import { useGroups } from '../api/groups';
import { sameTagName, TAG_NAME_MAX, useTags } from '../api/tags';
import { errorKind } from '../lib/errors';

export interface TagChoice {
  tagId?: string;
  /** A name typed to create (or match) a tag; wins over the select, as in Reference. */
  name?: string;
}

/** Which bulk picker is open (they open from the "More actions" menu). */
export type BulkPicker = 'groupAdd' | 'groupRemove' | 'tagAdd' | 'tagRemove' | 'consent' | null;

/** One marketing consent change for the selection: the channels, subscribe or unsubscribe, and the note a subscription needs. */
export interface ConsentChoice {
  channels: ConsentChannel[];
  action: ConsentAction;
  note?: string;
}

/**
 * The group and tag pickers of the bulk actions (TW-CON-019..024). They are popovers anchored to the "More actions"
 * button: the menu item sets `picker`, and applying (or cancelling) closes it.
 */
export function BulkPickers({
  picker,
  canCreateTags,
  count,
  onClose,
  onGroup,
  onTag,
  onConsent,
}: {
  picker: BulkPicker;
  canCreateTags: boolean;
  /** How many contacts the selection holds; `null` for "all matching" (the count is then not known here). */
  count?: number | null;
  onClose: () => void;
  onGroup: (action: 'add' | 'remove', groupId: string) => Promise<boolean>;
  onTag: (action: 'add' | 'remove', choices: TagChoice[]) => Promise<boolean>;
  /** Only the selection bar offers marketing consent; a row's own menu does not. */
  onConsent?: (choice: ConsentChoice) => Promise<boolean>;
}) {
  return (
    <>
      {onConsent && (
        <ConsentPicker
          open={picker === 'consent'}
          count={count ?? null}
          onClose={onClose}
          onApply={async (choice) => {
            const done = await onConsent(choice);
            if (done) onClose();
            return done;
          }}
        />
      )}
      <GroupPicker
        open={picker === 'groupAdd' || picker === 'groupRemove'}
        action={picker === 'groupRemove' ? 'remove' : 'add'}
        onClose={onClose}
        onApply={async (action, id) => {
          if (await onGroup(action, id)) onClose();
        }}
      />
      <TagPicker
        open={picker === 'tagAdd' || picker === 'tagRemove'}
        action={picker === 'tagRemove' ? 'remove' : 'add'}
        canCreate={canCreateTags}
        onClose={onClose}
        onApply={async (action, choices) => {
          if (await onTag(action, choices)) onClose();
        }}
      />
    </>
  );
}

function GroupPicker({
  open,
  action,
  onClose,
  onApply,
}: {
  open: boolean;
  action: 'add' | 'remove';
  onClose: () => void;
  onApply: (action: 'add' | 'remove', groupId: string) => Promise<void>;
}) {
  const t = useTranslations('contacts-attributes-tags.bulk');
  const groups = useGroups();
  const [groupId, setGroupId] = useState('');
  const [pending, setPending] = useState(false);
  const list = groups.data ?? [];
  const chosen = groupId || list[0]?.id || '';

  return (
    <Popover
      open={open}
      onClose={onClose}
      label={action === 'add' ? t('addToGroup') : t('removeFromGroup')}
    >
      <div className="text-xs font-semibold">
        {action === 'add' ? t('addToGroup') : t('removeFromGroup')}
      </div>
      {groups.isError ? (
        <p className="text-sm text-muted-foreground">
          {errorKind(groups.error) === 'unavailable' ? t('groupsUnavailable') : t('groupsFailed')}
        </p>
      ) : list.length === 0 && !groups.isPending ? (
        <p className="text-sm text-muted-foreground">{t('createGroupFirst')}</p>
      ) : (
        <Select
          aria-label={t('group')}
          value={chosen}
          onChange={(e) => setGroupId(e.target.value)}
          disabled={groups.isPending}
        >
          {list.map((g) => (
            <option key={g.id} value={g.id} title={g.name}>
              {optionLabel(g.name)}
            </option>
          ))}
        </Select>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button
          size="sm"
          disabled={!chosen || pending}
          onClick={async () => {
            setPending(true);
            try {
              await onApply(action, chosen);
            } finally {
              setPending(false);
            }
          }}
        >
          {pending && <Spinner />}
          {t('apply')}
        </Button>
      </div>
    </Popover>
  );
}

function TagPicker({
  open,
  action,
  canCreate,
  onClose,
  onApply,
}: {
  open: boolean;
  action: 'add' | 'remove';
  canCreate: boolean;
  onClose: () => void;
  onApply: (action: 'add' | 'remove', choices: TagChoice[]) => Promise<void>;
}) {
  const t = useTranslations('contacts-attributes-tags.bulk');
  const tags = useTags(open);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<'pick' | 'none' | null>(null);
  const [pending, setPending] = useState(false);
  const list = tags.data ?? [];

  async function apply() {
    const typed = action === 'add' ? name.trim() : '';
    if (action === 'remove' && list.length === 0) return setProblem('none');
    if (!typed && picked.length === 0) return setProblem('pick');
    setProblem(null);
    setPending(true);
    try {
      const choices: TagChoice[] = picked.map((tagId) => ({ tagId }));
      // Typing a name that already exists reuses that tag.
      if (typed) {
        const existing = list.find((x) => sameTagName(x.name, typed));
        if (existing) {
          if (!picked.includes(existing.id)) choices.push({ tagId: existing.id });
        } else {
          choices.push({ name: typed });
        }
      }
      await onApply(action, choices);
      setName('');
      setPicked([]);
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover open={open} onClose={onClose} label={action === 'add' ? t('addTag') : t('removeTag')}>
      <div className="text-xs font-semibold">{action === 'add' ? t('addTag') : t('removeTag')}</div>
      {list.length > 0 ? (
        <ul aria-label={t('tagSelect')} className="thin-scrollbar max-h-48 space-y-1 overflow-auto">
          {list.map((x) => (
            <li key={x.id}>
              <Checkbox
                label={x.contactCount === undefined ? x.name : `${x.name} (${x.contactCount})`}
                checked={picked.includes(x.id)}
                onChange={() =>
                  setPicked((cur) =>
                    cur.includes(x.id) ? cur.filter((id) => id !== x.id) : [...cur, x.id],
                  )
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {tags.isPending ? t('loading') : action === 'add' ? t('noTagsType') : t('noTagsToRemove')}
        </p>
      )}
      {action === 'add' && canCreate && (
        <Input
          value={name}
          maxLength={TAG_NAME_MAX}
          placeholder={t('newTagPlaceholder')}
          aria-label={t('newTagLabel')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void apply();
            }
          }}
        />
      )}
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem === 'none' ? t('noTagsToRemove') : t('pickOrType')}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button size="sm" disabled={pending} onClick={() => void apply()}>
          {pending && <Spinner />}
          {t('apply')}
        </Button>
      </div>
    </Popover>
  );
}

/**
 * Marketing consent for the selection, one or more channels at a time. Two steps: the form (channels, subscribe or unsubscribe, and for a
 * subscription the note of how the contacts agreed), then a confirmation that says what will be written, before anything is sent.
 */
function ConsentPicker({
  open,
  count,
  onClose,
  onApply,
}: {
  open: boolean;
  count: number | null;
  onClose: () => void;
  onApply: (choice: ConsentChoice) => Promise<boolean>;
}) {
  const t = useTranslations('contacts-attributes-tags.bulk');
  const tc = useTranslations('contact-consent.card.channel');
  const locale = useLocale();
  const [channels, setChannels] = useState<ConsentChannel[]>(['whatsapp']);
  const [action, setAction] = useState<ConsentAction>('granted');
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [problem, setProblem] = useState(false);
  const [pending, setPending] = useState(false);
  const needsNote = action === 'granted';
  const choice: ConsentChoice = { channels, action, ...(needsNote ? { note: note.trim() } : {}) };
  const channelList = useMemo(() => {
    const names = CONSENT_CHANNELS.filter((c) => channels.includes(c)).map((c) => tc(c));
    try {
      return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);
    } catch {
      return names.join(', ');
    }
  }, [channels, locale, tc]);

  function reset() {
    setStep('form');
    setProblem(false);
    setNote('');
  }

  function next() {
    if (needsNote && !note.trim()) return setProblem(true);
    setProblem(false);
    setStep('confirm');
  }

  return (
    <Popover
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      label={t('consentTitle')}
    >
      <div className="text-xs font-semibold">{t('consentTitle')}</div>
      {step === 'form' ? (
        <>
          <fieldset className="flex max-h-48 flex-col gap-2 overflow-y-auto">
            <legend className="sr-only">{t('consentChannel')}</legend>
            {CONSENT_CHANNELS.map((c) => (
              <Checkbox
                key={c}
                checked={channels.includes(c)}
                onChange={(e) =>
                  setChannels(
                    CONSENT_CHANNELS.filter((x) =>
                      x === c ? e.target.checked : channels.includes(x),
                    ),
                  )
                }
                label={tc(c)}
              />
            ))}
          </fieldset>
          <Select
            aria-label={t('consentAction')}
            value={action}
            onChange={(e) => setAction(e.target.value as ConsentAction)}
          >
            <option value="granted">{t('consentSubscribe')}</option>
            <option value="withdrawn">{t('consentUnsubscribe')}</option>
          </Select>
          {needsNote && (
            <Textarea
              aria-label={t('consentNote')}
              placeholder={t('consentNotePlaceholder')}
              maxLength={500}
              rows={2}
              value={note}
              invalid={problem}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
          {problem && (
            <p role="alert" className="text-xs text-danger">
              {t('consentNoteRequired')}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button size="sm" disabled={channels.length === 0} onClick={next}>
              {t('consentContinue')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm">
            {t('consentSummary', {
              channel: channelList,
              change: t(action === 'granted' ? 'consentChangeGranted' : 'consentChangeWithdrawn'),
              count: count ?? 0,
            })}
          </p>
          {count === null && (
            <p className="text-xs text-muted-foreground">{t('consentAllMatching')}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setStep('form')}>
              {t('consentBack')}
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                try {
                  if (await onApply(choice)) reset();
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending && <Spinner />}
              {t('consentConfirm')}
            </Button>
          </div>
        </>
      )}
    </Popover>
  );
}
