'use client';

import { useTranslations } from 'next-intl';
import { Button, Spinner } from '@crm/ui';
import { WIZARD_STEP_COUNT } from '@crm/contracts';
import type { LaunchKind } from '../lib/schedule';

/**
 * The sticky bar: Back and one primary action. `blocked` is why the primary action does not work yet, said next to it; the button
 * stays focusable (aria-disabled) so a keyboard user hears the reason instead of finding a dead control.
 */
export function WizardFooter({
  step,
  launch,
  busy,
  blocked,
  canLaunch,
  onBack,
  onNext,
  inline,
  steps,
}: {
  step: number;
  launch: LaunchKind;
  busy: boolean;
  /** Translated reasons Next is blocked. */
  blocked: string[];
  /** The last step's button may be missing a permission. */
  canLaunch: boolean;
  onBack: () => void;
  onNext: () => void;
  /** Without the sticky bar around it: the buttons and the reason sit in a header (the campaign builder's top right). */
  inline?: boolean;
  /** How many steps the screen has (the wizard's four by default; the campaign builder has five). */
  steps?: number;
}) {
  const t = useTranslations('campaigns.wizard.footer');
  const last = step === (steps ?? WIZARD_STEP_COUNT);
  const label = last ? t(`launch.${launch}`) : t('next');
  const stopped = blocked.length > 0 || (last && !canLaunch);
  const back = (
    <Button variant="secondary" onClick={onBack} disabled={step === 1 || busy}>
      {t('back')}
    </Button>
  );
  const reasons = (
    <>
      {blocked.length > 0 && (
        <p id="wizard-blocked" role="status" className="min-w-0 text-sm text-danger">
          {blocked[0]}
          {blocked.length > 1 && ` ${t('moreIssues', { count: blocked.length - 1 })}`}
        </p>
      )}
      {last && !canLaunch && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('noLaunchPermission')}
        </p>
      )}
    </>
  );
  const primary = (
    <Button
      variant={last ? 'brand' : 'primary'}
      aria-disabled={stopped || undefined}
      aria-describedby={blocked.length > 0 ? 'wizard-blocked' : undefined}
      disabled={busy}
      onClick={() => {
        if (!(last && !canLaunch)) onNext();
      }}
      className={stopped ? 'opacity-60' : undefined}
    >
      {busy && <Spinner />}
      {label}
    </Button>
  );
  // In a header: the reason first, then Back and the primary action, at the right end.
  if (inline)
    return (
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {reasons}
        {back}
        {primary}
      </div>
    );
  return (
    <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        {back}
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3">
          {reasons}
          {primary}
        </div>
      </div>
    </div>
  );
}
