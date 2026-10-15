'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import type {
  WaDeviceGroup,
  WaDeviceGroupMember,
  WaGroupParticipantAction,
  WaGroupParticipantResults,
} from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Field,
  Input,
  Modal,
  Spinner,
  Textarea,
} from '@crm/ui';
import { useWaGroupMembers, useWaGroupParticipants } from '../api/groups-hooks';
import { useErrorText } from '../components/use-error-text';
import { useGroupsCtx } from './groups-context';
import {
  NUMBERS_PER_CALL,
  numbersOk,
  parseNumbers,
  personLabel,
  rowAccess,
  summarizeResults,
  toggleSelected,
} from './groups-model';
import { OutcomeList } from './outcome-list';

/**
 * The members of a group: who is in, who is admin, add people by number, promote and demote, and remove several at once (at most 20
 * a call, WhatsApp's ban-safety). Numbers are personal data: read when the window opens and kept nowhere. A member WhatsApp shows only
 * by an anonymous id has no number, so it can be read but not changed from here. Every call answers person by person; a refusal for
 * one person (privacy settings, not on WhatsApp, already in) does not hide the others.
 */
export function MembersModal({
  group,
  open,
  onClose,
}: {
  group: WaDeviceGroup;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('whatsapp-devices-baileys.groups.members');
  const tc = useTranslations('whatsapp-devices-baileys.groups');
  const errorText = useErrorText();
  const { device, online, perms, waitSeconds, fail, notify } = useGroupsCtx();
  const access = rowAccess(group, perms, online);
  const writable = access.canAdminister && waitSeconds === 0;
  const act = useWaGroupParticipants(device.id);
  const id = useId();

  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(h);
  }, [q]);
  const members = useWaGroupMembers(device.id, group.id, debounced, open && access.canSeeMembers);
  const list: WaDeviceGroupMember[] = members.data?.pages.flatMap((p) => p.members) ?? [];
  const total = members.data?.pages[0]?.total ?? group.size;

  const [selected, setSelected] = useState<string[]>([]);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [addText, setAddText] = useState('');
  const [last, setLast] = useState<{
    action: WaGroupParticipantAction;
    results: WaGroupParticipantResults;
  } | null>(null);

  const parsed = parseNumbers(addText, device.phone);

  const run = (action: WaGroupParticipantAction, numbers: string[], after?: () => void) =>
    act.mutate(
      { group: group.id, action, numbers },
      {
        onSuccess: (results) => {
          setLast({ action, results });
          after?.();
          void members.refetch();
          if (results.okCount > 0 && results.failCount === 0) {
            notify({ tone: 'success', text: t(`done.${action}`, { count: results.okCount }) });
          }
        },
        onError: (err) => {
          setConfirmRemove(false);
          fail(err);
        },
      },
    );

  const sum = last ? summarizeResults(last.results.results) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('title', { name: group.subject ?? tc('untitled') })}
      closeLabel={tc('close')}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {tc('close')}
        </Button>
      }
    >
      {access.blockedBy && (
        <Alert tone="info" className="mb-3" data-testid="groups-members-readonly">
          {t(`readOnly.${access.blockedBy}`)}
        </Alert>
      )}
      {waitSeconds > 0 && (
        <Alert tone="warning" className="mb-3">
          {t('held')}
        </Alert>
      )}

      {writable && (
        <section className="mb-4 rounded-md border border-border p-3" data-testid="groups-add">
          <Field
            label={t('add.label')}
            htmlFor={`${id}-add`}
            hint={t('add.hint', { max: NUMBERS_PER_CALL })}
          >
            <Textarea
              id={`${id}-add`}
              rows={2}
              dir="ltr"
              value={addText}
              placeholder={t('add.placeholder')}
              onChange={(e) => setAddText(e.target.value)}
            />
          </Field>
          <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
            {t('add.counted', { count: parsed.valid.length, max: NUMBERS_PER_CALL })}
            {parsed.invalid.length > 0 && (
              <span className="text-danger" data-testid="groups-add-invalid">
                {' · '}
                {t('add.invalid', { numbers: parsed.invalid.join(', ') })}
              </span>
            )}
            {parsed.overCap && (
              <span className="text-danger">
                {' · '}
                {t('add.overCap', { max: NUMBERS_PER_CALL })}
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-warning">{t('add.risk')}</p>
          <div className="mt-2">
            <Button
              size="sm"
              disabled={!numbersOk(parsed) || act.isPending}
              onClick={() => run('add', parsed.valid, () => setAddText(''))}
            >
              {act.isPending && act.variables?.action === 'add' ? t('add.adding') : t('add.submit')}
            </Button>
          </div>
        </section>
      )}

      {last && sum && (
        <section
          className="mb-4 rounded-md border border-border bg-muted/40 p-3"
          data-testid="groups-last-result"
        >
          <p className="text-sm font-medium">
            {t('result', { ok: sum.ok, failed: sum.failed.length })}
          </p>
          <div className="mt-2">
            <OutcomeList results={sum.failed} />
          </div>
        </section>
      )}

      <div className="flex items-center justify-between gap-2">
        <Field label={t('search')} htmlFor={`${id}-q`} className="min-w-0 flex-1">
          <Input
            id={`${id}-q`}
            type="search"
            value={q}
            placeholder={t('searchPlaceholder')}
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
        <p className="shrink-0 pt-5 text-xs text-muted-foreground">
          {t('total', { count: total })}
        </p>
      </div>

      <div className="mt-3">
        {!access.canSeeMembers ? (
          <p className="text-sm text-muted-foreground">{t('noAccess')}</p>
        ) : members.isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> {t('loading')}
          </div>
        ) : members.isError ? (
          <Alert tone="danger">{errorText(members.error).text}</Alert>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{debounced ? t('noMatch') : t('empty')}</p>
        ) : (
          <>
            <ul
              className="max-h-80 divide-y divide-border overflow-y-auto"
              data-testid="groups-member-list"
            >
              {list.map((m) => {
                const label = personLabel(m);
                const changeable = writable && !m.self && m.phone !== null;
                return (
                  <li key={m.jid} className="flex flex-wrap items-center gap-2 py-2">
                    {changeable ? (
                      <Checkbox
                        id={`${id}-m-${m.jid}`}
                        checked={selected.includes(m.phone!)}
                        disabled={
                          selected.length >= NUMBERS_PER_CALL && !selected.includes(m.phone!)
                        }
                        onChange={() => setSelected((s) => toggleSelected(s, m.phone!))}
                        label={<span className="sr-only">{label ?? t('member')}</span>}
                      />
                    ) : (
                      <span className="w-5" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" dir="auto">
                        {m.name?.trim() || m.phone || t('member')}
                      </span>
                      {m.name && m.phone && (
                        <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                          {m.phone}
                        </span>
                      )}
                      {!m.phone && (
                        <span className="block text-xs text-muted-foreground">{t('noNumber')}</span>
                      )}
                    </span>
                    {m.self && <Badge tone="neutral">{t('you')}</Badge>}
                    {m.admin && (
                      <Badge tone="success">
                        {m.admin === 'superadmin' ? t('owner') : t('admin')}
                      </Badge>
                    )}
                    {changeable && m.phone && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={act.isPending}
                        onClick={() => run(m.admin ? 'demote' : 'promote', [m.phone!])}
                      >
                        {m.admin ? t('demote') : t('promote')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            {members.hasNextPage && (
              <div className="mt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={members.isFetchingNextPage}
                  onClick={() => void members.fetchNextPage()}
                >
                  {members.isFetchingNextPage ? tc('loadingMore') : tc('loadMore')}
                </Button>
              </div>
            )}
            {writable && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={selected.length === 0 || act.isPending}
                  onClick={() => setConfirmRemove(true)}
                >
                  {t('remove')}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {t('selected', { count: selected.length })}
                  {selected.length >= NUMBERS_PER_CALL &&
                    ` · ${t('limit', { max: NUMBERS_PER_CALL })}`}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title={t('remove')}
        message={t('removeConfirm', { count: selected.length })}
        confirmLabel={t('remove')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={act.isPending}
        onConfirm={() =>
          run('remove', selected, () => {
            setConfirmRemove(false);
            setSelected([]);
          })
        }
        onClose={() => setConfirmRemove(false)}
      />
    </Modal>
  );
}
