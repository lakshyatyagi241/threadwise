'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  CHAT_ITEMS_MAX,
  CHAT_MENU_LABEL_MAX,
  CHAT_MENU_VIEWS,
  CHAT_NOTICE_ICONS,
  CHAT_NOTICE_LIMITS,
  CHAT_SUGGESTIONS_MAX,
  CHAT_SUGGESTION_MAX_CHARS,
  chatVideoEmbedFrom,
  type ChatBannerItem,
  type ChatMenuItem,
  type ChatNoticeItem,
} from '@crm/contracts';
import { Switch, cn } from '@crm/ui';
import type { BuilderState } from '../lib/builder-model';
import { useBotSteps } from '../api/widgets';
import { ImageUpload } from './image-upload';

const INPUT =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-brand';
const LABEL = 'mb-1 block text-[11.5px] font-semibold';
const CAPTION =
  'mb-2 block text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground';

type Tab = 'notice' | 'menu' | 'banner' | 'replies';

/** The bell icons of the notification block (24 by 24 strokes, the same four the chat window draws). */
const BELLS: Record<number, string[]> = {
  1: ['M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7', 'M10 20a2 2 0 0 0 4 0'],
  2: ['M3 8h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z', 'M14 8v10'],
  3: ['M4 5h16v4H4z', 'M5 9v10h14V9', 'M10 13h4'],
  4: ['M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z', 'M17 4h.01'],
};

/** The first of a group's five picture slots that no item uses, so a new picture never replaces another item's. */
function freeSlot(prefix: 'nb' | 'qm' | 'bn', images: string[]): string {
  for (let i = 0; i < CHAT_ITEMS_MAX; i += 1) {
    if (!images.some((u) => u.includes(`/${prefix}${i}?`) || u.endsWith(`/${prefix}${i}`)))
      return `${prefix}${i}`;
  }
  return `${prefix}0`;
}

function Pills<T extends string | number>({
  name,
  value,
  options,
  text,
  onChange,
}: {
  name: string;
  value: T;
  options: readonly T[];
  text: (o: T) => ReactNode;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <label
          key={String(o)}
          data-choice={`${name}:${o}`}
          className={cn(
            'cursor-pointer rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold focus-within:ring-2 focus-within:ring-brand',
            value === o
              ? 'border-brand bg-brand text-brand-foreground'
              : 'border-border hover:border-brand',
          )}
        >
          <input
            type="radio"
            name={`wgt-conv-${name}`}
            checked={value === o}
            onChange={() => onChange(o)}
            className="sr-only"
          />
          {text(o)}
        </label>
      ))}
    </div>
  );
}

function ItemShell({
  title,
  onRemove,
  removeLabel,
  children,
}: {
  title: string;
  onRemove: () => void;
  removeLabel: string;
  children: ReactNode;
}) {
  return (
    <div
      className="space-y-3 rounded-xl border border-border bg-muted/30 p-3"
      data-testid="conv-item"
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold">{title}</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          ×
        </button>
      </div>
      {children}
    </div>
  );
}

/** One tool as a card: its picture and name, how many items it holds, its on/off switch, and its settings when opened. */
function ToolCard({
  id,
  icon,
  title,
  count,
  open,
  onOpen,
  switchId,
  switchLabel,
  enabled,
  onEnabled,
  children,
}: {
  id: Tab;
  icon: string;
  title: string;
  count: number;
  open: boolean;
  onOpen: () => void;
  switchId?: string;
  switchLabel?: string;
  enabled?: boolean;
  onEnabled?: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section
      data-conv-tool={id}
      className={cn(
        'rounded-2xl border bg-background transition-colors',
        open ? 'border-brand/50' : 'border-border',
      )}
    >
      <div className="flex items-center gap-3 px-3.5 py-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 text-start"
        >
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-[17px]"
          >
            {icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-bold">{title}</span>
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
            {count}
          </span>
          <span
            aria-hidden="true"
            className={cn('text-muted-foreground transition-transform', open && 'rotate-180')}
          >
            ⌄
          </span>
        </button>
        {switchId && switchLabel && onEnabled ? (
          <Switch
            id={switchId}
            checked={enabled === true}
            onCheckedChange={onEnabled}
            label={switchLabel}
          />
        ) : null}
      </div>
      {open ? <div className="space-y-4 border-t border-border p-3.5">{children}</div> : null}
    </section>
  );
}

/**
 * What a tap does: open a page (`link`), or start the bot from one of its steps (`flow`). The author picks which; a menu entry with
 * neither sends its title as a message.
 */
function ActionPicker({
  idPrefix,
  mode,
  onMode,
  steps,
  node,
  onNode,
  children,
}: {
  idPrefix: string;
  mode: 'link' | 'flow';
  onMode: (m: 'link' | 'flow') => void;
  steps: Array<{ id: string; label: string }> | undefined;
  node: string;
  onNode: (id: string) => void;
  children: ReactNode;
}) {
  const t = useTranslations('chatbotWidget.flowBot.customize.conversation');
  // A step not chosen yet still shows the step list: the pick is kept here until the item itself holds a step.
  const [picked, setPicked] = useState<'link' | 'flow' | null>(null);
  const shown = node ? 'flow' : (picked ?? mode);
  return (
    <div className="space-y-2">
      <span className={CAPTION}>{t('action')}</span>
      <Pills
        name={`${idPrefix}Mode`}
        value={shown}
        options={['link', 'flow'] as const}
        text={(o) => t(`actions.${o}`)}
        onChange={(m) => {
          setPicked(m);
          onMode(m);
        }}
      />
      {shown === 'link' ? (
        children
      ) : (
        <div>
          <label htmlFor={`${idPrefix}-step`} className={LABEL}>
            {t('step')}
          </label>
          <select
            id={`${idPrefix}-step`}
            value={node}
            onChange={(e) => onNode(e.target.value)}
            className={INPUT}
          >
            <option value="">{t('stepPlaceholder')}</option>
            {(steps ?? []).map((st) => (
              <option key={st.id} value={st.id}>
                {st.label}
              </option>
            ))}
          </select>
          {steps && steps.length === 0 ? (
            <p className="mt-1 text-[11.5px] text-muted-foreground">{t('noSteps')}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * The things a website bot puts in its chat window besides the conversation, the same four the Geta console offers: a notification
 * block (a bell with cards), a quick menu (rows or blocks), a banner (pictures and videos) and quick replies (lines under the
 * conversation). Each can be switched off without losing what was typed.
 */
export function WebConversationCard({
  flowId,
  s,
  set,
  upload,
}: {
  flowId: string;
  s: BuilderState;
  set: (patch: Partial<BuilderState>) => void;
  upload: (slot: string, file: File) => Promise<string>;
}) {
  const t = useTranslations('chatbotWidget.flowBot.customize.conversation');
  const tc = useTranslations('chatbotWidget.flowBot.customize.chat');
  const [open, setOpen] = useState<Tab | null>('notice');
  const steps = useBotSteps(flowId).data;
  const chat = s.launcher.chat;
  const setChat = (patch: Partial<typeof chat>) =>
    set({ launcher: { ...s.launcher, chat: { ...chat, ...patch } } });
  const field = (
    id: string,
    label: string,
    value: string,
    max: number,
    on: (v: string) => void,
    hint?: string,
  ) => (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={max}
        onChange={(e) => on(e.target.value)}
        className={INPUT}
      />
      {hint ? <p className="mt-1 text-[11.5px] text-muted-foreground">{hint}</p> : null}
    </div>
  );

  // --- notification block -------------------------------------------------------------------------------------------------
  const notice = chat.notice;
  const setNotice = (patch: Partial<typeof notice>) => setChat({ notice: { ...notice, ...patch } });
  const setCard = (i: number, patch: Partial<ChatNoticeItem>) =>
    setNotice({ items: notice.items.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  // --- quick menu ---------------------------------------------------------------------------------------------------------
  const menu = chat.quickMenu;
  const setMenu = (patch: Partial<typeof menu>) => setChat({ quickMenu: { ...menu, ...patch } });
  const setRow = (i: number, patch: Partial<ChatMenuItem>) =>
    setMenu({ items: menu.items.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  // --- banner -------------------------------------------------------------------------------------------------------------
  const banners = chat.banners;
  const setBanners = (patch: Partial<typeof banners>) =>
    setChat({ banners: { ...banners, ...patch } });
  const setSlide = (i: number, patch: Partial<ChatBannerItem>) =>
    setBanners({ items: banners.items.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const add = (label: string, onClick: () => void, count: number) =>
    count < CHAT_ITEMS_MAX ? (
      <button
        type="button"
        onClick={onClick}
        className="rounded-full border border-dashed border-border px-3.5 py-1.5 text-[12px] font-semibold text-brand hover:bg-muted"
      >
        + {label}
      </button>
    ) : (
      <p className="text-[11.5px] text-muted-foreground">{t('max', { count: CHAT_ITEMS_MAX })}</p>
    );

  return (
    <fieldset data-testid="web-conversation-card" className="space-y-4">
      <legend className="sr-only">{t('title')}</legend>
      <ToolCard
        id="notice"
        icon="🔔"
        title={t('tabs.notice')}
        count={notice.items.length}
        open={open === 'notice'}
        onOpen={() => setOpen(open === 'notice' ? null : 'notice')}
        switchId="wgt-f-notice-on"
        switchLabel={t('enable.notice')}
        enabled={notice.enabled}
        onEnabled={(enabled) => setNotice({ enabled })}
      >
        <div className="space-y-4">
          <div>
            <span className={CAPTION}>{t('icon')}</span>
            <div className="flex gap-1.5">
              {CHAT_NOTICE_ICONS.map((n) => (
                <label
                  key={n}
                  data-choice={`noticeIcon:${n}`}
                  title={t(`icons.${n}`)}
                  className={cn(
                    'grid size-10 cursor-pointer place-items-center rounded-xl border focus-within:ring-2 focus-within:ring-brand',
                    notice.icon === n
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-border text-muted-foreground hover:border-brand',
                  )}
                >
                  <input
                    type="radio"
                    name="wgt-conv-noticeIcon"
                    checked={notice.icon === n}
                    onChange={() => setNotice({ icon: n })}
                    className="sr-only"
                    aria-label={t(`icons.${n}`)}
                  />
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {BELLS[n]!.map((d) => (
                      <path key={d} d={d} />
                    ))}
                  </svg>
                </label>
              ))}
            </div>
          </div>
          {notice.items.map((c, i) => (
            <ItemShell
              key={i}
              title={t('card', { n: i + 1 })}
              removeLabel={t('remove')}
              onRemove={() => setNotice({ items: notice.items.filter((_, j) => j !== i) })}
            >
              <ImageUpload
                id={`wgt-f-nb-${i}`}
                value={c.image}
                shape="wide"
                upload={(file) =>
                  upload(
                    freeSlot(
                      'nb',
                      notice.items.map((x) => x.image),
                    ),
                    file,
                  )
                }
                onChange={(image) => setCard(i, { image })}
              />
              {field(
                `wgt-f-nb-title-${i}`,
                t('fields.title'),
                c.title,
                CHAT_NOTICE_LIMITS.title,
                (title) => setCard(i, { title }),
              )}
              {field(
                `wgt-f-nb-desc-${i}`,
                t('fields.description'),
                c.description,
                CHAT_NOTICE_LIMITS.description,
                (description) => setCard(i, { description }),
              )}
              {field(
                `wgt-f-nb-btn-${i}`,
                t('fields.buttonTitle'),
                c.buttonTitle,
                CHAT_NOTICE_LIMITS.button,
                (buttonTitle) => setCard(i, { buttonTitle }),
              )}
              {field(
                `wgt-f-nb-url-${i}`,
                t('fields.buttonUrl'),
                c.buttonUrl,
                1024,
                (buttonUrl) => setCard(i, { buttonUrl }),
                t('fields.urlHint'),
              )}
              {field(
                `wgt-f-nb-foot-${i}`,
                t('fields.footer'),
                c.footer,
                CHAT_NOTICE_LIMITS.footer,
                (footer) => setCard(i, { footer }),
              )}
            </ItemShell>
          ))}
          {add(
            t('addCard'),
            () =>
              setNotice({
                items: [
                  ...notice.items,
                  {
                    image: '',
                    title: '',
                    description: '',
                    buttonTitle: '',
                    buttonUrl: '',
                    footer: '',
                  },
                ],
              }),
            notice.items.length,
          )}
        </div>
      </ToolCard>

      <ToolCard
        id="menu"
        icon="☰"
        title={t('tabs.menu')}
        count={menu.items.length}
        open={open === 'menu'}
        onOpen={() => setOpen(open === 'menu' ? null : 'menu')}
        switchId="wgt-f-menu-on"
        switchLabel={t('enable.menu')}
        enabled={menu.enabled}
        onEnabled={(enabled) => setMenu({ enabled })}
      >
        <div className="space-y-4">
          <div>
            <span className={CAPTION}>{t('view')}</span>
            <Pills
              name="menuView"
              value={menu.view}
              options={CHAT_MENU_VIEWS}
              text={(o) => t(`views.${o}`)}
              onChange={(view) => setMenu({ view })}
            />
          </div>
          {menu.items.map((r, i) => (
            <ItemShell
              key={i}
              title={t('entry', { n: i + 1 })}
              removeLabel={t('remove')}
              onRemove={() => setMenu({ items: menu.items.filter((_, j) => j !== i) })}
            >
              <ImageUpload
                id={`wgt-f-qm-${i}`}
                value={r.image}
                upload={(file) =>
                  upload(
                    freeSlot(
                      'qm',
                      menu.items.map((x) => x.image),
                    ),
                    file,
                  )
                }
                onChange={(image) => setRow(i, { image })}
              />
              {field(
                `wgt-f-qm-title-${i}`,
                t('fields.menuTitle'),
                r.title,
                CHAT_MENU_LABEL_MAX,
                (title) => setRow(i, { title }),
              )}
              <ActionPicker
                idPrefix={`wgt-f-qm-${i}`}
                mode={r.node ? 'flow' : 'link'}
                onMode={(m) => setRow(i, m === 'flow' ? { url: '', node: r.node } : { node: '' })}
                steps={steps}
                node={r.node}
                onNode={(node) => setRow(i, { node, url: '' })}
              >
                {field(
                  `wgt-f-qm-url-${i}`,
                  t('fields.menuUrl'),
                  r.url,
                  1024,
                  (url) => setRow(i, { url }),
                  t('fields.menuUrlHint'),
                )}
              </ActionPicker>
            </ItemShell>
          ))}
          {add(
            t('addEntry'),
            () => setMenu({ items: [...menu.items, { image: '', title: '', url: '', node: '' }] }),
            menu.items.length,
          )}
        </div>
      </ToolCard>

      <ToolCard
        id="banner"
        icon="🖼️"
        title={t('tabs.banner')}
        count={banners.items.length}
        open={open === 'banner'}
        onOpen={() => setOpen(open === 'banner' ? null : 'banner')}
        switchId="wgt-f-banner-on"
        switchLabel={t('enable.banner')}
        enabled={banners.enabled}
        onEnabled={(enabled) => setBanners({ enabled })}
      >
        <div className="space-y-4">
          {banners.items.map((b, i) => (
            <ItemShell
              key={i}
              title={t('slide', { n: i + 1 })}
              removeLabel={t('remove')}
              onRemove={() => setBanners({ items: banners.items.filter((_, j) => j !== i) })}
            >
              <Pills
                name={`slideKind${i}`}
                value={b.kind}
                options={['image', 'video'] as const}
                text={(o) => t(`kinds.${o}`)}
                onChange={(kind) => setSlide(i, { kind })}
              />
              {b.kind === 'image' ? (
                <ImageUpload
                  id={`wgt-f-bn-${i}`}
                  value={b.image}
                  shape="wide"
                  upload={(file) =>
                    upload(
                      freeSlot(
                        'bn',
                        banners.items.map((x) => x.image),
                      ),
                      file,
                    )
                  }
                  onChange={(image) => setSlide(i, { image })}
                />
              ) : (
                <div>
                  <label htmlFor={`wgt-f-bn-video-${i}`} className={LABEL}>
                    {t('fields.video')}
                  </label>
                  <input
                    id={`wgt-f-bn-video-${i}`}
                    type="text"
                    defaultValue={b.video}
                    placeholder="https://www.youtube.com/watch?v=…"
                    onChange={(e) => setSlide(i, { video: chatVideoEmbedFrom(e.target.value) })}
                    className={INPUT}
                  />
                  <p
                    className={cn(
                      'mt-1 text-[11.5px]',
                      b.video === '' ? 'text-muted-foreground' : 'text-success',
                    )}
                  >
                    {b.video === '' ? t('fields.videoHint') : t('fields.videoOk')}
                  </p>
                </div>
              )}
              <ActionPicker
                idPrefix={`wgt-f-bn-${i}`}
                mode={b.node ? 'flow' : 'link'}
                onMode={(m) => setSlide(i, m === 'flow' ? { url: '', node: b.node } : { node: '' })}
                steps={steps}
                node={b.node}
                onNode={(node) => setSlide(i, { node, url: '' })}
              >
                {field(
                  `wgt-f-bn-url-${i}`,
                  t('fields.bannerUrl'),
                  b.url,
                  1024,
                  (url) => setSlide(i, { url }),
                  t('fields.urlHint'),
                )}
              </ActionPicker>
            </ItemShell>
          ))}
          {add(
            t('addSlide'),
            () =>
              setBanners({
                items: [
                  ...banners.items,
                  { kind: 'image', image: '', video: '', url: '', node: '' },
                ],
              }),
            banners.items.length,
          )}
        </div>
      </ToolCard>

      <ToolCard
        id="replies"
        icon="⚡"
        title={t('tabs.replies')}
        count={chat.suggestions.length}
        switchId="wgt-f-replies-on"
        switchLabel={t('enable.replies')}
        enabled={chat.suggestionsOn}
        onEnabled={(suggestionsOn) => setChat({ suggestionsOn })}
        open={open === 'replies'}
        onOpen={() => setOpen(open === 'replies' ? null : 'replies')}
      >
        <div className="space-y-3">
          <p className="text-[12px] text-muted-foreground">{tc('suggestionsHint')}</p>
          {chat.suggestions.map((line, i) => {
            const nodes = chat.suggestions.map((_, j) => chat.suggestionNodes[j] ?? '');
            return (
              <div key={i} className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={line}
                    maxLength={CHAT_SUGGESTION_MAX_CHARS}
                    placeholder={tc('suggestionPlaceholder')}
                    onChange={(e) =>
                      setChat({
                        suggestions: chat.suggestions.map((x, j) => (j === i ? e.target.value : x)),
                      })
                    }
                    className={INPUT}
                  />
                  <button
                    type="button"
                    aria-label={tc('removeSuggestion')}
                    title={tc('removeSuggestion')}
                    onClick={() =>
                      setChat({
                        suggestions: chat.suggestions.filter((_, j) => j !== i),
                        suggestionNodes: nodes.filter((_, j) => j !== i),
                      })
                    }
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
                  >
                    ×
                  </button>
                </div>
                <div>
                  <label htmlFor={`wgt-f-qr-step-${i}`} className={LABEL}>
                    {t('replyStep')}
                  </label>
                  <select
                    id={`wgt-f-qr-step-${i}`}
                    value={nodes[i]}
                    onChange={(e) =>
                      setChat({
                        suggestionNodes: nodes.map((x, j) => (j === i ? e.target.value : x)),
                      })
                    }
                    className={INPUT}
                  >
                    <option value="">{t('replyAsMessage')}</option>
                    {(steps ?? []).map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
          {chat.suggestions.length < CHAT_SUGGESTIONS_MAX ? (
            <button
              type="button"
              onClick={() =>
                setChat({
                  suggestions: [...chat.suggestions, ''],
                  suggestionNodes: [
                    ...chat.suggestions.map((_, j) => chat.suggestionNodes[j] ?? ''),
                    '',
                  ],
                })
              }
              className="rounded-full border border-dashed border-border px-3.5 py-1.5 text-[12px] font-semibold text-brand hover:bg-muted"
            >
              + {tc('addSuggestion')}
            </button>
          ) : null}
        </div>
      </ToolCard>
    </fieldset>
  );
}
