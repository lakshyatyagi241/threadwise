'use client';

import { useCallback, useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ERROR_CODES,
  type AddonCard,
  type AddonImpact,
  type AddonImpactItem,
} from '@crm/contracts';
import { Alert, Button, Input, Modal, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { KEYS, disableAddon, fetchAddonImpact } from '../api';
import { ErrorBlock } from './ui';

const NS = 'addons-extension-registry.toggle';

/**
 * The impact lines in three groups, by what they mean for the person: what stops working, what is kept, and who is affected. A code the
 * server adds later and this build does not know is left out rather than drawn as a raw key.
 */
const GROUPS = [
  {
    id: 'stops',
    codes: ['features_off', 'dependents_off', 'waiting_chats', 'routing_rules', 'auto_teams'],
  },
  { id: 'kept', codes: ['kept', 'roles_dormant', 'teams'] },
  { id: 'people', codes: ['custom_role_holders'] },
] as const satisfies ReadonlyArray<{ id: string; codes: ReadonlyArray<AddonImpactItem['code']> }>;

export type ActivationErrorKey = 'notToggleable' | 'forbidden' | 'generic';

/** Which sentence a failed turn-off or turn-on gets. Branches on the stable `code` and status, never on the API's wording. */
export function activationErrorKey(error: unknown): ActivationErrorKey {
  if (!(error instanceof ApiError)) return 'generic';
  if (error.code === ERROR_CODES.PAYGW_ADDON_NOT_TOGGLEABLE) return 'notToggleable';
  if (error.status === 403) return 'forbidden';
  return 'generic';
}

/**
 * What must happen after an add-on is switched: the add-ons list is read again, and the page's server part is refreshed, because the
 * workspace layout reads the entitlements on the server (the menu entries and the locks follow the switch only after that).
 */
export function useAfterActivationChange(): () => Promise<void> {
  const qc = useQueryClient();
  const router = useRouter();
  return useCallback(async () => {
    await qc.invalidateQueries({ queryKey: KEYS.workspace });
    router.refresh();
  }, [qc, router]);
}

/** Impact items worth a line: a count that is zero or an empty name list says nothing. */
function visible(item: AddonImpactItem): boolean {
  if (item.code === 'features_off' || item.code === 'dependents_off') return item.names.length > 0;
  if (item.code === 'kept') return true;
  return item.count > 0;
}

/**
 * The preview before an included add-on is turned off (docs/specs/addons-lifecycle-and-permissions.md, section 4): what stops, what is
 * kept and who is affected, from `GET /addons/:id/impact`. When the server flags a risk (`requiresConfirm`) the button stays off until
 * the person types the add-on's name; otherwise one click turns it off. Closes itself on success after reading the list again and
 * refreshing the page; a failure stays inside the dialog, with the way to try again.
 */
export function AddonToggleDialog({
  card,
  open,
  onClose,
  onDone,
}: {
  card: Pick<AddonCard, 'id' | 'name'>;
  open: boolean;
  onClose: () => void;
  /** Called with the sentence to tell the person once the add-on is off. */
  onDone: (message: string) => void;
}) {
  const t = useTranslations(NS);
  const tc = useTranslations('addons-extension-registry.common');
  const ta = useTranslations('addons-extension-registry.list.activation');
  const after = useAfterActivationChange();
  const formId = useId();
  const confirmId = useId();
  const [typed, setTyped] = useState('');

  const impact = useQuery({
    queryKey: KEYS.impact(card.id, 'disable'),
    queryFn: ({ signal }) => fetchAddonImpact(card.id, 'disable', signal),
    enabled: open,
    // A preview is only true at the moment it is read: never show an old one.
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
  });

  const disable = useMutation({
    mutationFn: () => disableAddon(card.id),
    onSuccess: async () => {
      await after();
      onDone(t('done', { name: card.name }));
      close();
    },
  });

  // Every way out (Cancel, Escape, the backdrop, success) leaves a fresh dialog for next time: nothing typed, no old error.
  const { reset } = disable;
  function close() {
    setTyped('');
    reset();
    onClose();
  }

  const needsTyped = impact.data?.requiresConfirm === true;
  const typedOk =
    !needsTyped || typed.trim().toLocaleLowerCase() === card.name.trim().toLocaleLowerCase();
  const canConfirm = impact.data !== undefined && typedOk && !disable.isPending;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!disable.isPending) close();
      }}
      title={t('title', { name: card.name })}
      size="md"
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={disable.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="danger"
            disabled={!canConfirm}
            data-testid="addon-toggle-confirm"
          >
            {disable.isPending && <Spinner />}
            {t('confirm', { name: card.name })}
          </Button>
        </>
      }
    >
      {open && (
        <form
          id={formId}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canConfirm) disable.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">{t('lead')}</p>

          {impact.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner label={tc('loading')} />
              <span>{tc('loading')}</span>
            </div>
          )}
          {impact.isError && (
            <ErrorBlock error={impact.error} onRetry={() => void impact.refetch()} />
          )}
          {impact.data && <ImpactGroups impact={impact.data} />}

          {needsTyped && (
            <div className="space-y-1.5 text-sm" data-testid="addon-toggle-typed">
              <label htmlFor={confirmId} className="block font-medium">
                {t('typeLabel', { name: card.name })}
              </label>
              <Input
                id={confirmId}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={disable.isPending}
              />
              <p className="text-xs text-muted-foreground">{t('typeHint')}</p>
            </div>
          )}

          {disable.isError && (
            <Alert tone="danger" data-testid="addon-toggle-error">
              {ta(`errors.${activationErrorKey(disable.error)}`, { name: card.name })}
            </Alert>
          )}
        </form>
      )}
    </Modal>
  );
}

function ImpactGroups({ impact }: { impact: AddonImpact }) {
  const t = useTranslations(NS);
  const fmt = useFormatter();
  const headingId = useId();
  return (
    <div className="space-y-4" data-testid="addon-toggle-impact">
      {GROUPS.map((group) => {
        const items = impact.items.filter(
          (i) => (group.codes as readonly string[]).includes(i.code) && visible(i),
        );
        if (items.length === 0) return null;
        const id = `${headingId}-${group.id}`;
        return (
          <section key={group.id} aria-labelledby={id} data-testid={`addon-toggle-${group.id}`}>
            <h3 id={id} className="text-sm font-semibold">
              {t(`groups.${group.id}`)}
            </h3>
            <ul className="mt-1 list-disc space-y-1 ps-5 text-sm">
              {items.map((item) => (
                <li
                  key={item.code}
                  data-testid={`addon-toggle-item-${item.code}`}
                  data-risk={item.risk ? 'true' : undefined}
                  className={item.risk ? 'font-medium' : undefined}
                >
                  {t(`items.${item.code}`, {
                    count: item.count,
                    names: fmt.list(item.names, { type: 'conjunction' }),
                    name: impact.addon.name,
                  })}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
