'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { FlbBuilderContext } from '@crm/contracts';
import { KnowledgeStep } from '@/features/ai-agents-training/components/knowledge-step';
import { allSteps, type SimpleDoc } from '../lib/simple-model';

/** The AI agents this flow's steps use (an AI step, or an Answer from FAQ step), each once, in the order of the steps. */
export function flowAgentIds(doc: SimpleDoc): string[] {
  const ids: string[] = [];
  for (const s of allSteps(doc)) {
    if (s.type !== 'ai' && s.type !== 'faq') continue;
    const id = typeof s.data.assistant === 'string' ? s.data.assistant.trim() : '';
    if (id !== '' && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * The FAQs tab of a flow: the question-and-answer entries (and the rest of the knowledge) of the AI agent the flow answers with.
 * FAQs are entries in an agent's knowledge base, so this is that agent's knowledge, edited from the flow. A flow that uses several
 * agents picks which one to look at; one that uses none says where to choose one.
 */
export function FaqsPanel({
  agentIds,
  assistants,
  canEdit,
}: {
  agentIds: string[];
  assistants: FlbBuilderContext['assistants'];
  canEdit: boolean;
}) {
  const t = useTranslations('flb.builder.faqsPanel');
  const [picked, setPicked] = useState<string | null>(null);
  const current = picked !== null && agentIds.includes(picked) ? picked : (agentIds[0] ?? null);
  const nameOf = (id: string) => assistants.find((a) => a.id === id)?.name ?? t('unknownAgent');

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6">
      <p className="text-[12.5px] text-muted-foreground">{t('intro')}</p>
      {current === null ? (
        <p
          role="note"
          className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
        >
          {t('noAgent')}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {agentIds.length > 1 ? (
              <label className="flex items-center gap-2 text-[12.5px] font-medium">
                {t('agent')}
                <select
                  value={current}
                  onChange={(e) => setPicked(e.target.value)}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-[12.5px]"
                >
                  {agentIds.map((id) => (
                    <option key={id} value={id}>
                      {nameOf(id)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="text-[13px] font-semibold">{nameOf(current)}</span>
            )}
            <Link
              href={`/ai-training/${current}/edit`}
              className="text-[12.5px] text-brand underline"
            >
              {t('openAgent')}
            </Link>
          </div>
          <KnowledgeStep key={current} assistantId={current} canEdit={canEdit} compact />
        </>
      )}
    </div>
  );
}
