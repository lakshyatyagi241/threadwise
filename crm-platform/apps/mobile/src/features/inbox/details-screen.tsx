import {
  canMoveConversationStatus,
  CONVERSATION_PRIORITIES,
  type ConversationPriority,
  type SetConversationStatusInput,
} from '@crm/contracts';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { AssignSheet } from './assign-sheet';
import { ChoiceSheet } from './choice-sheet';
import { NotesSection } from './details-notes';
import { ActionRow, PastList, Section } from './details-parts';
import { TimelineSection } from './details-timeline';
import { LabelsSheet } from './labels-sheet';
import { formatDateTime } from './time';
import {
  isBotConversation,
  SNOOZE_CHOICES,
  STATUS_TARGETS,
  type SnoozeChoice,
} from './thread-actions';
import { useConversationActions } from './use-conversation-actions';
import { useConversationDetail } from './use-inbox';
import { useNow } from './use-now';

type Sheet = 'status' | 'priority' | 'snooze' | 'agent' | 'labels' | null;

/**
 * The details of one conversation (route /conversation-details, opened from the thread's header): who the customer is, the
 * actions that change the conversation (status, priority, labels, who has it), the channel and reply window, the team's internal
 * notes, the activity timeline and the customer's other conversations. It is the web inbox's contact panel.
 */
export function ConversationDetailsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = (Array.isArray(params.id) ? params.id[0] : params.id) ?? '';
  const now = useNow(60_000);

  const session = useSession();
  const canRead = can(session.data, 'inbox.conversation.read');
  const canResolve = can(session.data, 'inbox.conversation.resolve');
  const canAssign = can(session.data, 'inbox.conversation.assign');
  const canAssignSelf = can(session.data, 'inbox.conversation.assign_self');
  const canPriority = can(session.data, 'inbox.conversation.priority');
  const canSnooze = can(session.data, 'inbox.conversation.snooze');
  const canLabel = can(session.data, 'inbox.conversation.tag');
  const canMakeLabels = can(session.data, 'inbox.tag.manage');
  const canNote = can(session.data, 'inbox.conversation.note');
  const meId = session.data?.user.id ?? '';

  const detail = useConversationDetail(id, false, canRead);
  const conversation = detail.data;
  const actions = useConversationActions(id, conversation);

  const [sheet, setSheet] = useState<Sheet>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const open = (which: Exclude<Sheet, null>) => {
    setSheetError(null);
    setSheet(which);
  };
  const saveFromSheet = async (change: Promise<string | null>) => {
    const failed = await change;
    setSheetError(failed);
    if (!failed) setSheet(null);
  };

  const body = () => {
    if (session.isPending || (canRead && detail.isPending)) {
      return <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.pad} />;
    }
    if (!canRead) {
      return (
        <View style={styles.pad}>
          <Card>
            <Text variant="subheading" accessibilityRole="header">
              {t('inbox.thread.noAccessTitle')}
            </Text>
            <Text muted>{t('inbox.thread.noAccessBody')}</Text>
          </Card>
        </View>
      );
    }
    if (!conversation) {
      return (
        <View style={styles.pad}>
          <Card>
            <Text danger accessibilityRole="alert">
              {messageForError(detail.error, t)}
            </Text>
            <Button
              variant="secondary"
              label={t('common.retry')}
              onPress={() => void detail.refetch()}
            />
          </Card>
        </View>
      );
    }

    const contact = conversation.contactSummary;
    const name = contact?.name ?? conversation.title;
    const phone = contact?.phone ?? null;
    const assignment = conversation.assignment;
    const mine = assignment.user?.id === meId;
    const agentValue = assignment.user
      ? mine
        ? t('inbox.details.you')
        : (assignment.user.name ?? t('inbox.details.unassigned'))
      : isBotConversation(assignment)
        ? (assignment.aiAgent?.name ?? t('inbox.details.bot'))
        : t('inbox.details.unassigned');
    const labels = conversation.labels.map((l) => l.name).join(', ') || t('inbox.details.none');
    const statuses = STATUS_TARGETS.filter((s) =>
      canMoveConversationStatus(conversation.status, s),
    );
    const windowText =
      conversation.window.expiresAt === null
        ? t('inbox.details.windowNone')
        : conversation.window.open
          ? t('inbox.details.windowOpen', {
              time: formatDateTime(conversation.window.expiresAt, t),
            })
          : t('inbox.details.windowClosed');

    return (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {notice ? <Banner tone="danger" message={notice} /> : null}

        <Card>
          <View style={styles.who}>
            <Avatar name={name} seed={conversation.id} size={64} />
            <Text variant="heading" accessibilityRole="header" style={styles.center}>
              {name}
            </Text>
            <Text muted>{phone ?? conversation.peerKey}</Text>
          </View>
          <View style={styles.buttons}>
            {phone ? (
              <View style={styles.fill}>
                <Button
                  variant="secondary"
                  label={t('inbox.details.call')}
                  onPress={() => void Linking.openURL(`tel:${phone}`)}
                />
              </View>
            ) : null}
            {contact ? (
              <View style={styles.fill}>
                <Button
                  variant="secondary"
                  label={t('inbox.details.openContact')}
                  onPress={() =>
                    router.push({ pathname: '/contact/[id]', params: { id: contact.id } })
                  }
                />
              </View>
            ) : null}
          </View>
          {contact ? (
            <View style={styles.facts}>
              <Fact label={t('inbox.details.email')} value={contact.email} />
              <Fact label={t('inbox.details.stage')} value={contact.lifecycleStage} />
              <Fact label={t('inbox.details.contactStatus')} value={contact.status} />
              <Fact label={t('inbox.details.owner')} value={contact.ownerName} />
              <Fact label={t('inbox.details.source')} value={contact.source} />
              <Fact
                label={t('inbox.details.leadScore')}
                value={contact.leadScore === null ? null : String(contact.leadScore)}
              />
              <Fact label={t('inbox.details.since')} value={formatDateTime(contact.createdAt, t)} />
              {contact.isUnsubscribed ? (
                <Badge label={t('inbox.details.optedOut')} tone="warning" />
              ) : null}
            </View>
          ) : (
            <Banner tone="info" message={t('inbox.details.noContact')} />
          )}
        </Card>

        <Section title={t('inbox.details.actions')}>
          <ActionRow
            label={t('inbox.details.status')}
            value={t(`inbox.status.${conversation.status}`)}
            onPress={canResolve && statuses.length > 1 ? () => open('status') : undefined}
          />
          <ActionRow
            label={t('inbox.details.priority')}
            value={t(`inbox.priority.${conversation.priority}`)}
            onPress={canPriority ? () => open('priority') : undefined}
          />
          {canSnooze && (conversation.status === 'open' || conversation.status === 'pending') ? (
            <ActionRow
              label={t('inbox.details.snooze')}
              value={t('inbox.status.snoozed')}
              onPress={() => open('snooze')}
            />
          ) : null}
          <ActionRow
            label={t('inbox.details.labels')}
            value={labels}
            onPress={canLabel ? () => open('labels') : undefined}
          />
          <ActionRow
            label={t('inbox.details.agent')}
            value={agentValue}
            onPress={canAssign ? () => open('agent') : undefined}
          />
          {assignment.team ? (
            <ActionRow label={t('inbox.details.team')} value={assignment.team.name} />
          ) : null}
          {canResolve && conversation.status === 'snoozed' ? (
            <Button
              variant="secondary"
              label={t('inbox.details.wake')}
              loading={actions.busy}
              onPress={() => {
                setNotice(null);
                void actions.moveTo('open').then(setNotice);
              }}
            />
          ) : null}
          {!mine && (canAssign || canAssignSelf) ? (
            <Button
              variant="secondary"
              label={t('inbox.thread.menu.assignToMe')}
              loading={actions.assigning}
              onPress={() => {
                setNotice(null);
                void actions.assignTo({ userId: meId }).then(setNotice);
              }}
            />
          ) : null}
        </Section>

        <Section title={t('inbox.details.info')}>
          <ActionRow label={t('inbox.details.channel')} value={conversation.channel.name} />
          <ActionRow label={t('inbox.details.window')} value={windowText} />
          {conversation.snoozedUntil ? (
            <ActionRow
              label={t('inbox.status.snoozed')}
              value={t('inbox.details.snoozedUntil', {
                time: formatDateTime(conversation.snoozedUntil, t),
              })}
            />
          ) : null}
        </Section>

        <NotesSection
          conversationId={conversation.id}
          meId={meId}
          canWrite={canNote}
          canDeleteAny={canAssign}
        />
        <TimelineSection conversationId={conversation.id} />
        <Section title={t('inbox.details.past.title')}>
          <PastList
            items={conversation.pastConversations}
            now={now}
            onOpen={(other) =>
              router.push({ pathname: '/conversation/[id]', params: { id: other } })
            }
          />
        </Section>

        <ChoiceSheet
          visible={sheet === 'status'}
          title={t('inbox.statusSheet.title')}
          groups={[
            {
              key: 'status',
              options: statuses.map((s) => ({ value: s, label: t(`inbox.status.${s}`) })),
            },
          ]}
          initial={{ status: conversation.status }}
          saving={actions.busy}
          error={sheetError}
          onSave={(picked) =>
            void saveFromSheet(
              actions.moveTo(picked.status as SetConversationStatusInput['status']),
            )
          }
          onClose={() => setSheet(null)}
        />
        <ChoiceSheet
          visible={sheet === 'priority'}
          title={t('inbox.priority.title')}
          groups={[
            {
              key: 'priority',
              options: CONVERSATION_PRIORITIES.map((p) => ({
                value: p,
                label: t(`inbox.priority.${p}`),
              })),
            },
          ]}
          initial={{ priority: conversation.priority }}
          saving={actions.busy}
          error={sheetError}
          onSave={(picked) =>
            void saveFromSheet(actions.prioritise(picked.priority as ConversationPriority))
          }
          onClose={() => setSheet(null)}
        />
        <ChoiceSheet
          visible={sheet === 'snooze'}
          title={t('inbox.snooze.title')}
          groups={[
            {
              key: 'snooze',
              options: SNOOZE_CHOICES.map((c) => ({ value: c, label: t(`inbox.snooze.${c}`) })),
            },
          ]}
          initial={{ snooze: '' }}
          saving={actions.busy}
          error={sheetError}
          onSave={(picked) => void saveFromSheet(actions.snoozeFor(picked.snooze as SnoozeChoice))}
          onClose={() => setSheet(null)}
        />
        {canAssign ? (
          <AssignSheet
            visible={sheet === 'agent'}
            assignment={conversation.assignment}
            saving={actions.assigning}
            error={sheetError}
            onSave={(change) => void saveFromSheet(actions.assignTo(change))}
            onClose={() => setSheet(null)}
          />
        ) : null}
        <LabelsSheet
          visible={sheet === 'labels'}
          conversationId={conversation.id}
          applied={conversation.labels}
          canCreate={canMakeLabels}
          onClose={() => setSheet(null)}
        />
      </ScrollView>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <StackHeader title={t('inbox.details.title')} onBack={() => router.back()} />
      {body()}
    </View>
  );
}

/** One fact about the contact; nothing is drawn when there is no value. */
function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.fact}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <Text>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { padding: spacing.lg },
  content: { padding: spacing.lg, gap: spacing.lg },
  who: { alignItems: 'center', gap: spacing.xs },
  center: { textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  fill: { flex: 1 },
  facts: { gap: spacing.sm },
  fact: { gap: 2 },
});
