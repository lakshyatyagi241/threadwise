'use client';

import { Alert, Button, ConfirmDialog, useToast } from '@crm/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { WSP_INVITE_TTL_DAYS, type WspMember } from '@crm/contracts';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { useMembers, useMembersSummary, useRefreshWorkspace } from '../api/hooks';
import { wspApi } from '../api/service';
import { primaryRole, seatsLine, tierQuery, type FilterTier } from '../lib/roles';
import { InviteDialog } from './invite-dialog';
import { PlusIcon, SearchIcon } from './icons';
import { LinkBanner, WspProviders, useDebounced, useErrorText } from './parts';
import { MembersTable } from './members-table';
import { RoleFilter } from './role-filter';

interface HandOver {
  key: string;
  title: string;
  body: string;
  link: string;
  email: string;
}

/** `/team-members`: Team Inbox > Members (WD-WSP-015..019). Search is server-side, debounced like WaDesk's 150 ms. */
export function MembersScreen() {
  return (
    <WspProviders>
      <Members />
    </WspProviders>
  );
}

function Members() {
  const t = useTranslations('workspaces-teams-tenancy.members');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  const { toast } = useToast();
  const errorText = useErrorText();
  const session = useSession();
  const refresh = useRefreshWorkspace();

  const [search, setSearch] = useState('');
  const [tier, setTier] = useState<FilterTier>('all');
  const q = useDebounced(search.trim(), 150);

  const summaryQ = useMembersSummary();
  const membersQ = useMembers(q, tierQuery(tier));
  const summary = summaryQ.data;
  const me = summary?.me;

  // Search and the role filter are answered by the server, and a new query has no data yet. The rows already on screen
  // stay (dimmed) until the answer arrives instead of flashing placeholder rows on every keystroke.
  const items = useMemo(() => membersQ.data?.pages.flatMap((p) => p.data) ?? [], [membersQ.data]);
  const [previous, setPrevious] = useState<{ data: unknown; items: WspMember[] }>({
    data: undefined,
    items: [],
  });
  if (membersQ.data && previous.data !== membersQ.data) setPrevious({ data: membersQ.data, items });
  const refreshing = membersQ.isPending && previous.items.length > 0;
  const shown = refreshing ? previous.items : items;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'reset'; member: WspMember } | null>(
    null,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [handOvers, setHandOvers] = useState<HandOver[]>([]);

  const dropHandOver = (key: string) => setHandOvers((cur) => cur.filter((h) => h.key !== key));

  async function changeRole(member: WspMember, roleId: string) {
    if (roleId === primaryRole(member)?.id) return;
    setBusyId(member.id);
    try {
      await wspApi.changeRole(member.id, { roleId, rowVersion: member.rowVersion });
      toast(t('roleUpdated'));
    } catch (err) {
      toast(t('roleFailed', { reason: errorText(err) }), 'danger');
    } finally {
      setBusyId(null);
      // Success or not, the list is the truth: a failed change puts the select back.
      await refresh();
    }
  }

  async function remove(member: WspMember) {
    setWorking(true);
    try {
      await wspApi.removeMember(member.id);
      toast(t('removed'));
      setConfirm(null);
      await refresh();
    } catch (err) {
      toast(t('removeFailed', { reason: errorText(err) }), 'danger');
      setConfirm(null);
    } finally {
      setWorking(false);
    }
  }

  async function handOver(member: WspMember, kind: 'reset' | 'resend') {
    const call = kind === 'reset' ? wspApi.resetPassword : wspApi.resendInvite;
    setBusyId(member.id);
    setWorking(true);
    try {
      const res = await call(member.id);
      if (res.emailSent || !res.inviteLink) {
        toast(t(kind === 'reset' ? 'resetEmailed' : 'resendEmailed', { email: member.email }));
      } else {
        const h: HandOver = {
          key: `${kind}:${member.id}`,
          title: t('linkTitle', { name: member.fullName }),
          body: kind === 'reset' ? t('linkReset') : t('linkInvite', { days: WSP_INVITE_TTL_DAYS }),
          link: res.inviteLink,
          email: member.email,
        };
        setHandOvers((cur) => [h, ...cur.filter((x) => x.key !== h.key)]);
        toast(
          t(kind === 'reset' ? 'resetEmailed' : 'resendEmailed', { email: member.email }),
          'info',
        );
      }
      setConfirm(null);
      await refresh();
    } catch (err) {
      toast(
        t(kind === 'reset' ? 'resetFailed' : 'resendFailed', { reason: errorText(err) }),
        'danger',
      );
      setConfirm(null);
    } finally {
      setBusyId(null);
      setWorking(false);
    }
  }

  const failed = summaryQ.isError ? summaryQ.error : membersQ.isError ? membersQ.error : null;
  const loading = summaryQ.isPending || (membersQ.isPending && !refreshing);
  const seats = seatsLine(summary?.seats);
  const count = q ? shown.length : (summary?.counts[tier] ?? shown.length);
  const countMore = q !== '' && !refreshing && membersQ.hasNextPage;
  const canInvite = me?.canInvite ?? false;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('eyebrow')}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {t('subtitle', { workspace: session.org.name })}
          </p>
        </div>
        {canInvite && (
          <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
            <Button onClick={() => setInviteOpen(true)} data-testid="invite-button">
              <PlusIcon /> {t('invite')}
            </Button>
            {seats && (
              <span
                data-testid="seats"
                className={
                  seats.full ? 'text-xs font-medium text-warning' : 'text-xs text-muted-foreground'
                }
              >
                {t(seats.full ? 'seatsFull' : 'seats', { used: seats.used, limit: seats.limit })}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <RoleFilter summary={summary} value={tier} onChange={setTier} />

        <div className="min-w-0 space-y-4">
          {handOvers.map((h) => (
            <LinkBanner
              key={h.key}
              title={h.title}
              body={h.body}
              link={h.link}
              email={h.email}
              onDismiss={() => dropHandOver(h.key)}
            />
          ))}

          <div className="overflow-hidden rounded-md border border-border bg-background">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
              <div
                data-testid="member-count"
                className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
              >
                {loading
                  ? t('loading')
                  : countMore
                    ? t('countMore', { count })
                    : t('count', { count })}
              </div>
              <div className="relative ms-auto">
                <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('search')}
                  aria-label={t('searchLabel')}
                  data-testid="member-search"
                  className="h-8 w-72 max-w-full rounded-full border border-border bg-muted/50 pe-3 ps-9 text-xs outline-none focus:border-primary focus:bg-background focus-visible:ring-2 focus-visible:ring-primary"
                />
              </div>
            </div>

            {failed !== null ? (
              <div className="p-4">
                <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-3">
                  <span>{errorText(failed)}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void summaryQ.refetch();
                      void membersQ.refetch();
                    }}
                  >
                    {tc('retry')}
                  </Button>
                </Alert>
              </div>
            ) : (
              <MembersTable
                members={shown}
                refreshing={refreshing}
                summary={summary}
                loading={loading}
                filtered={q !== '' || tier !== 'all'}
                canInvite={canInvite}
                hasMore={Boolean(membersQ.hasNextPage)}
                loadingMore={membersQ.isFetchingNextPage}
                onLoadMore={() => void membersQ.fetchNextPage()}
                onInvite={() => setInviteOpen(true)}
                actions={{
                  busyId,
                  onRole: (m, roleId) => void changeRole(m, roleId),
                  onReset: (m) => setConfirm({ kind: 'reset', member: m }),
                  onResend: (m) => void handOver(m, 'resend'),
                  onRemove: (m) => setConfirm({ kind: 'remove', member: m }),
                }}
              />
            )}
          </div>
        </div>
      </div>

      {summary && (
        <InviteDialog
          open={inviteOpen}
          roles={summary.roles}
          onClose={() => setInviteOpen(false)}
          onInvited={() => void refresh()}
        />
      )}

      <ConfirmDialog
        open={confirm?.kind === 'remove'}
        title={t('removeTitle')}
        message={t('removeMessage', { name: confirm?.member.fullName ?? '' })}
        confirmLabel={t('removeConfirm')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={working}
        onConfirm={() => confirm && void remove(confirm.member)}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === 'reset'}
        title={t('resetTitle')}
        message={t('resetMessage', { name: confirm?.member.fullName ?? '' })}
        confirmLabel={t('resetConfirm')}
        cancelLabel={tc('cancel')}
        busy={working}
        onConfirm={() => confirm && void handOver(confirm.member, 'reset')}
        onClose={() => setConfirm(null)}
      />
    </section>
  );
}
