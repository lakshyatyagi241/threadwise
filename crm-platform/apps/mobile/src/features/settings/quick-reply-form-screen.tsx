import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import {
  EMPTY_DRAFT,
  draftOf,
  toCreateInput,
  toUpdateInput,
  type QuickReplyDraft,
} from './quick-reply-draft';
import { QuickReplyEditor } from './quick-reply-editor';
import { describeFailure, isReplyGone, type ReplyFailure } from './quick-reply-errors';
import {
  quickRepliesKey,
  useCreateQuickReply,
  useQuickReply,
  useUpdateQuickReply,
} from './use-quick-replies';

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

/**
 * Add a saved reply, or edit one (`?replyId=`). A new reply is sent once; an edit carries the version that was read, and a reply changed
 * by someone else in the meantime is reloaded with a note to review it and save again. Needs `inbox.savedreply.manage`.
 */
export function QuickReplyFormScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ replyId?: string | string[] }>();
  const replyId = first(params.replyId);
  const editing = replyId !== '';
  const session = useSession();
  const allowed = can(session.data, 'inbox.savedreply.manage');

  const reply = useQuickReply(replyId, editing && allowed);
  const create = useCreateQuickReply();
  const update = useUpdateQuickReply(replyId);
  const [failure, setFailure] = useState<ReplyFailure | null>(null);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/quick-replies'));
  const header = (
    <StackHeader
      title={t(
        editing ? 'settings.quickReplies.form.titleEdit' : 'settings.quickReplies.form.titleNew',
      )}
      onBack={goBack}
    />
  );

  let body;
  if (session.data === undefined) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (!allowed) {
    body = <EmptyState icon="lock-closed-outline" title={t('settings.quickReplies.noAccess')} />;
  } else if (editing && !reply.data) {
    body = reply.isPending ? (
      <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />
    ) : (
      <View style={styles.pad}>
        <Card>
          <Text danger accessibilityRole="alert">
            {isReplyGone(reply.error)
              ? t('settings.quickReplies.notFound')
              : messageForError(reply.error, t)}
          </Text>
          {isReplyGone(reply.error) ? null : (
            <Button
              variant="secondary"
              label={t('common.retry')}
              onPress={() => void reply.refetch()}
            />
          )}
        </Card>
      </View>
    );
  } else {
    const current = reply.data;
    const onSubmit = (draft: QuickReplyDraft) => {
      setFailure(null);
      const fail = (error: unknown) => {
        const described = describeFailure(error, t, draft.shortcut);
        setFailure(described);
        // Someone else changed it first: the form is rebuilt from their version (it is keyed by the version below).
        if (described.conflict)
          void queryClient.invalidateQueries({ queryKey: [...quickRepliesKey, 'one', replyId] });
      };
      if (current) {
        update.mutate(toUpdateInput(draft, current.rowVersion), {
          onSuccess: goBack,
          onError: fail,
        });
      } else {
        create.mutate(toCreateInput(draft), { onSuccess: goBack, onError: fail });
      }
    };
    return (
      <View style={[styles.fill, { backgroundColor: colors.background }]}>
        <QuickReplyEditor
          key={current?.rowVersion ?? 'new'}
          mode={editing ? 'edit' : 'create'}
          initial={current ? draftOf(current) : EMPTY_DRAFT}
          pending={create.isPending || update.isPending}
          banner={failure && !failure.conflict ? failure.banner : null}
          notice={failure?.conflict ? failure.banner : null}
          serverErrors={failure?.fields}
          onBack={goBack}
          onSubmit={onSubmit}
        />
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      {header}
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: spacing.lg },
  loading: { marginTop: spacing.xxl },
});
