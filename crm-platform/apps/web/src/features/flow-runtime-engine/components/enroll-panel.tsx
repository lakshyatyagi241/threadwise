'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, Input, Select, Spinner, cn, useToast } from '@crm/ui';
import type { EnrollResult } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, enrollContacts, useContactGroups, useContactSearch } from '../api/flow-runtime';
import { ENROLL_MAX, addToSelection, contactName, failureGroups, toggleId } from '../lib/model';
import { KICKER, TH, useErrorText } from './parts';

type Mode = 'contacts' | 'group';

/**
 * "Enroll contacts" (WaDesk's panel on the flows list): pick contacts or one contact group, send, and read the result. Chosen
 * contacts win over a group on the server, so the panel only ever sends one of them. Up to 500 contacts per request.
 */
export function EnrollPanel({ flowId, onClose }: { flowId: string; onClose: () => void }) {
  const t = useTranslations('flr.enroll');
  const qc = useQueryClient();
  const { toast } = useToast();
  const errText = useErrorText();
  const canContacts = useCan('record.contacts.read');
  const canGroups = useCan('record.contact-groups.read');

  const [mode, setMode] = useState<Mode>(canContacts || !canGroups ? 'contacts' : 'group');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(id);
  }, [q]);

  const contacts = useContactSearch(debounced, mode === 'contacts' && canContacts);
  const groups = useContactGroups(mode === 'group' && canGroups);
  const [ids, setIds] = useState<string[]>([]);
  const [groupId, setGroupId] = useState('');
  const [capped, setCapped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EnrollResult | null>(null);

  const rows = useMemo(
    () =>
      (contacts.data?.data ?? []).map((c) => ({
        id: c.id,
        name: contactName(c) || c.phone || c.id.slice(0, 8),
        phone: c.phone ?? '',
      })),
    [contacts.data],
  );
  const allShown = rows.length > 0 && rows.every((r) => ids.includes(r.id));

  const selectShown = (on: boolean) => {
    if (!on) {
      setIds(ids.filter((id) => !rows.some((r) => r.id === id)));
      return;
    }
    const { ids: next, dropped } = addToSelection(
      ids,
      rows.map((r) => r.id),
    );
    setIds(next);
    setCapped(dropped > 0);
  };

  const ready = mode === 'contacts' ? ids.length > 0 : groupId !== '';

  const submit = async () => {
    if (!ready) {
      toast(t('needChoice'), 'info');
      return;
    }
    setBusy(true);
    try {
      const res = await enrollContacts(
        flowId,
        mode === 'contacts' ? { contactIds: ids } : { groupId },
      );
      setResult(res);
      void qc.invalidateQueries({ queryKey: KEYS.subscribers });
      void qc.invalidateQueries({ queryKey: KEYS.runs });
    } catch (e) {
      // 422 FLR_FLOW_INACTIVE and the other codes have their own sentence; a 400 over the 500 cap carries the server's words.
      toast(errText(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setIds([]);
    setGroupId('');
    setCapped(false);
  };

  return (
    <section
      className="mb-5 rounded-2xl border border-border bg-background p-5 shadow-sm"
      aria-labelledby="enroll-title"
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 id="enroll-title" className="text-xl leading-tight">
            {t('title')}
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t('intro')}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('close')}
        </Button>
      </div>

      {result ? (
        <div>
          <h3 className={KICKER}>{t('resultTitle')}</h3>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
            {(
              [
                ['enrolled', result.enrolled, 'text-success'],
                ['alreadyEnrolled', result.alreadyEnrolled, ''],
                ['failed', result.failed, result.failed > 0 ? 'text-danger' : ''],
              ] as const
            ).map(([k, n, tone]) => (
              <div key={k} className="rounded-lg border border-border p-3">
                <dt className="text-xs text-muted-foreground">{t(k)}</dt>
                <dd className={cn('mt-1 text-2xl font-semibold tabular-nums', tone)}>{n}</dd>
              </div>
            ))}
          </dl>
          {result.failed > 0 && (
            <div className="mt-4">
              <h3 className={KICKER}>{t('failedReasons')}</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {failureGroups(result).map((g) => (
                  <li key={g.reason} className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words">{g.reason || t('noReason')}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t('contactsCount', { count: g.count })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4">
            <Button variant="secondary" onClick={reset}>
              {t('done')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-3 flex gap-2" role="group">
            {(['contacts', 'group'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium',
                  mode === m
                    ? 'bg-brand text-brand-foreground'
                    : 'border border-border hover:bg-muted',
                )}
              >
                {m === 'contacts' ? t('modeContacts') : t('modeGroup')}
              </button>
            ))}
          </div>

          {mode === 'contacts' ? (
            !canContacts ? (
              <p className="rounded-lg border border-border bg-muted px-3 py-3 text-xs text-muted-foreground">
                {t('contactsDenied')}
              </p>
            ) : (
              <div>
                <Input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t('search')}
                  aria-label={t('searchLabel')}
                  className="mb-3 text-[12.5px]"
                />
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span aria-live="polite">
                    {t('selected', { count: ids.length, max: ENROLL_MAX })}
                  </span>
                  {ids.length > 0 && (
                    <button
                      type="button"
                      className="font-semibold text-brand hover:underline"
                      onClick={() => {
                        setIds([]);
                        setCapped(false);
                      }}
                    >
                      {t('clear')}
                    </button>
                  )}
                </div>
                {capped && (
                  <p className="mb-2 text-xs text-warning">
                    {t('capReached', { max: ENROLL_MAX })}
                  </p>
                )}
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="max-h-[300px] overflow-auto">
                    <table className="w-full text-[12.5px]">
                      <thead className="sticky top-0 border-b border-border bg-muted text-muted-foreground">
                        <tr>
                          <th className="w-12 px-4 py-2.5 text-start">
                            <input
                              type="checkbox"
                              aria-label={t('selectShown')}
                              className="size-4 accent-[var(--brand)]"
                              checked={allShown}
                              disabled={rows.length === 0}
                              onChange={(e) => selectShown(e.target.checked)}
                            />
                          </th>
                          <th className={TH}>{t('searchLabel')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {contacts.isPending ? (
                          <tr>
                            <td colSpan={2} className="px-4 py-6 text-center">
                              <Spinner />
                            </td>
                          </tr>
                        ) : contacts.isError ? (
                          <tr>
                            <td colSpan={2} className="px-4 py-6 text-center text-xs text-danger">
                              {errText(contacts.error)}
                            </td>
                          </tr>
                        ) : rows.length === 0 ? (
                          <tr>
                            <td
                              colSpan={2}
                              className="px-4 py-6 text-center text-xs text-muted-foreground"
                            >
                              {debounced ? t('noMatch') : t('noContacts')}
                            </td>
                          </tr>
                        ) : (
                          rows.map((r) => (
                            <tr key={r.id}>
                              <td className="px-4 py-2.5">
                                <input
                                  type="checkbox"
                                  aria-label={r.name}
                                  className="size-4 accent-[var(--brand)]"
                                  checked={ids.includes(r.id)}
                                  onChange={() => {
                                    const next = toggleId(ids, r.id);
                                    setCapped(next === ids && !ids.includes(r.id));
                                    setIds(next);
                                  }}
                                />
                              </td>
                              <td className="px-3 py-2.5">
                                <span className="font-semibold">{r.name}</span>
                                {r.phone && (
                                  <span className="ms-2 font-mono text-[11px] text-muted-foreground">
                                    {r.phone}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          ) : !canGroups ? (
            <p className="rounded-lg border border-border bg-muted px-3 py-3 text-xs text-muted-foreground">
              {t('groupsDenied')}
            </p>
          ) : groups.isPending ? (
            <Spinner />
          ) : groups.isError ? (
            <p className="text-xs text-danger">{errText(groups.error)}</p>
          ) : groups.data.data.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('noGroups')}</p>
          ) : (
            <label className="block max-w-md">
              <span className={KICKER}>{t('groupLabel')}</span>
              <Select className="mt-1" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">{t('groupPlaceholder')}</option>
                {groups.data.data.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({t('groupMembers', { count: g.memberCount })})
                  </option>
                ))}
              </Select>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {t('groupOrContacts')}
              </span>
            </label>
          )}

          <div className="mt-4 flex justify-end">
            <Button variant="brand" disabled={busy || !ready} onClick={() => void submit()}>
              {busy ? t('submitting') : t('submit')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
