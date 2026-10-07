'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SegmentGroup } from '@crm/contracts';
import { Button, Drawer } from '@crm/ui';
import { useWizardContacts } from '../api/wizard';
import { conditionTotal } from '../lib/audience';
import { AudienceConditions } from './audience-conditions';
import { useSettled } from './use-settled';

/**
 * The filter drawer of the contacts table: the segments' own condition builder in a panel from the end edge. Edits stay in the
 * drawer until Apply; Apply sends them to the table (which asks the server again), Clear removes them all. The live line counts the
 * contacts the edited conditions (and the table's search) match, by the same server query the table uses.
 */
export function FilterDrawer({
  open,
  rules,
  search,
  onApply,
  onClose,
}: {
  open: boolean;
  /** The conditions applied to the table now. */
  rules: SegmentGroup | null;
  search: string;
  onApply: (rules: SegmentGroup | null) => void;
  onClose: () => void;
}) {
  const t = useTranslations('campaigns.wizard.audience');
  const [pending, setPending] = useState<SegmentGroup | null>(rules);
  // Bumped by Clear so the builder starts from an empty tree again.
  const [epoch, setEpoch] = useState(0);
  const settled = useSettled(pending, 400);
  const live = useWizardContacts({ search, rules: settled.value, page: 1, perPage: 1 });
  // Closing without Apply drops the edits: the drawer always opens on what the table is filtered by.
  const close = () => {
    setPending(rules);
    onClose();
  };
  const changed = JSON.stringify(pending) !== JSON.stringify(rules);

  const apply = () => {
    onApply(pending);
    onClose();
  };
  const clear = () => {
    setPending(null);
    setEpoch((e) => e + 1);
    onApply(null);
  };

  return (
    <Drawer
      open={open}
      onClose={close}
      title={t('filterTitle')}
      closeLabel={t('filterClose')}
      footer={
        <>
          <Button variant="ghost" onClick={clear} disabled={pending === null && rules === null}>
            {t('filterClear')}
          </Button>
          <Button variant="brand" onClick={apply} disabled={!changed}>
            {t('filterApply')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('filterHint')}</p>
        <p
          aria-live="polite"
          className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
          data-testid="filter-live"
        >
          {live.isPending || !settled.settled || live.isFetching
            ? t('filterCounting')
            : live.data
              ? t('filterMatches', { count: live.data.total })
              : t('filterCountFailed')}
        </p>
        <AudienceConditions
          key={epoch}
          rules={pending}
          invalid={[]}
          showProblems={false}
          onRules={setPending}
        />
      </div>
    </Drawer>
  );
}

/** How many conditions the filter button's badge shows. */
export const activeFilters = (rules: SegmentGroup | null): number => conditionTotal(rules);
