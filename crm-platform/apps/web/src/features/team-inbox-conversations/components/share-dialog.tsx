'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button, Input, Modal, Spinner, Tabs, Textarea, cn, useToast } from '@crm/ui';
import {
  BUTTON_LIMITS,
  CONTACT_CARDS_MAX,
  EMPTY_BUTTONS,
  EMPTY_CONTACT,
  EMPTY_LOCATION,
  EMPTY_SECTION,
  buildButtons,
  buildContacts,
  buildLocation,
  listRowCount,
  splitPair,
  type Built,
  type ButtonsForm,
  type ContactForm,
  type LocationForm,
  type ShareInput,
} from '../lib/share';
import { useErrorText } from './parts';

export type ShareKind = 'location' | 'contacts' | 'buttons';

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  /** What this channel can send: a tab is offered only for a kind it carries. */
  kinds: readonly ShareKind[];
  /** Sends it; rejects with the API error so the dialog can show it and stay open. */
  onSend: (input: ShareInput) => Promise<void>;
}

/**
 * "Share": a place, contact cards or buttons for the customer. One dialog, one tab per kind the channel carries. Nothing is sent
 * until the form is valid; a refused send (window closed, channel off) is shown in the dialog and the form is kept.
 */
export function ShareDialog(props: ShareDialogProps) {
  // Mounted only while open, so each opening starts empty.
  return props.open && props.kinds.length > 0 ? <ShareDialogBody {...props} /> : null;
}

function ShareDialogBody({ onClose, onSend, kinds }: ShareDialogProps) {
  const t = useTranslations('team-inbox-conversations.composer.share');
  const errorText = useErrorText();
  const { toast } = useToast();
  const [tab, setTab] = useState<ShareKind>(kinds[0]!);
  const [location, setLocation] = useState<LocationForm>(EMPTY_LOCATION);
  const [cards, setCards] = useState<ContactForm[]>([EMPTY_CONTACT]);
  const [buttons, setButtons] = useState<ButtonsForm>(EMPTY_BUTTONS);
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const built: Built<ShareInput> =
    tab === 'location'
      ? buildLocation(location)
      : tab === 'contacts'
        ? buildContacts(cards)
        : buildButtons(buttons);
  const problems = built.ok ? {} : built.problems;
  const problem = (key: string) => (touched ? problems[key] : undefined);

  async function send() {
    setTouched(true);
    if (!built.ok || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(built.input);
      toast(t('sent'), 'success');
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSending(false);
    }
  }

  const items = kinds.map((k) => ({
    id: k,
    label: t(`tab.${k}`),
    content: (
      <div className="space-y-4 pt-4" data-testid={`inbox-share-${k}`}>
        {k === 'location' && (
          <LocationFields value={location} onChange={setLocation} problem={problem} />
        )}
        {k === 'contacts' && <ContactFields cards={cards} onChange={setCards} problem={problem} />}
        {k === 'buttons' && (
          <ButtonFields value={buttons} onChange={setButtons} problem={problem} />
        )}
      </div>
    ),
  }));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t('title')}
      eyebrow={t('eyebrow')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose} disabled={sending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            data-testid="inbox-share-send"
            onClick={() => void send()}
            disabled={sending || (touched && !built.ok)}
          >
            {sending && <Spinner />}
            {sending ? t('sending') : t('send')}
          </Button>
        </>
      }
    >
      <p className="text-xs text-muted-foreground">{t('windowHint')}</p>
      <Tabs
        items={items}
        value={tab}
        onValueChange={(id) => {
          setTab(id as ShareKind);
          setTouched(false);
          setError(null);
        }}
      />
      {error && (
        <p role="alert" data-testid="inbox-share-error" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}

type ProblemFn = (key: string) => string | undefined;

function FieldRow(props: {
  id: string;
  label: string;
  problem?: string | undefined;
  problemLabel?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={props.id} className="block text-sm">
        {props.label}
      </label>
      {props.children}
      {props.hint && !props.problem && (
        <p className="text-xs text-muted-foreground">{props.hint}</p>
      )}
      {props.problem && (
        <p id={`${props.id}-error`} role="alert" className="text-xs text-danger">
          {props.problemLabel}
        </p>
      )}
    </div>
  );
}

function LocationFields(props: {
  value: LocationForm;
  onChange: (v: LocationForm) => void;
  problem: ProblemFn;
}) {
  const t = useTranslations('team-inbox-conversations.composer.share');
  const base = useId();
  const v = props.value;
  const set = (patch: Partial<LocationForm>) => props.onChange({ ...v, ...patch });
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldRow
          id={`${base}-lat`}
          label={t('location.latitude')}
          problem={props.problem('latitude')}
          problemLabel={t(`problem.${props.problem('latitude') ?? 'required'}`, {
            label: t('location.latitude'),
          })}
          hint={t('location.pasteHint')}
        >
          <Input
            id={`${base}-lat`}
            inputMode="decimal"
            autoFocus
            value={v.latitude}
            invalid={props.problem('latitude') !== undefined}
            placeholder="28.6139"
            data-testid="inbox-share-latitude"
            onChange={(e) => {
              // "28.6139, 77.2090" copied from a map fills both boxes.
              const pair = splitPair(e.target.value);
              set(pair ? { latitude: pair[0], longitude: pair[1] } : { latitude: e.target.value });
            }}
          />
        </FieldRow>
        <FieldRow
          id={`${base}-lng`}
          label={t('location.longitude')}
          problem={props.problem('longitude')}
          problemLabel={t(`problem.${props.problem('longitude') ?? 'required'}`, {
            label: t('location.longitude'),
          })}
        >
          <Input
            id={`${base}-lng`}
            inputMode="decimal"
            value={v.longitude}
            invalid={props.problem('longitude') !== undefined}
            placeholder="77.2090"
            data-testid="inbox-share-longitude"
            onChange={(e) => set({ longitude: e.target.value })}
          />
        </FieldRow>
      </div>
      <FieldRow id={`${base}-name`} label={t('location.name')}>
        <Input
          id={`${base}-name`}
          value={v.name}
          maxLength={255}
          data-testid="inbox-share-place-name"
          onChange={(e) => set({ name: e.target.value })}
        />
      </FieldRow>
      <FieldRow id={`${base}-addr`} label={t('location.address')}>
        <Input
          id={`${base}-addr`}
          value={v.address}
          maxLength={500}
          onChange={(e) => set({ address: e.target.value })}
        />
      </FieldRow>
    </>
  );
}

function ContactFields(props: {
  cards: ContactForm[];
  onChange: (v: ContactForm[]) => void;
  problem: ProblemFn;
}) {
  const t = useTranslations('team-inbox-conversations.composer.share');
  const base = useId();
  const { cards } = props;
  const patch = (i: number, p: Partial<ContactForm>) =>
    props.onChange(cards.map((c, n) => (n === i ? { ...c, ...p } : c)));
  const label = (key: string, name: string) => t(`problem.${key}`, { label: name });
  return (
    <>
      {cards.map((c, i) => (
        <fieldset key={i} className="space-y-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">{t('contact.card', { n: i + 1 })}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldRow
              id={`${base}-${i}-name`}
              label={t('contact.name')}
              problem={props.problem(`${i}.name`)}
              problemLabel={label(props.problem(`${i}.name`) ?? 'required', t('contact.name'))}
            >
              <Input
                id={`${base}-${i}-name`}
                value={c.name}
                maxLength={200}
                autoFocus={i === 0}
                invalid={props.problem(`${i}.name`) !== undefined}
                data-testid={`inbox-share-contact-name-${i}`}
                onChange={(e) => patch(i, { name: e.target.value })}
              />
            </FieldRow>
            <FieldRow id={`${base}-${i}-org`} label={t('contact.org')}>
              <Input
                id={`${base}-${i}-org`}
                value={c.org}
                maxLength={200}
                onChange={(e) => patch(i, { org: e.target.value })}
              />
            </FieldRow>
            <FieldRow
              id={`${base}-${i}-phone`}
              label={t('contact.phone')}
              problem={props.problem(`${i}.phone`)}
              problemLabel={label(props.problem(`${i}.phone`) ?? 'phone', t('contact.phone'))}
            >
              <Input
                id={`${base}-${i}-phone`}
                type="tel"
                value={c.phone}
                maxLength={32}
                invalid={props.problem(`${i}.phone`) !== undefined}
                placeholder="+91 98765 43210"
                data-testid={`inbox-share-contact-phone-${i}`}
                onChange={(e) => patch(i, { phone: e.target.value })}
              />
            </FieldRow>
            <FieldRow
              id={`${base}-${i}-email`}
              label={t('contact.email')}
              problem={props.problem(`${i}.email`)}
              problemLabel={label(props.problem(`${i}.email`) ?? 'email', t('contact.email'))}
            >
              <Input
                id={`${base}-${i}-email`}
                type="email"
                value={c.email}
                maxLength={254}
                invalid={props.problem(`${i}.email`) !== undefined}
                onChange={(e) => patch(i, { email: e.target.value })}
              />
            </FieldRow>
          </div>
          {cards.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => props.onChange(cards.filter((_, n) => n !== i))}
            >
              {t('contact.remove', { n: i + 1 })}
            </Button>
          )}
        </fieldset>
      ))}
      {cards.length < CONTACT_CARDS_MAX && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="inbox-share-add-contact"
          onClick={() => props.onChange([...cards, EMPTY_CONTACT])}
        >
          {t('contact.add')}
        </Button>
      )}
    </>
  );
}

function ButtonFields(props: {
  value: ButtonsForm;
  onChange: (v: ButtonsForm) => void;
  problem: ProblemFn;
}) {
  const t = useTranslations('team-inbox-conversations.composer.share');
  const base = useId();
  const v = props.value;
  const set = (p: Partial<ButtonsForm>) => props.onChange({ ...v, ...p });
  const err = (key: string, name: string) => {
    const p = props.problem(key);
    return p ? t(`problem.${p}`, { label: name }) : undefined;
  };
  return (
    <>
      <div role="group" aria-label={t('buttons.type')} className="flex gap-2">
        {(['buttons', 'list', 'cta_url'] as const).map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={v.type === type}
            data-testid={`inbox-share-type-${type}`}
            onClick={() => set({ type })}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-primary',
              v.type === type
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {t(`buttons.kind.${type}`)}
          </button>
        ))}
      </div>
      <FieldRow id={`${base}-header`} label={t('buttons.header')}>
        <Input
          id={`${base}-header`}
          value={v.header}
          maxLength={BUTTON_LIMITS.header}
          onChange={(e) => set({ header: e.target.value })}
        />
      </FieldRow>
      <FieldRow
        id={`${base}-body`}
        label={t('buttons.body')}
        problem={props.problem('body')}
        problemLabel={err('body', t('buttons.body'))}
      >
        <Textarea
          id={`${base}-body`}
          rows={3}
          value={v.body}
          maxLength={BUTTON_LIMITS.body}
          invalid={props.problem('body') !== undefined}
          data-testid="inbox-share-buttons-body"
          onChange={(e) => set({ body: e.target.value })}
        />
      </FieldRow>
      <FieldRow id={`${base}-footer`} label={t('buttons.footer')}>
        <Input
          id={`${base}-footer`}
          value={v.footer}
          maxLength={BUTTON_LIMITS.footer}
          onChange={(e) => set({ footer: e.target.value })}
        />
      </FieldRow>
      {v.type === 'list' ? (
        <ListFields value={v} onChange={props.onChange} problem={props.problem} />
      ) : v.type === 'buttons' ? (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">{t('buttons.titles')}</legend>
          {v.titles.map((title, i) => (
            <div key={i} className="space-y-1">
              <Input
                aria-label={t('buttons.titleN', { n: i + 1 })}
                value={title}
                maxLength={BUTTON_LIMITS.title}
                invalid={props.problem(`title.${i}`) !== undefined}
                placeholder={t('buttons.titleN', { n: i + 1 })}
                data-testid={`inbox-share-button-title-${i}`}
                onChange={(e) =>
                  set({ titles: v.titles.map((x, n) => (n === i ? e.target.value : x)) })
                }
              />
              {props.problem(`title.${i}`) && (
                <p role="alert" className="text-xs text-danger">
                  {err(`title.${i}`, t('buttons.titleN', { n: i + 1 }))}
                </p>
              )}
            </div>
          ))}
          {v.titles.length < BUTTON_LIMITS.max && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="inbox-share-add-button"
              onClick={() => set({ titles: [...v.titles, ''] })}
            >
              {t('buttons.add')}
            </Button>
          )}
        </fieldset>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldRow
            id={`${base}-linktext`}
            label={t('buttons.linkText')}
            problem={props.problem('linkText')}
            problemLabel={err('linkText', t('buttons.linkText'))}
          >
            <Input
              id={`${base}-linktext`}
              value={v.linkText}
              maxLength={BUTTON_LIMITS.title}
              invalid={props.problem('linkText') !== undefined}
              onChange={(e) => set({ linkText: e.target.value })}
            />
          </FieldRow>
          <FieldRow
            id={`${base}-url`}
            label={t('buttons.url')}
            problem={props.problem('url')}
            problemLabel={err('url', t('buttons.url'))}
          >
            <Input
              id={`${base}-url`}
              type="url"
              value={v.url}
              invalid={props.problem('url') !== undefined}
              placeholder="https://"
              data-testid="inbox-share-url"
              onChange={(e) => set({ url: e.target.value })}
            />
          </FieldRow>
        </div>
      )}
    </>
  );
}

function ListFields(props: {
  value: ButtonsForm;
  onChange: (v: ButtonsForm) => void;
  problem: ProblemFn;
}) {
  const t = useTranslations('team-inbox-conversations.composer.share');
  const base = useId();
  const v = props.value;
  const total = listRowCount(v.sections);
  const setSections = (sections: ButtonsForm['sections']) => props.onChange({ ...v, sections });
  const err = (key: string, name: string) => {
    const p = props.problem(key);
    return p ? t(`problem.${p}`, { label: name }) : undefined;
  };
  return (
    <>
      <FieldRow
        id={`${base}-listbtn`}
        label={t('buttons.listButton')}
        problem={props.problem('listButton')}
        problemLabel={err('listButton', t('buttons.listButton'))}
      >
        <Input
          id={`${base}-listbtn`}
          value={v.listButton}
          maxLength={BUTTON_LIMITS.title}
          invalid={props.problem('listButton') !== undefined}
          data-testid="inbox-share-list-button"
          onChange={(e) => props.onChange({ ...v, listButton: e.target.value })}
        />
      </FieldRow>
      {v.sections.map((sec, si) => (
        <fieldset key={si} className="space-y-2 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">
            {t('buttons.section', { n: si + 1 })}
          </legend>
          <div className="space-y-1">
            <Input
              aria-label={t('buttons.sectionTitle')}
              placeholder={t('buttons.sectionTitle')}
              value={sec.title}
              maxLength={BUTTON_LIMITS.sectionTitle}
              invalid={props.problem(`section.${si}`) !== undefined}
              onChange={(e) =>
                setSections(
                  v.sections.map((x, n) => (n === si ? { ...x, title: e.target.value } : x)),
                )
              }
            />
            {props.problem(`section.${si}`) && (
              <p role="alert" className="text-xs text-danger">
                {err(`section.${si}`, t('buttons.sectionTitle'))}
              </p>
            )}
          </div>
          {sec.rows.map((r, ri) => (
            <div key={ri} className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Input
                  aria-label={t('buttons.rowTitle', { n: ri + 1 })}
                  placeholder={t('buttons.rowTitle', { n: ri + 1 })}
                  value={r.title}
                  maxLength={BUTTON_LIMITS.rowTitle}
                  invalid={props.problem(`row.${si}.${ri}`) !== undefined}
                  data-testid={`inbox-share-row-title-${si}-${ri}`}
                  onChange={(e) =>
                    setSections(
                      v.sections.map((x, n) =>
                        n === si
                          ? {
                              ...x,
                              rows: x.rows.map((y, m) =>
                                m === ri ? { ...y, title: e.target.value } : y,
                              ),
                            }
                          : x,
                      ),
                    )
                  }
                />
                {props.problem(`row.${si}.${ri}`) && (
                  <p role="alert" className="text-xs text-danger">
                    {err(`row.${si}.${ri}`, t('buttons.rowTitle', { n: ri + 1 }))}
                  </p>
                )}
              </div>
              <Input
                aria-label={t('buttons.rowDescription', { n: ri + 1 })}
                placeholder={t('buttons.rowDescription', { n: ri + 1 })}
                value={r.description}
                maxLength={BUTTON_LIMITS.rowDescription}
                onChange={(e) =>
                  setSections(
                    v.sections.map((x, n) =>
                      n === si
                        ? {
                            ...x,
                            rows: x.rows.map((y, m) =>
                              m === ri ? { ...y, description: e.target.value } : y,
                            ),
                          }
                        : x,
                    ),
                  )
                }
              />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={total >= BUTTON_LIMITS.rows}
              data-testid={`inbox-share-add-row-${si}`}
              onClick={() =>
                setSections(
                  v.sections.map((x, n) =>
                    n === si ? { ...x, rows: [...x.rows, { title: '', description: '' }] } : x,
                  ),
                )
              }
            >
              {t('buttons.addRow')}
            </Button>
            {v.sections.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSections(v.sections.filter((_, n) => n !== si))}
              >
                {t('buttons.removeSection', { n: si + 1 })}
              </Button>
            )}
          </div>
        </fieldset>
      ))}
      {props.problem('rows') && (
        <p role="alert" className="text-xs text-danger">
          {err('rows', t('buttons.rows'))}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        {v.sections.length < BUTTON_LIMITS.sections ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="inbox-share-add-section"
            onClick={() => setSections([...v.sections, EMPTY_SECTION])}
          >
            {t('buttons.addSection')}
          </Button>
        ) : (
          <span />
        )}
        <span className="text-xs text-muted-foreground">
          {t('buttons.rowCount', { n: total, max: BUTTON_LIMITS.rows })}
        </span>
      </div>
    </>
  );
}
