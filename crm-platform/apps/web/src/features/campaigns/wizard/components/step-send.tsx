'use client';

import type { WizardDraft } from '@crm/contracts';
import type { WizardAction } from '../lib/state';
import type { StepIssue } from '../lib/issues';
import { RetriesCard } from './retries-card';
import { ScheduleCard } from './schedule-card';
import { TestSendCard } from './test-send-card';

/** Step 4: a test message, when to send (now, once later, or on a rule) and the retry setting; the footer's last button launches. */
export function StepSend({
  draft,
  draftId,
  zone,
  canTest,
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
  issues: StepIssue[];
  disabled?: boolean;
  currency: string | null;
  ensureSaved: () => Promise<boolean>;
  dispatch: (a: WizardAction) => void;
}) {
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
    </div>
  );
}
