'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SenderHidden, WizardSender } from '@crm/contracts';
import { EmptyState } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { offerSendersFor } from '@/lib/unofficial-whatsapp';
import { useUnofficialWhatsappState } from '@/lib/use-unofficial-whatsapp';
import { createPath, flowFor } from '../lib/create-flow';
import { withClientHidden } from '../lib/sender-empty';
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
  const unofficialState = useUnofficialWhatsappState();
  const query = useWizardSenders();
  const offered = useMemo(
    () => offerSendersFor(query.data?.data, unofficialState),
    [query.data, unofficialState],
  );
  const senders = useMemo(() => offered ?? [], [offered]);
  const hidden = useMemo(
    () => withClientHidden(query.data?.data, offered, query.data?.hidden),
    [query.data, offered],
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
  // The number decides which sections the builder shows, so the screen waits for the numbers and for the answer on the platform switch
  // (a list that is empty only because that answer has not come yet would open the classic builder on no number at all).
  if (query.isPending || unofficialState === 'pending') {
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
    return <Resume draftId={state.draft} senders={senders} hidden={hidden} onClassic={open} />;
  }
  if (flowFor(senders, key) === 'wizard') {
    return (
      <GuidedCampaign
        key={`guided-${key}`}
        initial={null}
        senders={senders}
        hidden={hidden}
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
  hidden,
  onClassic,
}: {
  draftId: string;
  senders: readonly WizardSender[];
  hidden: readonly SenderHidden[];
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
      hidden={hidden}
      onClassic={onClassic}
    />
  );
}
