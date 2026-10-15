'use client';

import type { WizardDraft } from '@crm/contracts';
import type { WizardAction } from '../lib/state';
import type { StepIssue } from '../lib/issues';
import { useBuilder } from '../../api/campaigns';
import { FollowUpsCard } from './follow-ups-card';
import { RetriesCard } from './retries-card';
import { ScheduleCard } from './schedule-card';
import type { TemplatesQuery } from './template-picker';
import { TestSendCard } from './test-send-card';

/** Step 4: a test message, when to send (now, once later, or on a rule), the retry setting and the follow-up steps; the footer's last button launches. */
export function StepSend({
  draft,
  draftId,
  zone,
  canTest,
  templates,
  issues,
  disabled,
  currency,
  ensureSaved,
  dispatch,
}: {
  draft: WizardDraft;
  draftId: string | null;
  zone: string;
  canTest: boolean;
  /** The approved templates (the follow-up steps pick from them). */
  templates: TemplatesQuery;
  issues: StepIssue[];
  disabled?: boolean;
  currency: string | null;
  ensureSaved: () => Promise<boolean>;
  dispatch: (a: WizardAction) => void;
}) {
  // The published flows a follow-up can start: the same list the campaign builder offers.
  const builder = useBuilder();
  return (
    <div className="space-y-5">
      <TestSendCard
        draftId={draftId}
        canTest={canTest}
        ensureSaved={ensureSaved}
        currency={currency}
      />
      <ScheduleCard
        schedule={draft.schedule}
        zone={zone}
        issues={issues}
        disabled={disabled}
        onSchedule={(schedule) => dispatch({ type: 'schedule', schedule })}
      />
      <RetriesCard
        retries={draft.retries}
        issues={issues}
        disabled={disabled}
        onRetries={(retries) => dispatch({ type: 'retries', retries })}
      />
      <FollowUpsCard
        followUps={draft.followUps}
        senderKey={draft.senderKey}
        templates={templates}
        flows={{
          data: builder.data?.flows,
          isPending: builder.isPending,
          isError: builder.isError,
        }}
        issues={issues}
        disabled={disabled}
        onFollowUps={(followUps) => dispatch({ type: 'followUps', followUps })}
      />
    </div>
  );
}
