import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { spacing } from '@/lib/theme/tokens';
import { ActivitySummary } from './activity-summary';
import { ActivityTab } from './activity-tab';
import { ContactActions, type ContactAction } from './contact-actions';

interface Props {
  contactId: string;
  canUpdate: boolean;
  actions: readonly ContactAction[];
}

/**
 * The Activities tab: "All activities" is the shortcuts (call, chat, email, text, tasks, notes) and how much is logged
 * (notes, tasks, meetings), each a way into its own list; "Activity timeline" is what happened with the contact, newest
 * first, where people who may update contacts log an entry of their own.
 */
export function ActivitiesTab({ contactId, canUpdate, actions }: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<'all' | 'timeline'>('all');
  return (
    <View style={styles.root}>
      <SegmentedControl
        label={t('contacts.detail.activities.label')}
        options={[
          { value: 'all', label: t('contacts.detail.activities.all') },
          { value: 'timeline', label: t('contacts.detail.activities.timeline') },
        ]}
        value={view}
        onChange={setView}
      />
      {view === 'all' ? (
        <>
          <ContactActions actions={actions} />
          <ActivitySummary contactId={contactId} />
        </>
      ) : (
        <ActivityTab contactId={contactId} canUpdate={canUpdate} hideTiles />
      )}
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: spacing.lg } });
