import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner } from '@/components/ui/banner';
import { CalendarRange } from '@/components/ui/calendar-range';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

export interface FilterOption {
  value: string;
  label: string;
  /** A second, muted line under the label. */
  hint?: string;
}

interface CategoryBase {
  key: string;
  /** The name in the list on the left, and the heading of the pane on the right. */
  title: string;
  /** What the category holds when it filters nothing (`''` unless the screen's own default is a real value, such as "open and pending"). */
  empty?: string;
}

/**
 * One category of the filters. Its choice is a string in the draft: the picked value for `single`, the ticked values joined with
 * a comma for `multi` (they are ids), the typed words for `text`, and `from,to` (YYYY-MM-DD, the second may be empty) for `dates`.
 */
export type FilterCategory = CategoryBase &
  (
    | { kind: 'single'; options: readonly FilterOption[] }
    | {
        kind: 'multi';
        options: readonly FilterOption[];
        /** Names the search box over the options; no box without it. */
        searchLabel?: string;
      }
    | { kind: 'text'; label: string; hint?: string }
    | { kind: 'dates'; maxDate: string }
  );

export type FilterValues = Readonly<Record<string, string>>;

interface Props {
  visible: boolean;
  title: string;
  categories: readonly FilterCategory[];
  /** What is applied now, by category key; a missing key is that category's empty value. */
  value: FilterValues;
  /** Why the options could not all be loaded: said above the choices, the rest stays usable. */
  error?: string | null;
  /** Called with the choice of every category when "Apply" is pressed. */
  onApply: (picked: Record<string, string>) => void;
  onClose: () => void;
}

const emptyOf = (category: FilterCategory): string => category.empty ?? '';
const listOf = (joined: string | undefined): string[] => (joined ? joined.split(',') : []);

/** Whether a category holds a real choice (a dot beside its name on the left). */
const isSet = (category: FilterCategory, picked: string): boolean =>
  picked !== emptyOf(category) &&
  !(category.kind === 'dates' && listOf(picked).every((day) => day === ''));

/** The first and last day of a `dates` choice. */
const rangeOf = (picked: string | undefined): { from: string | null; to: string | null } => {
  const [from, to] = (picked ?? '').split(',');
  return { from: from || null, to: to || null };
};

/**
 * The filters of a list as a full screen, the way the Geta app lays them out: the categories down the left, the choices of the
 * one that is open on the right, and "Clear all" and "Apply" along the bottom. Nothing changes on the list until "Apply";
 * "Clear all" takes every filter off and applies at once. The screen mounts it only while open, so a draft always starts from what is applied.
 */
export function FilterPanes(props: Props) {
  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <PanesBody {...props} />
    </Modal>
  );
}

function PanesBody({ title, categories, value, error, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Only what the person changed; every other category reads as what is applied. A category whose options arrive late (the
  // channels, the labels) therefore still starts from its applied value.
  const [edited, setEdited] = useState<Record<string, string>>({});
  const current = (c: FilterCategory): string => edited[c.key] ?? value[c.key] ?? emptyOf(c);
  const [openKey, setOpenKey] = useState(categories[0]?.key ?? '');
  const [search, setSearch] = useState('');
  const open = categories.find((c) => c.key === openKey) ?? categories[0];

  const set = (key: string, next: string) => setEdited((p) => ({ ...p, [key]: next }));
  // "Clear all" is a way to take every filter off the list, so it applies at once: every category goes back to what it holds when it
  // filters nothing, and the list changes behind the closing screen.
  const clearAll = () => onApply(Object.fromEntries(categories.map((c) => [c.key, emptyOf(c)])));
  const choose = (category: FilterCategory, optionValue: string) => {
    if (category.kind === 'single') return set(category.key, optionValue);
    const ticked = listOf(current(category));
    set(
      category.key,
      (ticked.includes(optionValue)
        ? ticked.filter((v) => v !== optionValue)
        : [...ticked, optionValue]
      ).join(','),
    );
  };

  return (
    <View
      accessibilityViewIsModal
      style={[
        styles.fill,
        { backgroundColor: colors.surface, paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onClose}
          style={styles.back}
        >
          <Icon name="arrow-back" size={24} />
        </Pressable>
        <Text variant="heading" accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <View style={styles.back} />
      </View>

      <View style={styles.fill}>
        <View style={styles.panes}>
          <ScrollView
            style={[styles.rail, { backgroundColor: colors.background }]}
            accessibilityRole="tablist"
          >
            {categories.map((category) => {
              const selected = category.key === open?.key;
              return (
                <Pressable
                  key={category.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={category.title}
                  onPress={() => {
                    setOpenKey(category.key);
                    setSearch('');
                  }}
                  style={[
                    styles.railItem,
                    selected && { backgroundColor: colors.primarySoft },
                    { borderLeftColor: selected ? colors.primary : 'transparent' },
                  ]}
                >
                  <Text
                    variant={selected ? 'label' : 'body'}
                    color={selected ? 'primary' : 'textMuted'}
                    style={styles.railText}
                  >
                    {category.title}
                  </Text>
                  {isSet(category, current(category)) ? (
                    <View style={[styles.dot, { backgroundColor: colors.primary }]} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>

          <ScrollView
            style={styles.fill}
            contentContainerStyle={styles.pane}
            keyboardShouldPersistTaps="handled"
          >
            {error ? <Banner tone="danger" message={error} /> : null}
            {open ? (
              <Pane
                category={open}
                picked={current(open)}
                search={search}
                onSearch={setSearch}
                onChoose={(optionValue) => choose(open, optionValue)}
                onText={(text) => set(open.key, text)}
                onRange={(from, to) => set(open.key, `${from},${to ?? ''}`)}
              />
            ) : null}
          </ScrollView>
        </View>

        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.filters.clearAll')}
            onPress={clearAll}
            style={styles.clear}
          >
            <Text variant="label" color="textMuted">
              {t('common.filters.clearAll')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.filters.apply')}
            onPress={() => onApply(Object.fromEntries(categories.map((c) => [c.key, current(c)])))}
            style={[styles.apply, { backgroundColor: colors.primary }]}
          >
            <Text variant="label" color="onPrimary">
              {t('common.filters.apply')}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

interface PaneProps {
  category: FilterCategory;
  picked: string;
  search: string;
  onSearch: (text: string) => void;
  onChoose: (optionValue: string) => void;
  onText: (text: string) => void;
  onRange: (from: string, to: string | null) => void;
}

/** The right-hand side: the choices of the open category. */
function Pane({ category, picked, search, onSearch, onChoose, onText, onRange }: PaneProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  if (category.kind === 'text') {
    return (
      <TextField
        label={category.label}
        hint={category.hint}
        value={picked}
        onChangeText={onText}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
      />
    );
  }
  if (category.kind === 'dates') {
    const { from, to } = rangeOf(picked);
    return (
      <CalendarRange
        key={category.key}
        from={from}
        to={to}
        maxDate={category.maxDate}
        onChange={onRange}
      />
    );
  }

  const multiple = category.kind === 'multi';
  const needle = search.trim().toLowerCase();
  const shown =
    needle && multiple
      ? category.options.filter(
          (o) =>
            o.label.toLowerCase().includes(needle) || (o.hint ?? '').toLowerCase().includes(needle),
        )
      : category.options;
  const ticked = listOf(picked);
  return (
    <View accessibilityRole={multiple ? undefined : 'radiogroup'}>
      {multiple && category.searchLabel ? (
        <TextField
          label={category.searchLabel}
          value={search}
          onChangeText={onSearch}
          autoCorrect={false}
          returnKeyType="search"
        />
      ) : null}
      {shown.length === 0 ? (
        <Text muted style={styles.none}>
          {t('common.filters.noMatch')}
        </Text>
      ) : (
        shown.map((option) => {
          const checked = multiple ? ticked.includes(option.value) : picked === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole={multiple ? 'checkbox' : 'radio'}
              accessibilityLabel={option.hint ? `${option.label}, ${option.hint}` : option.label}
              accessibilityState={{ checked }}
              onPress={() => onChoose(option.value)}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <Icon
                name={
                  multiple
                    ? checked
                      ? 'checkbox'
                      : 'square-outline'
                    : checked
                      ? 'radio-button-on'
                      : 'radio-button-off'
                }
                size={24}
                color={checked ? 'primary' : 'textMuted'}
              />
              <View style={styles.rowText}>
                <Text variant={checked ? 'label' : 'body'}>{option.label}</Text>
                {option.hint ? (
                  <Text variant="caption" muted>
                    {option.hint}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const RAIL_WIDTH = '32%';

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, textAlign: 'center' },
  panes: { flex: 1, flexDirection: 'row' },
  rail: { width: RAIL_WIDTH, flexGrow: 0 },
  railItem: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderLeftWidth: 4,
  },
  railText: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  pane: { padding: spacing.lg, gap: spacing.md },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
  none: { paddingVertical: spacing.lg },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  clear: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  apply: {
    flex: 1.4,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
});
