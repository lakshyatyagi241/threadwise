'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { InboxTemplateOption } from '@crm/contracts';
import { Badge, Button, Input, Modal, Spinner, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useConversationTemplates } from '../api/hooks';
import { previewBody, sendableValues, slotProblems } from '../lib/template-form';
import { useErrorText } from './parts';

export interface TemplatePickerProps {
  conversationId: string;
  /** The customer's name, shown in the phone preview's header. */
  contactName?: string;
  /** The contact's details a variable can be filled from ("map a field"), only those the contact has. */
  contactFields?: Array<{ key: 'name' | 'phone' | 'email'; value: string }>;
  open: boolean;
  onClose: () => void;
  /** Sends the template; rejects with the API error so the dialog can show it and stay open. */
  onSend: (input: { templateId: string; variables: Record<string, string> }) => Promise<void>;
}

/**
 * The template picker: an approved template of this conversation's WhatsApp number, with a box for each `{{n}}` of its body and a
 * live preview of what the customer will read. A template does not need the 24 hour window, so this is how an agent reaches a
 * customer whose window has closed. A template the inbox cannot fill in (a media header, a link variable) is listed, disabled, with
 * the reason, so it is never a mystery why one known from the library is not offered.
 */
export function TemplatePicker(props: TemplatePickerProps) {
  // Mounted only while open: closing unmounts it, so the next opening starts at the list with nothing left over.
  return props.open ? <TemplatePickerDialog {...props} /> : null;
}

function TemplatePickerDialog(props: TemplatePickerProps) {
  const t = useTranslations('team-inbox-conversations.templates');
  const errorText = useErrorText();
  const { toast } = useToast();
  const searchId = useId();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<InboxTemplateOption | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The template under the pointer (or focus) in the list: the phone shows it until one is picked.
  const [peek, setPeek] = useState<InboxTemplateOption | null>(null);
  const [device, setDevice] = useState<PhoneDevice>('android');
  // Edit and duplicate leave this dialog for the template pages, so they follow the right to create templates.
  const mayManage = useCan('tpl.templates.create');
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // The search goes to the server after a short pause, so a long library is not fetched on every keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setQ(search.trim()), 250);
    return () => window.clearTimeout(id);
  }, [search]);

  const list = useConversationTemplates(props.conversationId, true, q);
  const items = useMemo(() => list.data?.data ?? [], [list.data]);

  const problems = picked ? slotProblems(picked, values) : {};
  const canSend = picked !== null && picked.sendable && Object.keys(problems).length === 0;
  const name = props.contactName?.trim() || t('previewCustomer');

  function choose(template: InboxTemplateOption) {
    if (!template.sendable || template.id === picked?.id) return;
    setPicked(template);
    setValues({});
    setTouched(false);
    setError(null);
  }

  async function send() {
    if (!picked) return;
    setTouched(true);
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await props.onSend({ templateId: picked.id, variables: sendableValues(picked, values) });
      toast(t('sent'));
      props.onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open
      onClose={props.onClose}
      size="lg"
      className="w-[min(64rem,calc(100vw-2rem))]"
      title={t('title')}
      eyebrow={t('eyebrow')}
      closeLabel={t('close')}
      footer={
        <Button
          type="button"
          data-testid="inbox-template-send"
          onClick={() => void send()}
          disabled={sending || !picked || (touched && !canSend)}
        >
          {sending && <Spinner />}
          {sending ? t('sending') : t('sendTo', { name })}
        </Button>
      }
    >
      {mayManage && (
        <div className="mb-3 flex justify-end">
          <Link
            href="/templates/new"
            data-testid="inbox-template-create"
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <span aria-hidden="true" className="text-base leading-none">
              +
            </span>
            {t('create')}
          </Link>
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {/* Left: only the list of templates. */}
        <div className="min-w-0 space-y-3">
          <div className="flex items-center gap-2">
            <label htmlFor={searchId} className="sr-only">
              {t('searchLabel')}
            </label>
            <Input
              id={searchId}
              type="search"
              value={search}
              placeholder={t('search')}
              data-testid="inbox-template-search"
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button
              variant="secondary"
              type="button"
              className="shrink-0"
              disabled={list.isFetching}
              onClick={() => void list.refetch()}
            >
              {t('refresh')}
            </Button>
          </div>

          {list.isPending && (
            <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Spinner /> {t('loading')}
            </p>
          )}
          {list.isError && (
            <div role="alert" className="space-y-2 py-4 text-sm">
              <p className="text-danger">{t('loadError')}</p>
              <Button variant="ghost" type="button" onClick={() => void list.refetch()}>
                {t('retry')}
              </Button>
            </div>
          )}
          {list.data && items.length === 0 && (
            <p
              data-testid="inbox-template-empty"
              className="py-6 text-center text-sm text-muted-foreground"
            >
              {q ? t('noResults') : t('empty')}
            </p>
          )}
          {list.data?.hasMore && (
            <p
              role="status"
              data-testid="inbox-template-has-more"
              className="text-xs text-muted-foreground"
            >
              {t('hasMore', { count: items.length })}
            </p>
          )}

          <ul
            className="max-h-[56vh] divide-y divide-border overflow-y-auto rounded-lg border border-border"
            data-testid="inbox-template-list"
          >
            {items.map((tpl) => (
              <li
                key={tpl.id}
                className="relative flex items-stretch"
                // On the row, not the button: a template the inbox cannot send is disabled but can still be looked at.
                onMouseEnter={() => setPeek(tpl)}
              >
                <button
                  type="button"
                  disabled={!tpl.sendable}
                  aria-current={picked?.id === tpl.id ? 'true' : undefined}
                  onClick={() => choose(tpl)}
                  onFocus={() => setPeek(tpl)}
                  data-testid={`inbox-template-${tpl.name}`}
                  className={cn(
                    'block min-w-0 flex-1 px-3.5 py-3 text-start focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                    picked?.id === tpl.id && 'bg-primary/10',
                    tpl.sendable ? 'hover:bg-muted' : 'cursor-not-allowed opacity-60',
                  )}
                >
                  <span className="block truncate text-sm font-medium">{tpl.name}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge tone={tpl.category === 'MARKETING' ? 'warning' : 'neutral'}>
                      {tpl.category}
                    </Badge>
                    <span>• {tpl.language}</span>
                  </span>
                  {tpl.reason && (
                    <span
                      className="mt-1 block truncate text-xs text-danger"
                      title={t(`reason.${tpl.reason}`)}
                    >
                      {t(`reason.${tpl.reason}`)}
                    </span>
                  )}
                </button>
                {mayManage && (
                  <>
                    <button
                      type="button"
                      aria-label={t('actions')}
                      aria-haspopup="menu"
                      aria-expanded={menuFor === tpl.id}
                      data-testid={`inbox-template-actions-${tpl.name}`}
                      onClick={() => setMenuFor((cur) => (cur === tpl.id ? null : tpl.id))}
                      className="grid w-9 shrink-0 place-items-center self-start py-3 text-lg leading-none text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span aria-hidden="true">⋯</span>
                    </button>
                    {menuFor === tpl.id && (
                      <div
                        role="menu"
                        className="absolute end-2 top-11 z-20 w-52 rounded-lg border border-border bg-background p-1 shadow-lg"
                      >
                        <Link
                          role="menuitem"
                          href={`/templates/${tpl.id}/edit`}
                          className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-muted"
                        >
                          <span aria-hidden="true">✎</span>
                          {t('edit')}
                        </Link>
                        <Link
                          role="menuitem"
                          href={`/templates/new?from=${tpl.id}`}
                          className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-muted"
                        >
                          <span aria-hidden="true">⧉</span>
                          {t('duplicate')}
                        </Link>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Right: the phone, Android or iPhone, and the variables of the picked template. */}
        <div className="min-w-0 space-y-3 md:max-h-[62vh] md:overflow-y-auto md:pe-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{t('windowHint')}</p>
            <div
              role="group"
              aria-label={t('device')}
              className="flex shrink-0 overflow-hidden rounded-lg border border-border"
            >
              {(['android', 'ios'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={device === d}
                  data-device={d}
                  onClick={() => setDevice(d)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                    device === d
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {d === 'android' ? <AndroidIcon /> : <AppleIcon />}
                  {t(`devices.${d}`)}
                </button>
              ))}
            </div>
          </div>

          <PhonePreview
            template={picked ?? peek}
            values={picked ? values : {}}
            contactName={props.contactName}
            device={device}
          />

          {picked && (
            <div className="space-y-3" data-testid="inbox-template-form">
              {picked.slots.length === 0 ? (
                <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                  {t('noVariables')}
                </p>
              ) : (
                <details open className="rounded-lg border border-border">
                  <summary className="cursor-pointer select-none px-3.5 py-3 text-sm font-semibold">
                    {t('configure')}
                  </summary>
                  <fieldset className="space-y-3 border-t border-border p-3.5">
                    <legend className="sr-only">{t('configure')}</legend>
                    {picked.slots.map((slot, i) => (
                      <SlotRow
                        key={slot.key}
                        slot={slot}
                        body={picked.body}
                        value={values[slot.key] ?? ''}
                        problem={touched ? problems[slot.key] : undefined}
                        autoFocus={i === 0}
                        idBase={searchId}
                        fields={props.contactFields ?? []}
                        onChange={(v) => setValues((cur) => ({ ...cur, [slot.key]: v }))}
                      />
                    ))}
                  </fieldset>
                </details>
              )}
              {error && (
                <p role="alert" data-testid="inbox-template-error" className="text-sm text-danger">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** The few words around `{{key}}` in the body, so a box can say which variable it is ("Hey {{1}} Your"). */
function slotContext(body: string, key: string): string {
  const m = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`).exec(body);
  if (!m) return `{{${key}}}`;
  const before = body.slice(0, m.index).trimEnd().split(/\s+/).slice(-1)[0] ?? '';
  const after =
    body
      .slice(m.index + m[0].length)
      .trimStart()
      .split(/\s+/)[0] ?? '';
  return [before, `{{${key}}}`, after].filter(Boolean).join(' ');
}

/** One variable of the template: its place in the text, a box to type the value, or a contact field to take it from. */
function SlotRow({
  slot,
  body,
  value,
  problem,
  autoFocus,
  idBase,
  fields,
  onChange,
}: {
  slot: InboxTemplateOption['slots'][number];
  body: string;
  value: string;
  problem: 'required' | 'format' | undefined;
  autoFocus: boolean;
  idBase: string;
  fields: Array<{ key: 'name' | 'phone' | 'email'; value: string }>;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('team-inbox-conversations.templates');
  const [menu, setMenu] = useState(false);
  const id = `${idBase}-${slot.key}`;
  const inputRef = useRef<HTMLInputElement>(null);
  // Focus the first box without scrolling the pane away from the phone.
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
    // Only when the row first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-2">
        <span
          className="truncate rounded-md bg-muted px-2 py-2 text-center text-xs"
          title={slot.label}
          dir="auto"
        >
          {slotContext(body, slot.key)}
        </span>
        <Input
          id={id}
          aria-label={`{{${slot.key}}} ${slot.label}`}
          value={value}
          invalid={problem !== undefined}
          ref={inputRef}
          maxLength={1024}
          placeholder={slot.example ?? `{{${slot.key}}}`}
          data-testid={`inbox-template-var-${slot.key}`}
          aria-describedby={problem ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <div className="relative flex items-center gap-2 ps-1 text-xs text-muted-foreground">
        <span>{t('or')}</span>
        <button
          type="button"
          disabled={fields.length === 0}
          aria-expanded={menu}
          title={fields.length === 0 ? t('mapNone') : undefined}
          onClick={() => setMenu((v) => !v)}
          className="inline-flex items-center gap-1 font-semibold text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true">⊕</span>
          {t('mapField', { key: `{{${slot.key}}}` })}
        </button>
        {menu && (
          <ul
            role="menu"
            className="absolute start-0 top-full z-10 mt-1 min-w-[12rem] rounded-lg border border-border bg-background p-1 shadow-lg"
          >
            {fields.map((f) => (
              <li key={f.key} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-start text-sm hover:bg-muted"
                  onClick={() => {
                    onChange(f.value);
                    setMenu(false);
                  }}
                >
                  <span className="font-medium">{t(`fields.${f.key}`)}</span>
                  <span className="truncate text-xs text-muted-foreground" dir="auto">
                    {f.value}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {problem && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {t(`problem.${problem}`, { label: slot.label })}
        </p>
      )}
    </div>
  );
}

export type PhoneDevice = 'android' | 'ios';

/**
 * The phone beside the list: a WhatsApp chat, Android or iPhone, with the template as the customer will see it (header, body with
 * the typed values, footer, buttons). Until a template is picked it shows the one under the pointer in the list.
 */
export function PhonePreview({
  template,
  values,
  contactName,
  device = 'android',
}: {
  template: InboxTemplateOption | null;
  values: Record<string, string>;
  contactName?: string;
  device?: PhoneDevice;
}) {
  const t = useTranslations('team-inbox-conversations.templates');
  const name = contactName?.trim() || t('previewCustomer');
  const ios = device === 'ios';
  const clock = useMemo(
    () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    [],
  );
  return (
    <aside aria-label={t('preview')} data-device={device} className="mx-auto w-full max-w-[20rem]">
      <div
        className={cn(
          'overflow-hidden border-[7px] border-foreground/85 bg-foreground/85 shadow-lg',
          ios ? 'rounded-[2.5rem]' : 'rounded-[1.75rem]',
        )}
      >
        {ios ? (
          <div className="relative flex items-center justify-between bg-[#F6F6F6] px-4 pb-2 pt-3 text-[#111B21]">
            <span aria-hidden="true" className="text-[11px] font-semibold">
              9:41
            </span>
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-1.5 h-4 w-20 -translate-x-1/2 rounded-full bg-black"
            />
            <span aria-hidden="true" className="text-[10px]">
              ●●●
            </span>
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="flex items-center justify-between bg-[#075E54] px-3 pt-1.5 text-[10px] text-white/90"
          >
            <span>1:42</span>
            <span className="size-2 rounded-full bg-black" />
            <span>▲ ▮</span>
          </div>
        )}
        <div
          className={cn(
            'flex items-center gap-2 px-3 py-2.5',
            ios ? 'bg-[#F6F6F6] text-[#111B21]' : 'bg-[#075E54] text-white',
          )}
        >
          {ios && (
            <span aria-hidden="true" className="text-lg leading-none text-[#007AFF]">
              ‹
            </span>
          )}
          <span
            aria-hidden="true"
            className={cn(
              'grid size-8 place-items-center rounded-full text-[13px] font-semibold',
              ios ? 'bg-[#D1D5DB] text-white' : 'bg-white/25',
            )}
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
        </div>
        <div
          style={{
            backgroundImage: 'radial-gradient(rgba(0,0,0,.06) 1px, transparent 1.2px)',
            backgroundSize: '14px 14px',
          }}
          className={cn(
            'flex h-[22rem] flex-col justify-start gap-1 overflow-y-auto p-3',
            ios ? 'bg-[#EFEAE2]' : 'bg-[#ECE5DD]',
          )}
        >
          {template ? (
            <div
              data-testid="inbox-template-preview"
              className="max-w-[92%] self-start overflow-hidden rounded-lg rounded-ss-none bg-white text-[13px] text-[#111B21] shadow-sm"
            >
              <div className="space-y-1.5 px-2.5 pb-1.5 pt-2">
                {template.header && <p className="font-semibold">{template.header}</p>}
                <p className="whitespace-pre-wrap break-words" dir="auto">
                  {previewBody(template.body, values)}
                </p>
                {template.footer && <p className="text-xs text-[#667781]">{template.footer}</p>}
                <p className="text-end text-[10px] text-[#667781]" dir="ltr">
                  {clock}
                </p>
              </div>
              {template.buttons.map((b, i) => (
                <div
                  key={`${b}-${i}`}
                  className={cn(
                    'border-t border-black/10 px-2.5 py-2 text-center text-[13px] font-medium',
                    ios ? 'text-[#007AFF]' : 'text-[#00A5F4]',
                  )}
                >
                  {b}
                </div>
              ))}
            </div>
          ) : (
            <p className="m-auto max-w-[14rem] text-center text-xs text-[#667781]">
              {t('previewEmpty')}
            </p>
          )}
        </div>
        <div
          aria-hidden="true"
          className={cn(
            'flex items-center gap-2 px-2.5 pb-3 pt-1.5',
            ios ? 'bg-[#EFEAE2]' : 'bg-[#ECE5DD]',
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-white px-3 py-2 text-xs text-[#667781]">
            <span>☺</span>
            <span className="min-w-0 flex-1 truncate">{t('typeMessage')}</span>
            <span>⌁</span>
          </span>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#00A884] text-white">
            ●
          </span>
        </div>
      </div>
    </aside>
  );
}

function AndroidIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.5 9.5h11v8a1.2 1.2 0 0 1-1.2 1.2h-.8v2.3a1.1 1.1 0 0 1-2.2 0v-2.3h-2.6v2.3a1.1 1.1 0 0 1-2.2 0v-2.3h-.8A1.2 1.2 0 0 1 6.5 17.5v-8zM4 9.5a1.1 1.1 0 0 1 2.2 0v5.6a1.1 1.1 0 0 1-2.2 0V9.5zm13.8 0a1.1 1.1 0 0 1 2.2 0v5.6a1.1 1.1 0 0 1-2.2 0V9.5zM6.7 8.6a5.3 5.3 0 0 1 10.6 0H6.7zm3-1.9a.6.6 0 1 0 0-1.2.6.6 0 0 0 0 1.2zm4.6 0a.6.6 0 1 0 0-1.2.6.6 0 0 0 0 1.2zM8.4 3.4l.8 1.3m6.4-1.3l-.8 1.3" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.7-1.8-3.3-1.8-1.4-.1-2.8.8-3.5.8s-1.8-.8-3-.8c-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 6.9 1.2 9.2.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.2 0 2-1.1 2.8-2.3.9-1.3 1.2-2.5 1.3-2.6 0 0-2.4-.9-2.4-3.6zM14.1 5.9c.6-.8 1.1-1.9.9-2.9-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.8 1 .1 2.1-.5 2.8-1.3z" />
    </svg>
  );
}
