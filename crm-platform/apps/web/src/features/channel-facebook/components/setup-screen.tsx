'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
  cn,
  useToast,
} from '@crm/ui';
import type { MessengerSetup } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  KEYS,
  removeGetStarted,
  removeGreeting,
  removeIceBreakers,
  removeMenu,
  saveGetStarted,
  saveGreeting,
  saveIceBreakers,
  saveMenu,
  useSetup,
} from '../api/facebook';
import {
  GREETING_MAX,
  ICE_MAX,
  ICE_QUESTION_MAX,
  MENU_MAX,
  MENU_TITLE_MAX,
  PAYLOAD_MAX,
  SETUP_TABS,
  addRow,
  blankIceBreaker,
  blankMenuItem,
  firstTab,
  iceBreakerPreview,
  menuPreviewTitles,
  patchRow,
  removeRow,
  seedRows,
  tabsSet,
  type SetupTab,
} from '../lib/setup-model';
import { initial } from '../lib/format';
import {
  CheckBoxIcon,
  CloseIcon,
  FB_BLUE,
  FacebookGlyph,
  GetStartedIcon,
  GreetingIcon,
  InfoIcon,
  MESSENGER_BLUE,
  MenuIcon,
  PeopleIcon,
  PlusIcon,
  QuestionIcon,
} from './fb-icons';
import { MessengerFrame } from './messenger-frame';
import { PageSelect } from './page-select';

const TAB_ICON = {
  getstarted: GetStartedIcon,
  greeting: GreetingIcon,
  menu: MenuIcon,
  icebreakers: QuestionIcon,
} as const;
const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const mono = 'font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground';

/** Plain-English explainer of a feature: what it is, how customers use it, how to set it up (WaDesk's `setup-explainer`). */
function Explainer({ what, customer, how }: { what: string; customer: string; how: string }) {
  const t = useTranslations('facebook.setup.explainer');
  const row = (icon: ReactNode, label: string, text: string) => (
    <div className="flex gap-3 px-4 py-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
        {icon}
      </span>
      <div className="min-w-0">
        <div className={mono}>{label}</div>
        <p className="mt-0.5 leading-snug">{text}</p>
      </div>
    </div>
  );
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-muted/40 text-[12.5px]">
      {row(<InfoIcon className="size-3.5" />, t('what'), what)}
      {row(<PeopleIcon className="size-3.5" />, t('customer'), customer)}
      {row(<CheckBoxIcon className="size-3.5" />, t('how'), how)}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  explainer,
  preview,
  children,
}: {
  title: string;
  subtitle: string;
  explainer: { what: string; customer: string; how: string };
  preview: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
      <div className="space-y-5 rounded-2xl border border-border bg-background p-6 shadow-sm">
        <div>
          <h2 className="text-[22px] leading-tight">{title}</h2>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">{subtitle}</p>
        </div>
        <Explainer {...explainer} />
        <div className="space-y-3 border-t border-border pt-4">{children}</div>
      </div>
      {preview}
    </div>
  );
}

/** Save and Remove: Remove asks first and shows only when there is something saved. */
function Actions({
  canRemove,
  removeLabel,
  saveLabel,
  confirm,
  busy,
  onRemove,
}: {
  canRemove: boolean;
  removeLabel: string;
  saveLabel: string;
  confirm: string;
  busy: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations('facebook.common');
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex items-center justify-between pt-1">
      {canRemove ? (
        <button
          type="button"
          className="text-[11.5px] text-danger hover:underline"
          onClick={() => setAsking(true)}
        >
          {removeLabel}
        </button>
      ) : (
        <span />
      )}
      <Button type="submit" className="rounded-full px-5" disabled={busy}>
        {saveLabel}
      </Button>
      <ConfirmDialog
        open={asking}
        tone="danger"
        title={removeLabel}
        message={confirm}
        confirmLabel={removeLabel}
        cancelLabel={t('cancel')}
        onClose={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          onRemove();
        }}
      />
    </div>
  );
}

interface PieceProps {
  view: MessengerSetup;
  pageId: string;
  run: (action: () => Promise<{ message: string }>) => Promise<void>;
  busy: boolean;
}

function GetStartedPanel({ view, pageId, run, busy }: PieceProps) {
  const t = useTranslations('facebook.setup.getstarted');
  const [payload, setPayload] = useState(view.getStarted);
  const name = view.page?.name ?? null;
  return (
    <Panel
      title={t('title')}
      subtitle={t('subtitle')}
      explainer={{ what: t('what'), customer: t('customer'), how: t('how') }}
      preview={
        <MessengerFrame pageName={name}>
          <div className="flex flex-1 flex-col items-center justify-end gap-3 pb-4">
            <span
              className="grid size-14 place-items-center rounded-full text-lg font-semibold text-white"
              style={{ background: FB_BLUE }}
            >
              {initial(name)}
            </span>
            <div className="text-xs font-semibold">{name || t('yourPage')}</div>
            <div className="text-[10.5px] text-muted-foreground">{t('typically')}</div>
          </div>
          <button
            type="button"
            tabIndex={-1}
            className="w-full rounded-full py-2.5 text-[13px] font-semibold text-white"
            style={{ background: MESSENGER_BLUE }}
          >
            {t('button')}
          </button>
        </MessengerFrame>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => saveGetStarted(pageId, payload));
        }}
      >
        <Field label={t('payload')} htmlFor="fb-gs" hint={t('payloadHint')}>
          <Input
            id="fb-gs"
            value={payload}
            maxLength={PAYLOAD_MAX}
            onChange={(e) => setPayload(e.target.value)}
            placeholder="GET_STARTED"
            className="font-mono"
          />
        </Field>
        <Actions
          canRemove={view.getStarted !== ''}
          removeLabel={t('remove')}
          saveLabel={t('save')}
          confirm={t('removeConfirm')}
          busy={busy}
          onRemove={() => void run(() => removeGetStarted(pageId))}
        />
      </form>
    </Panel>
  );
}

function GreetingPanel({ view, pageId, run, busy }: PieceProps) {
  const t = useTranslations('facebook.setup.greeting');
  const [text, setText] = useState(view.greeting);
  const name = view.page?.name ?? null;
  return (
    <Panel
      title={t('title')}
      subtitle={t('subtitle')}
      explainer={{ what: t('what'), customer: t('customer'), how: t('how') }}
      preview={
        <MessengerFrame pageName={name}>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-1 text-center">
            <span
              className="grid size-14 place-items-center rounded-full text-lg font-semibold text-white"
              style={{ background: FB_BLUE }}
            >
              {initial(name)}
            </span>
            <div className="text-xs font-semibold">{name || t('yourPage')}</div>
            <div className="text-xs leading-snug text-muted-foreground">
              {text.trim() !== '' ? text : t('sample')}
            </div>
          </div>
        </MessengerFrame>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => saveGreeting(pageId, text));
        }}
      >
        <Field
          label={t('welcomeText')}
          htmlFor="fb-greeting"
          hint={`${text.length}/${GREETING_MAX}`}
        >
          <Textarea
            id="fb-greeting"
            rows={4}
            maxLength={GREETING_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('placeholder')}
          />
        </Field>
        <Actions
          canRemove={view.greeting !== ''}
          removeLabel={t('remove')}
          saveLabel={t('save')}
          confirm={t('removeConfirm')}
          busy={busy}
          onRemove={() => void run(() => removeGreeting(pageId))}
        />
      </form>
    </Panel>
  );
}

function MenuPanel({ view, pageId, run, busy }: PieceProps) {
  const t = useTranslations('facebook.setup.menu');
  const [rows, setRows] = useState(() => seedRows(view.menu.items, blankMenuItem));
  const [composerOff, setComposerOff] = useState(view.menu.composerInputDisabled);
  const name = view.page?.name ?? null;
  const samples = [t('sample1'), t('sample2'), t('sample3')];
  return (
    <Panel
      title={t('title')}
      subtitle={t('subtitle')}
      explainer={{ what: t('what'), customer: t('customer'), how: t('how') }}
      preview={
        <MessengerFrame pageName={name}>
          <div className="flex-1" />
          <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="border-b border-border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t('menuLabel')}
            </div>
            {menuPreviewTitles(view.menu.items, samples).map((title, i) => (
              <div
                key={i}
                className="border-b border-border px-3 py-2.5 text-[12.5px] last:border-0"
              >
                {title || t('menuItem')}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5">
            <MenuIcon className="size-4" style={{ color: MESSENGER_BLUE }} />
            <span className="text-[11.5px] text-muted-foreground">Aa</span>
          </div>
        </MessengerFrame>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => saveMenu(pageId, { items: rows, composerInputDisabled: composerOff }));
        }}
      >
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid items-start gap-3 rounded-xl border border-border bg-muted/40 p-3.5 sm:grid-cols-[1fr_auto]"
            >
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <Field label={t('titleLabel')} htmlFor={`fb-menu-title-${i}`}>
                  <Input
                    id={`fb-menu-title-${i}`}
                    value={r.title}
                    maxLength={MENU_TITLE_MAX}
                    onChange={(e) => setRows(patchRow(rows, i, { title: e.target.value }))}
                    placeholder={t('titlePlaceholder')}
                  />
                </Field>
                <Field label={t('action')} htmlFor={`fb-menu-type-${i}`}>
                  <Select
                    id={`fb-menu-type-${i}`}
                    value={r.type}
                    onChange={(e) =>
                      setRows(patchRow(rows, i, { type: e.target.value as 'web_url' | 'postback' }))
                    }
                  >
                    <option value="postback">{t('actionFlow')}</option>
                    <option value="web_url">{t('actionLink')}</option>
                  </Select>
                </Field>
                <div className="sm:col-span-2">
                  {r.type === 'web_url' ? (
                    <Field label={t('url')} htmlFor={`fb-menu-url-${i}`}>
                      <Input
                        id={`fb-menu-url-${i}`}
                        type="url"
                        value={r.url}
                        onChange={(e) => setRows(patchRow(rows, i, { url: e.target.value }))}
                        placeholder="https://…"
                        className="font-mono"
                      />
                    </Field>
                  ) : (
                    <Field label={t('payload')} htmlFor={`fb-menu-payload-${i}`}>
                      <Input
                        id={`fb-menu-payload-${i}`}
                        value={r.payload}
                        maxLength={PAYLOAD_MAX}
                        onChange={(e) => setRows(patchRow(rows, i, { payload: e.target.value }))}
                        placeholder="MENU_TALK"
                        className="font-mono"
                      />
                    </Field>
                  )}
                </div>
              </div>
              <button
                type="button"
                title={t('removeItem')}
                aria-label={t('removeItem')}
                onClick={() => setRows(removeRow(rows, i, blankMenuItem))}
                className="mt-1 grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger"
              >
                <CloseIcon className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            disabled={rows.length >= MENU_MAX}
            onClick={() => setRows(addRow(rows, blankMenuItem, MENU_MAX))}
            className={cn(
              'inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline',
              rows.length >= MENU_MAX && 'pointer-events-none opacity-40',
            )}
          >
            <PlusIcon className="size-4" />
            {t('add')}
          </button>
          <Checkbox
            id="fb-menu-composer"
            checked={composerOff}
            onChange={(e) => setComposerOff(e.target.checked)}
            label={<span className="text-xs">{t('hideComposer')}</span>}
          />
        </div>
        <Actions
          canRemove
          removeLabel={t('remove')}
          saveLabel={t('save')}
          confirm={t('removeConfirm')}
          busy={busy}
          onRemove={() => void run(() => removeMenu(pageId))}
        />
      </form>
    </Panel>
  );
}

function IceBreakersPanel({ view, pageId, run, busy }: PieceProps) {
  const t = useTranslations('facebook.setup.ice');
  const [rows, setRows] = useState(() => seedRows(view.iceBreakers, blankIceBreaker));
  const name = view.page?.name ?? null;
  const samples = [t('sample1'), t('sample2'), t('sample3')];
  return (
    <Panel
      title={t('title')}
      subtitle={t('subtitle')}
      explainer={{ what: t('what'), customer: t('customer'), how: t('how') }}
      preview={
        <MessengerFrame pageName={name}>
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            <span
              className="grid size-12 place-items-center rounded-full text-base font-semibold text-white"
              style={{ background: FB_BLUE }}
            >
              {initial(name)}
            </span>
            <div className="text-[11.5px] font-semibold">{name || t('yourPage')}</div>
          </div>
          <div className="space-y-2">
            {iceBreakerPreview(view.iceBreakers, samples).map((q, i) => (
              <div
                key={i}
                className="rounded-full border py-2 text-center text-xs"
                style={{
                  borderColor: `${MESSENGER_BLUE}66`,
                  color: MESSENGER_BLUE,
                  background: `${MESSENGER_BLUE}0D`,
                }}
              >
                {q || t('question')}
              </div>
            ))}
          </div>
        </MessengerFrame>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => saveIceBreakers(pageId, { items: rows }));
        }}
      >
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid items-start gap-3 rounded-xl border border-border bg-muted/40 p-3.5 sm:grid-cols-[1fr_auto]"
            >
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <Field label={t('questionLabel')} htmlFor={`fb-ice-q-${i}`}>
                  <Input
                    id={`fb-ice-q-${i}`}
                    value={r.question}
                    maxLength={ICE_QUESTION_MAX}
                    onChange={(e) => setRows(patchRow(rows, i, { question: e.target.value }))}
                    placeholder={t('questionPlaceholder')}
                  />
                </Field>
                <Field label={t('payload')} htmlFor={`fb-ice-p-${i}`}>
                  <Input
                    id={`fb-ice-p-${i}`}
                    value={r.payload}
                    maxLength={PAYLOAD_MAX}
                    onChange={(e) => setRows(patchRow(rows, i, { payload: e.target.value }))}
                    placeholder="ICE_HOURS"
                    className="font-mono"
                  />
                </Field>
              </div>
              <button
                type="button"
                title={t('removeItem')}
                aria-label={t('removeItem')}
                onClick={() => setRows(removeRow(rows, i, blankIceBreaker))}
                className="mt-1 grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger"
              >
                <CloseIcon className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled={rows.length >= ICE_MAX}
          onClick={() => setRows(addRow(rows, blankIceBreaker, ICE_MAX))}
          className={cn(
            'inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline',
            rows.length >= ICE_MAX && 'pointer-events-none opacity-40',
          )}
        >
          <PlusIcon className="size-4" />
          {t('add')}
        </button>
        <Actions
          canRemove
          removeLabel={t('remove')}
          saveLabel={t('save')}
          confirm={t('removeConfirm')}
          busy={busy}
          onRemove={() => void run(() => removeIceBreakers(pageId))}
        />
      </form>
    </Panel>
  );
}

/**
 * `/facebook/setup` (WD-FB-015): what a Page's Messenger chat greets people with. Four pieces, one tab each, each saved straight to
 * Facebook and removable, with a phone preview. The first piece that is set up opens first.
 */
export function SetupScreen() {
  const t = useTranslations('facebook.setup');
  const qc = useQueryClient();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const canManage = useCan('fb.setup.manage');
  const pageParam = search.get('page') ?? undefined;
  const setup = useSetup(pageParam);
  const [tab, setTab] = useState<SetupTab | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<{ message: string }>) => {
    setBusy(true);
    try {
      toast((await action()).message, 'success');
      await qc.invalidateQueries({ queryKey: KEYS.all });
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const view = setup.data;
  const page = view?.page ?? null;
  const set = view ? tabsSet(view) : null;
  const active = tab ?? (view ? firstTab(view) : 'getstarted');

  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[40px]">
            {t('title')} <span className="italic text-brand">{t('titleAccent')}</span>
          </h1>
          <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {view && view.pages.length > 1 && page && (
            <PageSelect
              pages={view.pages}
              value={page.id}
              label={t('pagePicker')}
              onChange={(id) => router.replace(`${pathname}?page=${id}`)}
            />
          )}
          <Link
            href="/facebook/posts/create"
            className="inline-flex h-9 items-center rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted"
          >
            {t('composer')}
          </Link>
        </div>
      </div>

      {setup.isError && <Alert tone="danger">{t('loadError')}</Alert>}

      {setup.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !view || !page || !set ? (
        <div className="rounded-2xl border border-border bg-background p-8 text-center">
          <p className="text-[13.5px]">{t('noPage')}</p>
          <Link
            href="/facebook"
            className="mt-3 inline-flex rounded-full bg-brand px-4 py-2 text-[12.5px] font-semibold text-white"
          >
            {t('connect')}
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex shrink-0 items-center gap-2.5">
              <span
                className="grid size-8 shrink-0 place-items-center rounded-lg text-white"
                style={{ background: FB_BLUE }}
              >
                <FacebookGlyph className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold leading-tight">
                  {page.name || page.pageId}
                </div>
                <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
                  {t('profile')}
                </div>
              </div>
            </div>
            <div className="-mx-1 overflow-x-auto px-1 sm:ml-auto">
              <div
                role="tablist"
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background p-1 shadow-sm"
              >
                {SETUP_TABS.map((key) => {
                  const Icon = TAB_ICON[key];
                  const on = key === active;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setTab(key)}
                      className={cn(
                        'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-[12.5px] transition',
                        on ? 'bg-brand font-medium text-white' : 'hover:bg-muted',
                      )}
                    >
                      <Icon className="size-3.5 shrink-0" />
                      <span>{t(`tabs.${key}`)}</span>
                      <span
                        className={cn(
                          'size-1.5 shrink-0 rounded-full',
                          set[key] ? 'bg-success' : 'bg-border',
                        )}
                        title={set[key] ? t('isSet') : t('notSet')}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {canManage &&
            (() => {
              // The panel remounts when what Facebook holds changes, so its fields always start from what is saved.
              const props = { view, pageId: page.id, run, busy };
              const stamp = JSON.stringify([
                page.id,
                view.getStarted,
                view.greeting,
                view.menu,
                view.iceBreakers,
              ]);
              return active === 'getstarted' ? (
                <GetStartedPanel key={stamp} {...props} />
              ) : active === 'greeting' ? (
                <GreetingPanel key={stamp} {...props} />
              ) : active === 'menu' ? (
                <MenuPanel key={stamp} {...props} />
              ) : (
                <IceBreakersPanel key={stamp} {...props} />
              );
            })()}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">{t('footnote')}</p>
    </main>
  );
}
