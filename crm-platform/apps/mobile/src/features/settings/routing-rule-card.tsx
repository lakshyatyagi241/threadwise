import type { RoutingRule } from '@crm/contracts';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Toggle } from '@/components/ui/toggle';
import { formatMoment } from '@/lib/format/dates';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { namesSummary, targetNames, whenChips } from './rule-summary';

interface Props {
  rule: RoutingRule;
  /** Whether the person may change rules (switch, move, copy, delete). */
  canManage: boolean;
  /** Moving is offered only on the full, unsearched list: a filtered list does not show the neighbours. */
  reorderable: boolean;
  first: boolean;
  last: boolean;
  /** A change to this rule is on its way. */
  busy: boolean;
  names: ReadonlyMap<string, string>;
  onToggle: (rule: RoutingRule, isActive: boolean) => void;
  onMove: (rule: RoutingRule, direction: -1 | 1) => void;
  onDuplicate: (rule: RoutingRule) => void;
  onDelete: (rule: RoutingRule) => void;
}

/**
 * One auto-assignment rule, as the web's list shows it: its name and state, when it applies, what it does, how often it fired, and the
 * switch, the two arrows that change its priority, Copy and Delete. Editing a rule is not here yet (see README).
 */
function RoutingRuleCardBase({
  rule,
  canManage,
  reorderable,
  first,
  last,
  busy,
  names,
  onToggle,
  onMove,
  onDuplicate,
  onDelete,
}: Props) {
  const { t, i18n } = useTranslation();
  const chips = whenChips(rule, (kind) =>
    t(`settings.quickReplies.channelKind.${kind}`, { defaultValue: kind }),
  );
  const targets = rule.assign
    ? namesSummary(targetNames(rule, names, t('settings.routing.someone')))
    : null;
  const disabled = !canManage || busy;

  return (
    <Card>
      <View style={styles.head}>
        <View style={styles.title}>
          <Text variant="heading">{rule.name}</Text>
          {rule.description ? (
            <Text muted numberOfLines={3}>
              {rule.description}
            </Text>
          ) : null}
        </View>
        <Toggle
          label={t('settings.routing.activeFor', { name: rule.name })}
          value={rule.isActive}
          disabled={disabled}
          onValueChange={(on) => onToggle(rule, on)}
        />
      </View>

      <View style={styles.badges}>
        <Badge
          label={rule.isActive ? t('settings.routing.active') : t('settings.routing.off')}
          tone={rule.isActive ? 'success' : 'neutral'}
        />
        {rule.isFallback ? <Badge label={t('settings.routing.fallback')} tone="warning" /> : null}
        {!rule.stopOnMatch ? (
          <Badge label={t('settings.routing.continues')} tone="neutral" />
        ) : null}
        {rule.unavailableTargets > 0 ? (
          <Badge
            label={t('settings.routing.unavailable', { count: rule.unavailableTargets })}
            tone="danger"
          />
        ) : null}
      </View>

      <View style={styles.section}>
        <Text variant="label" muted>
          {t('settings.routing.whenLabel')}
        </Text>
        <View style={styles.badges}>
          {chips.map((chip) => (
            <Badge key={chip.key} label={t(`settings.routing.when.${chip.key}`, chip.values)} />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text variant="label" muted>
          {t('settings.routing.thenLabel')}
        </Text>
        {targets && rule.assign ? (
          <Text>
            {t(`settings.routing.strategy.${rule.assign.strategy}`)}
            {': '}
            {targets.shown.join(', ')}
            {targets.more > 0 ? ` ${t('settings.routing.andMore', { count: targets.more })}` : ''}
          </Text>
        ) : null}
        {rule.markSpam ? <Text>{t('settings.routing.markSpamSummary')}</Text> : null}
        {rule.priority ? (
          <Text>
            {t('settings.routing.prioritySummary', {
              priority: t(`inbox.priority.${rule.priority}`),
            })}
          </Text>
        ) : null}
        {rule.autoReply ? (
          <Text>{t('settings.routing.autoReplySummary', { body: rule.autoReply.body })}</Text>
        ) : null}
        {rule.escalation ? (
          <Text>
            {t('settings.routing.escalationSummary', { minutes: rule.escalation.minutes })}{' '}
            {[
              rule.escalation.reassign ? t('settings.routing.escalationReassign') : null,
              rule.escalation.priority
                ? t('settings.routing.escalationPriority', {
                    priority: t(`inbox.priority.${rule.escalation.priority}`),
                  })
                : null,
            ]
              .filter(Boolean)
              .join(', ')}
          </Text>
        ) : null}
        {rule.addTags.length > 0 ? (
          <Text>
            {t('settings.routing.tagsSummary', {
              tags: rule.addTags.map((tag) => tag.name).join(', '),
            })}
          </Text>
        ) : null}
        {rule.triggerFlow ? (
          <Text>
            {rule.triggerFlow.name === null
              ? t('settings.routing.flowGone')
              : t('settings.routing.startsFlow', { name: rule.triggerFlow.name })}
            {rule.triggerFlow.name !== null && !rule.triggerFlow.isActive
              ? ` (${t('settings.routing.flowOff')})`
              : ''}
          </Text>
        ) : null}
      </View>

      <Text variant="caption" muted>
        {rule.firedCount === 0
          ? t('settings.routing.neverFired')
          : t('settings.routing.fired', { count: rule.firedCount })}
        {rule.lastFiredAt
          ? ` · ${t('settings.routing.lastFired', { when: formatMoment(rule.lastFiredAt, i18n.language) })}`
          : ''}
      </Text>

      {canManage ? (
        <View style={styles.actions}>
          {reorderable ? (
            <>
              <Arrow
                label={t('settings.routing.moveUp', { name: rule.name })}
                icon="arrow-up"
                disabled={first || busy}
                onPress={() => onMove(rule, -1)}
              />
              <Arrow
                label={t('settings.routing.moveDown', { name: rule.name })}
                icon="arrow-down"
                disabled={last || busy}
                onPress={() => onMove(rule, 1)}
              />
            </>
          ) : null}
          <View style={styles.grow} />
          <Button
            variant="secondary"
            label={`${t('settings.routing.duplicate')} ${rule.name}`}
            disabled={busy}
            onPress={() => onDuplicate(rule)}
          />
          <Button
            variant="secondary"
            label={`${t('settings.routing.delete')} ${rule.name}`}
            disabled={busy}
            onPress={() => onDelete(rule)}
          />
        </View>
      ) : null}
    </Card>
  );
}

export const RoutingRuleCard = memo(RoutingRuleCardBase);

function Arrow({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: 'arrow-up' | 'arrow-down';
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.arrow, disabled && styles.faded]}
    >
      <Icon name={icon} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: { flex: 1, gap: spacing.xs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  section: { gap: spacing.xs },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  grow: { flex: 1 },
  arrow: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faded: { opacity: 0.35 },
});
