'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WizardSender } from '@crm/contracts';
import { EmptyState } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { offerSenders } from '@/lib/unofficial-whatsapp';
import { useUnofficialWhatsapp } from '@/lib/use-unofficial-whatsapp';
import { createPath, flowFor } from '../lib/create-flow';
import { engineOf } from '../lib/engine-gate';
import { useWizardDraft, useWizardSenders } from '../wizard/api/wizard';
import { ErrorBlock, Skeleton } from '../wizard/components/parts';
import { LaunchedNotice } from '../wizard/components/wizard-screen';
import { BuilderScreen } from './builder-screen';
import { GuidedCampaign } from './guided-campaign';

const Frame = ({ children }: { children: React.ReactNode }) => (
  <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">{children}</main>
);

/**
 * `/campaigns/create`: the one screen for a new campaign, always the campaign builder's page. It opens on the workspace's default
 * number (or `?sender=`), and the sender select in Setup is the switch. A verified Meta (WhatsApp Cloud API) number fills the sections
 * with the broadcast logic (template dropdown, the four recipient modes, schedule and retries, credit check, test send); any other
 * number, and a Meta number that is not verified, keeps the classic sections. `?draft=` resumes a guided draft.
 */
export function CreateScreen({
  sender,
  draft,
}: {
  /** The `?sender=` of the address (a well-formed key, or empty). */
  sender: string;
  /** The `?draft=` of the address (an id, or empty): a guided draft to resume. */
  draft: string;
}) {
  const t = useTranslations('campaigns.create');
  const canCreate = useCan('camp.campaigns.create');
  const unofficial = useUnofficialWhatsapp();
  const query = useWizardSenders();
  const senders = useMemo(
    () => offerSenders(query.data?.data ?? [], unofficial),
    [query.data, unofficial],
  );
  const [state, setState] = useState<{ key: string | null; draft: string; name: string }>({
    key: sender || null,
    draft,
    name: '',
  });

  if (!canCreate) {
    return (
      <Frame>
        <EmptyState title={t('noAccessTitle')} message={t('noAccess')} />
      </Frame>
    );
  }
  // The number decides which sections the builder shows, so the screen waits for the numbers.
  if (query.isPending) {
    return (
      <Frame>
        <Skeleton label={t('loading')} lines={4} />
      </Frame>
    );
  }

  const open = (key: string, name: string) => {
    setState({ key, draft: '', name });
    if (typeof window !== 'undefined')
      window.history.replaceState(window.history.state, '', createPath({ sender: key }));
  };
  const guidedKeys = new Set(senders.filter((s) => s.guided).map((s) => s.key));
  const initial =
    senders.find((s) => s.isDefault && s.guided) ?? senders.find((s) => s.isDefault) ?? senders[0];
  // An SMS number is not in the WhatsApp number list (it has its own card, TW-SMS-018): its key comes from the address.
  const key =
    state.key && (engineOf(state.key) === 'sms' || senders.some((s) => s.key === state.key))
      ? state.key
      : (initial?.key ?? '');

  if (state.draft) {
    return <Resume draftId={state.draft} senders={senders} onClassic={open} />;
  }
  if (flowFor(senders, key) === 'wizard') {
    return (
      <GuidedCampaign
        key={`guided-${key}`}
        initial={null}
        senders={senders}
        preferredSenderKey={key}
        initialName={state.name}
        onClassic={open}
      />
    );
  }
  return (
    <BuilderScreen
      key={`classic-${key}`}
      initialSenderKey={key}
      initialName={state.name}
      guidedKeys={guidedKeys}
      onGuided={open}
    />
  );
}

/** A guided draft opened from the Campaigns list, the contacts screen or an old address. */
function Resume({
  draftId,
  senders,
  onClassic,
}: {
  draftId: string;
  senders: readonly WizardSender[];
  onClassic: (key: string, name: string) => void;
}) {
  const tw = useTranslations('campaigns.wizard');
  const draft = useWizardDraft(draftId);
  if (draft.isPending)
    return (
      <Frame>
        <Skeleton label={tw('loading')} lines={6} />
      </Frame>
    );
  if (draft.isError || !draft.data)
    return (
      <Frame>
        <ErrorBlock error={draft.error} onRetry={() => void draft.refetch()} />
      </Frame>
    );
  if (draft.data.status !== 'draft')
    return (
      <Frame>
        <LaunchedNotice id={draft.data.id} />
      </Frame>
    );
  return (
    <GuidedCampaign
      key={draft.data.id}
      initial={draft.data}
      senders={senders}
      onClassic={onClassic}
    />
  );
}
