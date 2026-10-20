'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  flbAiSetup,
  flbSanitizeConditionGroup,
  type FlbBuilderContext,
  type FlowNode,
  type FlbNodeData,
} from '@crm/contracts';
import { condSummary } from '../lib/contract-text';
import { useFlb } from '../lib/msg';
import { findTemplate } from '../lib/templates';
import { FlowImage } from './flow-image';

/** Message text (140) and media caption (80) end in an ellipsis when cut, as in Reference; every other preview line is a plain cut. */
const trunc = (s: unknown, n: number): string => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
/** The card line for a tree summary, cut at a word-ish length with an ellipsis. */
export const COND_CARD_MAX = 90;
export const condCardText = (line: string): string =>
  line.length > COND_CARD_MAX ? `${line.slice(0, COND_CARD_MAX - 1).trimEnd()}…` : line;
const cut = (s: unknown, n: number): string => String(s ?? '').slice(0, n);
const asArr = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const lastSeg = (url: string) => url.split('/').pop() ?? url;

const Box = ({ children, pb = 'pb-2' }: { children: ReactNode; pb?: string }) => (
  <div className={`px-3 pt-2.5 ${pb}`}>{children}</div>
);
const Line = ({ children }: { children: ReactNode }) => (
  <div className="px-3 pt-2 pb-1.5 text-[11.5px] text-[var(--flb-ink-700)]">{children}</div>
);
const Mono = ({ children, cls = '' }: { children: ReactNode; cls?: string }) => (
  <span className={`font-mono text-foreground ${cls}`}>{children}</span>
);
const Muted = ({ children }: { children: ReactNode }) => (
  <span className="text-muted-foreground">{children}</span>
);
const Count = ({ children }: { children: ReactNode }) => (
  <div className="font-mono text-[10.5px] text-muted-foreground">{children}</div>
);

const MEDIA_ICON: Record<string, string> = {
  image: 'M2 3h12v10H2zM6 7m-1 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0M3 11l3-3 4 4 3-3 0 4',
  video: 'M2 3h12v10H2zM6 5l5 3-5 3z',
  document: 'M4 2h6l3 3v9H4zM10 2v3h3',
  audio: 'M5 4v8M5 6c-2 0-2 4 0 4M5 6c2 0 2 4 0 4M10 3v10M10 5c-2 0-2 6 0 6M10 5c2 0 2 6 0 6',
};

const COND_OP: Record<string, string> = {
  equals: '=',
  not_equals: '≠',
  contains: '⊆',
  not_contains: '⊄',
  gt: '>',
  lt: '<',
};

const CHIP: Record<string, string> = {
  text: 'bg-[var(--flb-bubble)] text-brand',
  image: 'bg-[#FFF4E0] text-[#7B5A14]',
  video: 'bg-[#F3E9FF] text-[#5B3D8A]',
  audio: 'bg-[#FBE9E7] text-[#A1431F]',
  document: 'bg-[#D9E5F2] text-[#13478A]',
};

/** What a node card shows under its header: a read-only summary of the node's data (never executes anything). */
export function NodePreview({ node, ctx }: { node: FlowNode; ctx: FlbBuilderContext }): ReactNode {
  const tp = useTranslations('flb.builder.shell.nodePreview');
  const tf = useFlb();
  const d: FlbNodeData = node.data ?? {};
  switch (node.type) {
    case 'trigger':
      return (
        <div className="px-3 pt-2 pb-2 text-[11.5px] text-[var(--flb-ink-700)]">
          <Muted>{tp('when')} </Muted>
          <span className="font-mono">{str(d.kind) || 'manual'}</span>
          {d.kind === 'keyword' ? (
            <div className="mt-0.5 truncate font-mono text-[11px] text-foreground">
              {d.keywordMode === 'any' ? tp('anyMessage') : str(d.keywords) || tp('noKeywords')}
            </div>
          ) : null}
        </div>
      );
    case 'message':
      return (
        <Box>
          <div className="bubble wa whitespace-pre-wrap break-words">
            {trunc(str(d.text) || tp('typeMessage'), 140)}
          </div>
        </Box>
      );
    case 'template': {
      const t = findTemplate(ctx.templates, d.tpl);
      const first = t ? str(t.body).split('\n')[0] : tp('pickTemplateHint');
      return (
        <Box>
          <div className="bubble">
            <div className="mb-0.5 font-mono text-[10.5px] text-muted-foreground">
              {str(d.tpl) || tp('pickTemplate')}
            </div>
            {t?.header ? <div className="text-[11.5px] font-semibold">{t.header}</div> : null}
            <div className="truncate">{first}</div>
            {t && t.buttons.length ? (
              <div className="mt-1 text-[10px] text-muted-foreground">
                {tp('buttonCount', { count: t.buttons.length })}
              </div>
            ) : null}
          </div>
        </Box>
      );
    }
    case 'media': {
      const kind = str(d.kind) || 'image';
      const url = str(d.url);
      const hasFile = !!(url || str(d.filename).trim());
      const name = str(d.filename) || (url ? lastSeg(url) : '') || tp('noFile');
      if (kind === 'image' && url) {
        return (
          <Box>
            <div className="bubble wa">
              <FlowImage
                src={url}
                where="media card"
                style={{
                  display: 'block',
                  maxWidth: '100%',
                  maxHeight: 120,
                  objectFit: 'cover',
                  borderRadius: 4,
                }}
              />
              {d.caption ? <div className="mt-1 text-[12px]">{trunc(d.caption, 80)}</div> : null}
            </div>
          </Box>
        );
      }
      if ((kind === 'video' || kind === 'audio') && url) {
        return (
          <Box>
            <div className="bubble wa">
              {kind === 'video' ? (
                <video
                  src={url}
                  controls
                  preload="metadata"
                  className="block max-h-[140px] w-full rounded bg-black"
                />
              ) : (
                <audio src={url} controls preload="metadata" className="block h-9 w-full" />
              )}
              {d.caption ? <div className="mt-1 text-[12px]">{trunc(d.caption, 80)}</div> : null}
            </div>
          </Box>
        );
      }
      return (
        <Box>
          <div className="bubble wa flex items-center gap-2">
            <span
              className="grid h-6 w-6 shrink-0 place-items-center rounded"
              style={{
                background: hasFile ? 'var(--flb-mint)' : 'var(--muted)',
                color: hasFile ? 'var(--brand)' : '#92A29E',
              }}
            >
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path d={MEDIA_ICON[kind] ?? MEDIA_ICON.document} />
              </svg>
            </span>
            <div className="min-w-0">
              <div
                className={`truncate font-medium ${hasFile ? '' : 'italic text-muted-foreground'}`}
              >
                {name}
              </div>
              <div className="text-[10.5px] text-muted-foreground">
                {kind}
                {d.caption ? ` · ${cut(d.caption, 30)}` : ''}
              </div>
            </div>
          </div>
        </Box>
      );
    }
    case 'sequence': {
      const replies = asArr(d.replies);
      if (replies.length === 0) {
        return (
          <div className="px-3 pt-2 pb-2 text-[11.5px] italic text-muted-foreground">
            {tp('noReplies')}
          </div>
        );
      }
      return (
        <div className="space-y-1 px-3 pt-2 pb-2">
          {replies.slice(0, 5).map((r, i) => {
            const type = str(r.type) || 'text';
            const lbl =
              type === 'text'
                ? cut(str(r.text), 38) || tp('emptyText')
                : str(r.filename) || (r.url ? lastSeg(str(r.url)) : type);
            return (
              <div
                key={i}
                className={`flex items-center gap-1.5 rounded px-2 py-1 ${CHIP[type] ?? 'bg-muted text-[var(--flb-ink-700)]'}`}
              >
                <span className="font-mono text-[9.5px] opacity-70">{i + 1}.</span>
                <span className="flex-1 truncate text-[11px]">{lbl}</span>
                <span className="font-mono text-[9.5px] uppercase opacity-70">{type}</span>
              </div>
            );
          })}
          {replies.length > 5 ? (
            <div className="px-2 text-[10.5px] italic text-muted-foreground">
              {tp('moreReplies', { count: replies.length - 5 })}
            </div>
          ) : null}
        </div>
      );
    }
    case 'buttons':
      return (
        <Box pb="pb-1">
          <div className="bubble wa">{str(d.prompt) || tp('prompt')}</div>
        </Box>
      );
    case 'list': {
      const n = asArr(d.options).length;
      return (
        <Box>
          <div className="bubble wa">{str(d.prompt) || tp('prompt')}</div>
          <div className="mt-1 inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-brand">
            <svg
              viewBox="0 0 16 16"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
            </svg>
            <span className="font-semibold">{str(d.button) || tp('viewOptions')}</span>
          </div>
          {n ? (
            <div className="mt-1 text-[10px] text-muted-foreground">
              {tp('itemsAfterTap', { count: n })}
            </div>
          ) : null}
        </Box>
      );
    }
    case 'ask': {
      const exp = asArr(d.options);
      return (
        <div className={`px-3 pt-2.5 ${exp.length ? 'pb-1' : 'pb-2'}`}>
          <div className="bubble wa">{str(d.prompt) || tp('askDefault')}</div>
          {exp.length === 0 ? (
            <div className="mt-1.5 text-[10.5px] text-muted-foreground">{tp('customerReply')}</div>
          ) : null}
        </div>
      );
    }
    case 'condition': {
      // A nested tree (beyond Reference) wins: one parenthesised line, cut so the card stays small.
      const tree = flbSanitizeConditionGroup(d.conditionGroup);
      if (tree) {
        const line = condSummary(tf, tree);
        return (
          <div
            title={line}
            className="px-3 pt-2 pb-1.5 text-[11px] leading-snug text-[var(--flb-ink-700)]"
          >
            <span className="font-mono text-[10px] text-muted-foreground">{tp('if')} </span>
            <Mono>{tree.items.length === 0 ? tp('noConditions') : condCardText(line)}</Mono>
          </div>
        );
      }
      const conds = asArr(d.conditions);
      const ops = Array.isArray(d.operators) ? (d.operators as string[]) : [];
      if (conds.length === 0)
        return (
          <div className="px-3 pt-2 pb-1.5 text-[11.5px] italic text-muted-foreground">
            {tp('noConditions')}
          </div>
        );
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11px] leading-snug text-[var(--flb-ink-700)]">
          <span className="font-mono text-[10px] text-muted-foreground">{tp('if')} </span>
          {conds.map((c, i) => (
            <span key={i}>
              {i > 0 ? (
                <span
                  className={`mx-1 rounded px-1 py-0.5 font-mono text-[10px] ${(ops[i - 1] || 'AND') === 'OR' ? 'bg-amber-100 text-[#7B5A14]' : 'bg-[var(--flb-bubble)] text-brand'}`}
                >
                  {ops[i - 1] || 'AND'}
                </span>
              ) : null}
              <Mono>{`{{${str(c.variable) || '?'}}}`}</Mono>
              <span className="mx-1 text-muted-foreground">
                {str(c.operator) === 'exists'
                  ? tp('opExists')
                  : (COND_OP[str(c.operator) || 'equals'] ?? str(c.operator))}
              </span>
              <Mono>{str(c.value) || '?'}</Mono>{' '}
            </span>
          ))}
        </div>
      );
    }
    case 'delay':
      return (
        <Line>
          <Muted>{tp('wait')} </Muted>
          <Mono cls="text-[13px]">
            {str(d.amount ?? 5)} {str(d.unit) || 'min'}
          </Mono>
        </Line>
      );
    case 'webhook':
      return (
        <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 text-[11.5px]">
          <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--flb-ink-700)]">
            {str(d.method) || 'POST'}
          </span>
          <span className="flex-1 truncate font-mono text-[11px]">
            {cut(str(d.url) || 'https://…', 32)}
          </span>
        </div>
      );
    case 'code':
      return (
        <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 text-[11.5px]">
          <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--flb-ink-700)]">
            JS
          </span>
          <Muted>{tp('saveTo')}</Muted>
          <Mono cls="text-[11px]">{`{{${str(d.save) || 'result'}}}`}</Mono>
        </div>
      );
    case 'ai': {
      // An agent setup shows the agent (its prompt and model are its own); a custom one shows the model and the prompt.
      const asAgent = flbAiSetup(d) === 'agent';
      const agent = asAgent ? ctx.assistants.find((a) => a.id === str(d.assistant)) : undefined;
      return (
        <Box>
          <div className="bubble">
            🤖 {asAgent ? (agent?.name ?? tp('aiLabel')) : str(d.model) || 'gpt-4o-mini'}
          </div>
          <div className="mt-1.5 line-clamp-2 text-[10.5px] text-muted-foreground">
            {asAgent ? agent?.model || tp('aiAnswers') : str(d.prompt) || tp('aiPromptDefault')}
          </div>
        </Box>
      );
    }
    case 'tag': {
      const cached = ctx.tags.find((t) => t.id === str(d.tagId));
      const name = cached ? cached.name : str(d.tag) || '—';
      const swatch = cached?.color || 'var(--brand)';
      return (
        <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 text-[11.5px]">
          <Muted>{str(d.action) || 'add'}</Muted>
          <span
            className="rounded-full border px-2 py-0.5 text-[11px]"
            style={{
              background: 'var(--flb-mint)',
              borderColor: `color-mix(in srgb, ${swatch} 40%, transparent)`,
              color: swatch,
            }}
          >
            <span
              className="me-1 inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: swatch }}
            />
            {name}
          </span>
          {!cached && d.tag ? (
            <span className="text-[10px] italic text-muted-foreground">{tp('tagNew')}</span>
          ) : null}
        </div>
      );
    }
    case 'assign': {
      const team = ctx.teams.find((t) => t.id === str(d.team));
      const teamLabel = team
        ? team.name
        : d.team
          ? tp('teamNumber', { id: str(d.team) })
          : tp('pickTeam');
      const agent =
        d.userId && team
          ? (team.members.find((m) => m.id === str(d.userId))?.name ??
            tp('agentNumber', { id: str(d.userId) }))
          : null;
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11.5px]">
          <div className="flex items-center gap-2">
            <Muted>{tp('team')}</Muted>
            <Mono cls="truncate">{teamLabel}</Mono>
          </div>
          {agent ? (
            <div className="mt-0.5 flex items-center gap-2">
              <Muted>{tp('agent')}</Muted>
              <Mono cls="truncate">{agent}</Mono>
            </div>
          ) : null}
          {d.message ? (
            <div className="mt-1 truncate text-[10.5px] italic text-muted-foreground">
              &quot;{cut(d.message, 40)}&quot;
            </div>
          ) : null}
        </div>
      );
    }
    case 'update_contact':
      return (
        <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 text-[11.5px]">
          <Mono cls="shrink-0">{str(d.field).trim() || '—'}</Mono>
          <Muted>=</Muted>
          <Mono cls="truncate">{str(d.value) || '—'}</Mono>
        </div>
      );
    case 'subflow': {
      const sub = d.flow ? ctx.flows.find((f) => f.id === str(d.flow)) : null;
      const lbl = d.flow ? (sub?.name ?? tp('flowNumber', { id: str(d.flow) })) : tp('pickFlow');
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11.5px]">
          <Muted>{tp('run')} </Muted>
          <Mono cls="truncate">{lbl}</Mono>
        </div>
      );
    }
    case 'carousel': {
      const cards = asArr(d.cards);
      const first = cards[0] ?? {};
      return (
        <div className="px-3 pt-2 pb-2">
          <div className="bubble wa">
            {str(first.image) ? (
              <FlowImage
                src={str(first.image)}
                where="carousel card"
                style={{
                  display: 'block',
                  width: '100%',
                  maxHeight: 100,
                  objectFit: 'cover',
                  borderRadius: 4,
                }}
              />
            ) : null}
            {str(first.title) ? (
              <div className="mt-1 text-[12px] font-semibold">{trunc(first.title, 40)}</div>
            ) : null}
            <div className="mt-0.5 text-[10.5px] text-muted-foreground">{cards.length} ×</div>
          </div>
        </div>
      );
    }
    case 'cta': {
      let actions = Array.isArray(d.actions) ? asArr(d.actions) : null;
      if (!actions) {
        const k = str(d.kind) || 'url';
        const v = k === 'phone' || k === 'call_now' ? d.phone : k === 'copy' ? d.code : d.url;
        actions = [{ type: k, label: str(d.label) || 'CTA', value: str(v) }];
      }
      const icon = (t: string) =>
        t === 'phone' || t === 'call_now'
          ? 'M3 3h3l1 3-1.5 1a8 8 0 0 0 4 4l1-1.5 3 1v3a11 11 0 0 1-10.5-10.5z'
          : t === 'copy'
            ? 'M5 5h7v8H5z M3 3h7v2'
            : 'M5 5l6 6 M7 5h4v4';
      return (
        <div className="space-y-1 px-3 pt-2 pb-2">
          {actions.slice(0, 3).map((a, i) => {
            const t = str(a.type) || 'url';
            return (
              <div key={i}>
                <div className="flex items-center gap-1.5 rounded bg-[var(--flb-bubble)] px-2 py-1 text-[11px] text-brand">
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3 w-3 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  >
                    <path d={icon(t)} />
                  </svg>
                  <span className="flex-1 truncate font-medium">
                    {str(a.label) ||
                      (t === 'copy'
                        ? tp('ctaCopy')
                        : t === 'phone' || t === 'call_now'
                          ? tp('ctaCall')
                          : tp('ctaVisit'))}
                  </span>
                  <span className="font-mono text-[9.5px] uppercase opacity-70">{t}</span>
                </div>
                {str(a.value) ? (
                  <div className="truncate px-2 pt-0.5 font-mono text-[10px] text-muted-foreground">
                    {str(a.value)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      );
    }
    case 'location':
      return (
        <Box>
          <div className="bubble">
            <div className="flex items-center gap-1.5">
              <svg
                viewBox="0 0 16 16"
                className="h-3 w-3 shrink-0 text-[var(--flb-coral)]"
                fill="currentColor"
              >
                <path d="M8 1.5C5.5 1.5 3.5 3.4 3.5 5.7c0 3 4.5 8.8 4.5 8.8s4.5-5.8 4.5-8.8C12.5 3.4 10.5 1.5 8 1.5zM8 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
              </svg>
              <span className="font-medium">{str(d.title) || tp('location')}</span>
            </div>
            <div className="truncate text-[10.5px] text-muted-foreground">
              {str(d.address) || '—'}
            </div>
          </div>
        </Box>
      );
    case 'poll':
      return (
        <Box pb="pb-1">
          <div className="bubble">📊 {str(d.question) || tp('pollQuestion')}</div>
        </Box>
      );
    case 'chatbot': {
      const agent = ctx.agents.find((a) => a.id === str(d.bot));
      const lbl = agent
        ? agent.name
        : d.bot
          ? tp('chatAgentNumber', { id: str(d.bot) })
          : tp('pickAgent');
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11.5px]">
          <div className="flex items-center gap-1.5">
            <svg
              viewBox="0 0 16 16"
              className="h-3 w-3 text-brand"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M4 4h8v6H8l-2 2v-2H4z" />
            </svg>
            <Mono cls="truncate">{lbl}</Mono>
          </div>
          {agent?.model ? (
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{agent.model}</div>
          ) : null}
        </div>
      );
    }
    case 'whatsapp_shop':
    case 'woocommerce':
    case 'shopify': {
      const items = asArr(d.productItems);
      if (items.length === 0)
        return (
          <div className="px-3 pt-2 pb-2 text-[11.5px] italic text-muted-foreground">
            {tp('noProducts')}
          </div>
        );
      return (
        <div className="px-3 pt-2 pb-2">
          <div className="mb-1.5 flex items-center gap-1.5">
            {items.slice(0, 3).map((p, i) =>
              p.image ? (
                <img
                  key={i}
                  src={str(p.image)}
                  alt=""
                  className="h-9 w-9 rounded border border-border object-cover"
                />
              ) : (
                <div
                  key={i}
                  className="grid h-9 w-9 place-items-center rounded border border-border bg-muted font-mono text-[8px] text-muted-foreground"
                >
                  IMG
                </div>
              ),
            )}
            {items.length > 3 ? (
              <span className="ms-1 text-[10.5px] text-muted-foreground">+{items.length - 3}</span>
            ) : null}
          </div>
          <Count>{tp('productCount', { count: items.length })}</Count>
        </div>
      );
    }
    case 'book_appointment':
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11.5px]">
          <Muted>{tp('offer')} </Muted>
          <Mono>{tp('slotCount', { count: str(d.slotCount) || 5 })}</Mono>
          <div className="truncate text-[10.5px] text-muted-foreground">
            {cut(str(d.prompt) || tp('pickTime'), 40)}
          </div>
        </div>
      );
    case 'google_meet':
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11.5px]">
          <Count>
            {tp('meetTiming', {
              duration: str(d.durationMinutes) || 30,
              lead: str(d.leadMinutes) || 5,
            })}
          </Count>
          <div className="truncate text-[12px] text-foreground">
            {str(d.title) || tp('meeting')}
          </div>
        </div>
      );
    case 'wa_form': {
      const form = ctx.forms.find((f) => f.id === str(d.formId));
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11.5px]">
          <Count>{form ? form.title : tp('formNumber', { id: str(d.formId) || '?' })}</Count>
          <div className="truncate text-[12px] text-foreground">
            {str(d.bodyText) || tp('tapToOpenForm')}
          </div>
        </div>
      );
    }
    case 'faq':
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11.5px]">
          <Count>{tp('faqRetired')}</Count>
        </div>
      );
    case 'api_library': {
      const api = str(d.apiName);
      const overrides = asArr(d.inputs).length;
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11.5px]">
          <Count>
            {api ? api : '(pick an API)'}
            {overrides > 0 ? ` · ${overrides} input${overrides === 1 ? '' : 's'}` : ''}
          </Count>
          <div className="truncate text-[12px] text-foreground">
            <Muted>save →</Muted>{' '}
            <Mono cls="text-[11px]">{`{{${str(d.save) || 'api_response'}}}`}</Mono>
          </div>
        </div>
      );
    }
    case 'google_sheets':
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11.5px]">
          <Count>
            {(str(d.mode) || 'write').toUpperCase()} ·{' '}
            {d.sheetId ? `${str(d.sheetId).slice(0, 10)}…` : tp('pickSheet')}
          </Count>
          <div className="truncate text-[12px] text-foreground">
            {d.mode === 'read'
              ? tp('lookup', {
                  column: str(d.matchColumn) || '?',
                  value: str(d.matchValue) || '?',
                })
              : tp('append', { count: asArr(d.columns).length })}
          </div>
        </div>
      );
    case 'google_docs':
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11.5px]">
          <Count>
            {d.templateId
              ? tp('templateRef', { id: str(d.templateId).slice(0, 10) })
              : tp('pickTemplateParen')}
          </Count>
          <div className="truncate text-[12px] text-foreground">
            {str(d.newTitle) || tp('document')}
          </div>
        </div>
      );
    case 'google_form':
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11.5px]">
          <Count>
            {d.formId ? tp('formRef', { id: str(d.formId).slice(0, 10) }) : tp('pickForm')}
          </Count>
          <div className="truncate text-[12px] text-foreground">
            {str(d.bodyText) || tp('sendFormLink')}
          </div>
        </div>
      );
    case 'deal': {
      const stage = ctx.stages.find((s) => s.id === str(d.stageId));
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11.5px]">
          <Count>
            {d.action === 'move' ? tp('dealMove') : tp('dealCreate')} ·{' '}
            {stage
              ? stage.name
              : d.stageId
                ? tp('stageRef', { id: str(d.stageId) })
                : tp('pickStage')}
          </Count>
          <div className="truncate text-[12px] text-foreground">
            {str(d.dealName) || tp('newDeal')}
          </div>
        </div>
      );
    }
    // notify_number, wa_to_instagram and ai_call have no preview on Reference's cards either: header and ports only.
    case 'cf_say':
      return (
        <Box>
          <div className="bubble wa whitespace-pre-wrap break-words">
            {cut(str(d.text) || tp('saySomething'), 120)}
          </div>
        </Box>
      );
    case 'cf_listen':
      return (
        <Line>
          <Muted>{tp('listen')} </Muted>
          <Mono>{`{{${str(d.save) || 'caller_said'}}}`}</Mono>
        </Line>
      );
    case 'cf_ai':
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11.5px]">
          <div className="font-mono text-[10px] text-muted-foreground">
            {str(d.model) || tp('aiLabel')}
            {d.assistant ? ' · KB' : ''}
          </div>
          <div className="truncate text-[12px] text-foreground">
            {cut(str(d.prompt) || tp('aiAnswers'), 46)}
          </div>
        </div>
      );
    case 'cf_assistant': {
      const a = ctx.callAssistants.find((x) => x.id === str(d.assistant));
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11.5px]">
          <div className="font-mono text-[10px] text-muted-foreground">{tp('voiceAgent')}</div>
          <div className="truncate text-[12px] text-foreground">
            {a
              ? a.name
              : d.assistant
                ? tp('assistantNumber', { id: str(d.assistant) })
                : tp('pickAssistant')}
          </div>
        </div>
      );
    }
    case 'cf_menu':
      return (
        <Line>
          <Muted>{tp('routeBy', { mode: str(d.mode) || 'intent' })}</Muted>
          <Mono>{tp('branchCount', { count: asArr(d.options).length })}</Mono>
        </Line>
      );
    case 'cf_search':
      return (
        <Line>
          <Muted>{tp('search')} </Muted>
          <Mono>{`{{${str(d.save) || 'search'}}}`}</Mono>
        </Line>
      );
    case 'cf_transfer':
      return (
        <Line>
          <Muted>{tp('transfer')} </Muted>
          <Mono>{str(d.number) || tp('setNumber')}</Mono>
        </Line>
      );
    case 'cf_hangup':
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11.5px] italic text-muted-foreground">
          {cut(str(d.goodbye) || tp('endCall'), 40)}
        </div>
      );
    case 'ig_send_dm':
      return (
        <Box>
          <div className="bubble wa whitespace-pre-wrap break-words">
            {cut(str(d.text) || tp('sendDm'), 120)}
          </div>
        </Box>
      );
    case 'ig_quick':
      return (
        <div className="px-3 pt-2 pb-1.5">
          <div className="bubble wa mb-1 whitespace-pre-wrap break-words">
            {cut(str(d.text) || tp('pickOne'), 80)}
          </div>
          <Count>{tp('quickReplyCount', { count: asArr(d.options).length })}</Count>
        </div>
      );
    case 'ig_buttons':
      return (
        <div className="px-3 pt-2 pb-1.5">
          <div className="bubble wa mb-1 whitespace-pre-wrap break-words">
            {cut(str(d.text) || tp('buttonsDots'), 80)}
          </div>
          <Count>{tp('buttonCount', { count: asArr(d.buttons).length })}</Count>
        </div>
      );
    case 'ig_reply_comment':
      return (
        <Line>
          <Muted>{tp('publicReply')}</Muted>
          <span className="text-foreground">{cut(str(d.message) || '…', 40)}</span>
        </Line>
      );
    case 'ig_ai':
      return (
        <div className="px-3 pt-2 pb-1.5 text-[11.5px]">
          <div className="font-mono text-[10px] text-muted-foreground">
            {str(d.model) || tp('aiLabel')}
            {d.assistant ? ' · KB' : ''}
          </div>
          <div className="truncate text-[12px] text-foreground">
            {cut(str(d.prompt) || tp('aiAnswers'), 46)}
          </div>
        </div>
      );
    case 'ig_products':
      return (
        <div className="px-3 pt-2 pb-1.5">
          <div className="text-[11.5px] font-medium text-foreground">{tp('productCarousel')}</div>
          <Count>
            {d.selection === 'all'
              ? tp('firstSynced', { count: str(d.limit) || 5 })
              : tp('productCount', {
                  count: Array.isArray(d.productIds) ? d.productIds.length : 0,
                })}
          </Count>
        </div>
      );
    case 'ig_ask':
      return (
        <div className="px-3 pt-2 pb-1.5">
          <div className="bubble wa mb-1 whitespace-pre-wrap break-words">
            {cut(str(d.question) || tp('askSomething'), 80)}
          </div>
          <Count>{tp('answerTo', { variable: `{{${str(d.save) || 'answer'}}}` })}</Count>
        </div>
      );
    case 'ig_lead':
    case 'fb_lead':
      return (
        <div className="px-3 pt-2 pb-1.5">
          <div className="text-[11.5px] font-medium text-foreground">{tp('captureLead')}</div>
          <Count>{d.createDeal !== false ? tp('withDeal') : tp('leadOnly')}</Count>
        </div>
      );
    case 'fb_gallery':
      return (
        <div className="px-3 pt-2 pb-1.5">
          <div className="text-[11.5px] font-medium text-foreground">{tp('cardGallery')}</div>
          <Count>{tp('cardCount', { count: asArr(d.cards).length })}</Count>
        </div>
      );
    case 'fb_products':
      return (
        <div className="px-3 pt-2 pb-1.5">
          <div className="text-[11.5px] font-medium text-foreground">{tp('productCarousel')}</div>
          <Count>{tp('productCount', { count: asArr(d.products).length })}</Count>
        </div>
      );
    case 'fb_reply_comment':
      return (
        <Line>
          <Muted>{tp('publicReply')}</Muted>
          <span className="text-foreground">{cut(str(d.text) || '…', 40)}</span>
        </Line>
      );
    case 'tg_payment':
      return (
        <div className="px-3 pt-2 pb-1.5">
          <div className="text-[11.5px] font-medium text-foreground">
            {d.mode === 'paylink' ? tp('payLink') : tp('invoice')}
          </div>
          <Count>
            {str(d.currency) || 'USD'} {str(d.amount) || '0'}
            {d.title ? ` · ${cut(d.title, 20)}` : ''}
          </Count>
        </div>
      );
    default:
      return null;
  }
}
