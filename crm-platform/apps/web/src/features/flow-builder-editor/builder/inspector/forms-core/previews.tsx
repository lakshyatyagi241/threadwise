'use client';

import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
import type { FlbBuilderContext } from '@crm/contracts';
import { renderWaText, WaBubble, WaPreview } from '../kit';
import {
  asArray,
  asRecord,
  ctaActions,
  groupBySection,
  LIST_DESC_MAX,
  LIST_SECTION_MAX,
  LIST_TITLE_MAX,
  listItems,
  str,
} from './helpers';

/** The dark "Preview · WhatsApp" blocks Reference shows above message-like node forms. */

type Data = Record<string, unknown>;
type Template = FlbBuilderContext['templates'][number];

const GREEN_TEXT = '#075E54';

const tileClass =
  'flex items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[12.5px] font-semibold shadow-[0_1px_1px_rgba(0,0,0,0.06)]';

function Tiles({ children }: { children: ReactNode }) {
  return <div className="ms-auto mt-[5px] flex max-w-[88%] flex-col gap-[3px]">{children}</div>;
}

function Tile({ children }: { children: ReactNode }) {
  return (
    <div className={tileClass} style={{ color: GREEN_TEXT }}>
      {children}
    </div>
  );
}

const ReplyArrow = () => (
  <svg
    viewBox="0 0 16 16"
    className="h-[11px] w-[11px] shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 6l4-4v3h2a4 4 0 1 1 0 8h-3" />
  </svg>
);
const ListIcon = () => (
  <svg
    viewBox="0 0 16 16"
    className="h-[13px] w-[13px] shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
  </svg>
);

export function MessagePreview({ d }: { d: Data }) {
  const t = useTranslations('flb.builder.formsCore.previews');
  const text = str(d.text).trim()
    ? renderWaText(d.text)
    : `<i style="opacity:0.55">${t('messageEmpty')}</i>`;
  return (
    <WaPreview>
      <WaBubble html={text} />
    </WaPreview>
  );
}

function iconForButton(b: Record<string, unknown>): string {
  const kind = str(b.type ?? b.button_type).toLowerCase();
  if (kind.includes('url') || kind.includes('cta')) return ' ↗';
  if (kind.includes('call') || kind.includes('phone')) return ' ☏';
  return '';
}

export function TemplatePreview({ d, templates }: { d: Data; templates: Template[] }) {
  const tr = useTranslations('flb.builder.formsCore.previews');
  const name = str(d.tpl);
  const t = templates.find((x) => x.name === name);
  if (!t) {
    return (
      <WaPreview>
        <WaBubble>
          {name ? (
            <i style={{ opacity: 0.55 }}>
              {tr.rich('templateMissing', { name, code: (chunks) => <code>{chunks}</code> })}
            </i>
          ) : (
            <i style={{ opacity: 0.55 }}>{tr('templatePick')}</i>
          )}
        </WaBubble>
      </WaPreview>
    );
  }
  const kind = str(t.attachmentType).toLowerCase();
  const buttons = t.buttons;
  const cards = asArray<Record<string, unknown>>(t.carousel).slice(0, 5);
  return (
    <WaPreview>
      <WaBubble>
        <div
          className="mb-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em]"
          style={{ color: GREEN_TEXT, opacity: 0.7 }}
        >
          {t.name}
        </div>
        {kind ? (
          (kind === 'image' || kind === 'photo') && t.attachmentFile ? (
            <img
              src={t.attachmentFile}
              alt=""
              className="mb-1 block max-h-40 max-w-full rounded-[5px] object-cover"
            />
          ) : (
            <div
              className="mb-1 flex h-[60px] items-center justify-center rounded-[5px] font-mono text-[10.5px]"
              style={{ background: '#DFF1ED', color: GREEN_TEXT }}
            >
              {tr('attachment', { kind })}
            </div>
          )
        ) : null}
        {t.header?.trim() ? (
          <div
            className="mb-[3px] text-[12px] font-semibold"
            dangerouslySetInnerHTML={{ __html: renderWaText(t.header) }}
          />
        ) : null}
        {t.body ? <div dangerouslySetInnerHTML={{ __html: renderWaText(t.body) }} /> : null}
        {t.footer?.trim() ? (
          <div className="mt-1.5 text-[10.5px] opacity-70">{t.footer}</div>
        ) : null}
        {buttons.length ? (
          <div className="-mx-2.5 -mb-1.5 mt-1.5 overflow-hidden rounded-b-md">
            {buttons.map((b, i) => (
              <div
                key={i}
                className="border-t bg-white py-1.5 text-center text-[12px] font-semibold"
                style={{ color: GREEN_TEXT, borderColor: 'rgba(0,0,0,0.08)' }}
              >
                {str(b.text ?? b.title ?? b.label)}
                {iconForButton(b)}
              </div>
            ))}
          </div>
        ) : null}
        {cards.length ? (
          <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-0.5">
            {cards.map((c, i) => (
              <div
                key={i}
                className="shrink-0 basis-[130px] rounded-md bg-white p-1.5 text-[10.5px] shadow-[0_1px_1px_rgba(0,0,0,0.06)]"
                style={{ color: '#111B21' }}
              >
                <div className="mb-0.5 text-[11px] font-semibold">{str(c.title ?? c.header)}</div>
                <div className="leading-snug opacity-75">{str(c.body ?? c.text).slice(0, 60)}</div>
              </div>
            ))}
          </div>
        ) : null}
      </WaBubble>
    </WaPreview>
  );
}

const mediaBox: CSSProperties = { background: '#D9FDD3', color: '#111B21' };

export function MediaPreview({ d }: { d: Data }) {
  const t = useTranslations('flb.builder.formsCore.previews');
  const kind = str(d.kind) || 'image';
  const url = str(d.url);
  let top: ReactNode;
  if (kind === 'image' && url) {
    top = (
      <img
        src={url}
        alt=""
        className="mb-1 ms-auto block max-h-40 max-w-[88%] rounded-lg object-cover"
      />
    );
  } else if (kind === 'video' && url) {
    top = (
      <video src={url} controls className="mb-1 ms-auto block max-h-40 max-w-[88%] rounded-lg" />
    );
  } else if (kind === 'document') {
    top = (
      <div
        className="mb-1 ms-auto flex max-w-[88%] items-center gap-2 rounded-lg px-2.5 py-2"
        style={mediaBox}
      >
        <span className="grid h-7 w-7 place-items-center rounded-md bg-brand font-mono text-[9px] text-white">
          PDF
        </span>
        <div className="flex-1 truncate text-[12px]">
          {str(d.filename) || t('documentFallback')}
        </div>
      </div>
    );
  } else if (kind === 'audio') {
    top = (
      <div
        className="mb-1 ms-auto flex max-w-[88%] items-center gap-2 rounded-lg px-2.5 py-2"
        style={mediaBox}
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-white">▶</span>
        <div className="flex-1 text-[11.5px]">{t('voice')}</div>
      </div>
    );
  } else {
    top = (
      <div
        className="mb-1 ms-auto grid min-h-[80px] max-w-[88%] place-items-center rounded-lg px-2.5 py-2 text-[11px]"
        style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)' }}
      >
        {t('kindPreview', { kind })}
      </div>
    );
  }
  return (
    <WaPreview>
      {top}
      {str(d.caption) ? <WaBubble html={renderWaText(d.caption)} /> : null}
    </WaPreview>
  );
}

export function ButtonsPreview({ d }: { d: Data }) {
  const t = useTranslations('flb.builder.formsCore.previews');
  const opts = asArray(d.options).slice(0, 3);
  const prompt = str(d.prompt).trim()
    ? renderWaText(d.prompt)
    : `<i style="opacity:0.55">${t('buttonPrompt')}</i>`;
  return (
    <WaPreview label={t('buttonsLabel', { count: opts.length })}>
      <WaBubble html={prompt} />
      {opts.length ? (
        <Tiles>
          {opts.map((o, i) => (
            <Tile key={i}>
              <ReplyArrow />
              <span>{str(o)}</span>
            </Tile>
          ))}
        </Tiles>
      ) : null}
    </WaPreview>
  );
}

export function ListPreview({ d }: { d: Data }) {
  const t = useTranslations('flb.builder.formsCore.previews');
  const prompt = str(d.prompt).trim()
    ? renderWaText(d.prompt)
    : `<i style="opacity:0.55">${t('listPrompt')}</i>`;
  const btnLabel = str(d.button).trim() || t('listButton');
  const items = listItems(d.options).slice(0, 10);
  const groups = groupBySection(items);
  return (
    <WaPreview label={t('listLabel', { count: items.length })}>
      <WaBubble html={prompt} />
      <Tiles>
        <Tile>
          <ListIcon />
          <span>{btnLabel}</span>
        </Tile>
      </Tiles>
      <div
        className="mt-2.5 border-t border-dashed pt-2"
        style={{ borderColor: 'rgba(255,255,255,0.12)' }}
      >
        <div
          className="mb-1.5 text-center font-mono text-[9.5px] uppercase tracking-[0.14em]"
          style={{ color: 'rgba(255,255,255,0.55)' }}
        >
          {t('bottomSheet')}
        </div>
        <div className="mx-auto max-w-[96%] overflow-hidden rounded-t-xl bg-white">
          <div className="py-1.5 pb-0.5 text-center">
            <span className="inline-block h-[3px] w-9 rounded-sm bg-[#E0E0E0]" />
          </div>
          <div
            className="border-b px-3.5 pb-2 pt-1.5 text-[12px] font-semibold"
            style={{ color: '#111B21', borderColor: 'rgba(0,0,0,0.06)' }}
          >
            {btnLabel}
          </div>
          {items.length ? (
            groups.map((g, gi) => (
              <div key={gi}>
                {g.title ? (
                  <div
                    className="px-3 pb-[3px] pt-[7px] text-[11px] font-bold uppercase tracking-[0.04em]"
                    style={{ color: GREEN_TEXT, background: '#F7F8FA' }}
                  >
                    {g.title.slice(0, LIST_SECTION_MAX)}
                  </div>
                ) : null}
                {g.rows.map((o, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-2 border-t px-3 py-2.5 text-[12.5px]"
                    style={{ color: '#111B21', borderColor: 'rgba(0,0,0,0.06)' }}
                  >
                    <span>
                      <span className="block">{o.title.slice(0, LIST_TITLE_MAX)}</span>
                      {o.description ? (
                        <span className="mt-px block text-[11px]" style={{ color: '#667781' }}>
                          {o.description.slice(0, LIST_DESC_MAX)}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px]"
                      style={{ borderColor: GREEN_TEXT }}
                    />
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div
              className="p-3.5 text-center text-[11px] italic"
              style={{ color: 'rgba(0,0,0,0.5)' }}
            >
              {t('listEmpty')}
            </div>
          )}
        </div>
      </div>
    </WaPreview>
  );
}

const ctaGlyph = (t: string): string =>
  t === 'phone' || t === 'call_now' ? '☏' : t === 'copy' ? '⧉' : '↗';

export function CtaPreview({ d }: { d: Data }) {
  const t = useTranslations('flb.builder.formsCore.previews');
  const acts = ctaActions(d);
  const hasCopy = acts.some((a) => (a.type || 'url') === 'copy');
  return (
    <WaPreview label={t('buttonsLabel', { count: acts.length })}>
      <WaBubble>
        <div className="text-[12.5px]">{hasCopy ? t('ctaTapCopy') : t('ctaTap')}</div>
        {acts.map((a, i) =>
          (a.type || 'url') === 'copy' && a.value ? (
            <div
              key={i}
              className="mt-1.5 rounded-md px-2.5 py-1.5 text-center font-mono text-[16px] font-semibold tracking-[0.06em]"
              style={{ background: 'rgba(7,94,84,0.08)', color: '#0E2A26' }}
            >
              {a.value}
            </div>
          ) : null,
        )}
      </WaBubble>
      {acts.length ? (
        <Tiles>
          {acts.slice(0, 3).map((a, i) => {
            const type = a.type || 'url';
            const lbl =
              a.label ||
              (type === 'copy'
                ? t('ctaCopy')
                : type === 'phone' || type === 'call_now'
                  ? t('ctaCall')
                  : t('ctaVisit'));
            return (
              <Tile key={i}>
                {lbl} {ctaGlyph(type)}
              </Tile>
            );
          })}
        </Tiles>
      ) : null}
    </WaPreview>
  );
}

export function LocationPreview({ d }: { d: Data }) {
  const t = useTranslations('flb.builder.formsCore.previews');
  const lat = str(d.lat);
  const lng = str(d.lng);
  return (
    <WaPreview>
      <WaBubble>
        <div className="text-[11.5px] font-semibold">{str(d.title) || t('locationFallback')}</div>
        <div className="text-[11px] opacity-75">{str(d.address)}</div>
        <div
          className="relative mt-1 h-16 overflow-hidden rounded-md"
          style={{
            background:
              'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.35), transparent 40%), linear-gradient(135deg,#A8D5BA,#7AB68B 60%,#5C9A75)',
          }}
        >
          <svg
            viewBox="0 0 100 60"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            style={{ opacity: 0.35 }}
          >
            <path d="M0 35 Q 25 25 50 35 T 100 30" stroke="#5C9A75" fill="none" strokeWidth="0.8" />
            <path d="M0 50 Q 30 42 60 48 T 100 45" stroke="#5C9A75" fill="none" strokeWidth="0.8" />
            <path d="M20 0 L18 30 L24 30 L22 0Z" fill="#5C9A75" opacity="0.45" />
            <path d="M70 0 L67 38 L74 38 L71 0Z" fill="#5C9A75" opacity="0.4" />
          </svg>
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
            <svg
              viewBox="0 0 16 16"
              className="h-[18px] w-[18px] text-[#E87A5D]"
              fill="currentColor"
            >
              <path d="M8 1.5C5.5 1.5 3.5 3.4 3.5 5.7c0 3 4.5 8.8 4.5 8.8s4.5-5.8 4.5-8.8C12.5 3.4 10.5 1.5 8 1.5zM8 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
            </svg>
          </span>
        </div>
        {lat && lng ? (
          <div className="mt-1 font-mono text-[10px] opacity-60">
            {lat}, {lng}
          </div>
        ) : null}
      </WaBubble>
    </WaPreview>
  );
}

export function PollPreview({ d }: { d: Data }) {
  const t = useTranslations('flb.builder.formsCore.previews');
  const q = str(d.question) || t('pollFallback');
  return (
    <WaPreview>
      <WaBubble>
        <div className="text-[12.5px] font-semibold">{q}</div>
        {asArray(d.options).map((o, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 border-t py-[5px] text-[12px]"
            style={{ borderColor: 'rgba(0,0,0,0.08)' }}
          >
            <span
              className={`inline-block h-[11px] w-[11px] border-[1.5px] ${d.multi ? 'rounded-sm' : 'rounded-full'}`}
              style={{ borderColor: GREEN_TEXT }}
            />
            {str(o)}
          </div>
        ))}
      </WaBubble>
    </WaPreview>
  );
}

export function SequencePreview({ d }: { d: Data }) {
  const t = useTranslations('flb.builder.formsCore.previews');
  const replies = asArray(d.replies).map(asRecord);
  return (
    <WaPreview label={t('repliesLabel', { count: replies.length })}>
      {replies.length ? (
        replies.map((r, i) => {
          const kind = str(r.type) || 'text';
          if (kind === 'text') {
            const html = str(r.text).trim()
              ? renderWaText(r.text)
              : `<i style="opacity:0.55">${t('emptyText')}</i>`;
            return <WaBubble key={i} html={html} />;
          }
          let media: ReactNode;
          const url = str(r.url);
          if (kind === 'image' && url) {
            media = (
              <img
                src={url}
                alt=""
                className="mb-[5px] ms-auto block max-h-40 max-w-[88%] rounded-lg object-cover"
              />
            );
          } else if (kind === 'video' && url) {
            media = (
              <div
                className="mb-[5px] ms-auto flex h-[120px] max-w-[88%] items-center justify-center rounded-lg text-[11px] tracking-[0.05em] text-white"
                style={{ background: '#0B1F1C' }}
              >
                {t('videoTile')}
              </div>
            );
          } else if (kind === 'audio') {
            media = (
              <div
                className="mb-[5px] ms-auto flex max-w-[88%] items-center gap-2 rounded-lg px-2.5 py-2"
                style={mediaBox}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#075E54] text-[11px] text-white">
                  ►
                </span>
                <span className="flex-1 text-[11.5px]">
                  {str(r.filename) || t('audioFallback')}
                </span>
              </div>
            );
          } else if (kind === 'document') {
            media = (
              <div
                className="mb-[5px] ms-auto flex max-w-[88%] items-center gap-2 rounded-lg px-2.5 py-2"
                style={mediaBox}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded bg-[#075E54] font-mono text-[9px] text-white">
                  DOC
                </span>
                <span className="flex-1 text-[11.5px]">{str(r.filename) || t('documentName')}</span>
              </div>
            );
          } else {
            media = (
              <div
                className="mb-[5px] ms-auto max-w-[88%] rounded-lg px-2.5 py-2 text-center text-[11px]"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
              >
                {t('kindPreviewInline', { kind })}
              </div>
            );
          }
          return (
            <div key={i}>
              {media}
              {str(r.caption) ? <WaBubble html={renderWaText(r.caption)} /> : null}
            </div>
          );
        })
      ) : (
        <div
          className="py-6 text-center text-[11px] italic"
          style={{ color: 'rgba(255,255,255,0.55)' }}
        >
          {t('noReplies')}
        </div>
      )}
    </WaPreview>
  );
}
