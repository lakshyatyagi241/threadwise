import type { FieldOptionResponse, FieldResponse } from '@crm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { CONTROL_HEIGHT, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ChoiceRow, EditSheet } from './field-editor';
import { EMPTY_DRAFT, editorKindOf, keyboardFor, optionLabel, type Draft } from './property-values';
import { useFieldOptions } from './use-properties';

/** A list this long gets a search box: a country list has hundreds. */
const SEARCH_FROM = 12;

interface Props {
  fields: readonly FieldResponse[];
  drafts: Readonly<Record<string, Draft | undefined>>;
  /** What is wrong with each property, in the person's language, by property key. */
  problems: Readonly<Record<string, string | undefined>>;
  onChange: (key: string, patch: Partial<Draft>) => void;
}

/**
 * The workspace's required properties, as the part of the new-contact form under email: each with the input its type calls for
 * (text, number, date, a list to pick from). The API refuses a contact that has none of these, so they are asked for here.
 */
export function NewContactProperties({ fields, drafts, problems, onChange }: Props) {
  const { t } = useTranslation();
  if (fields.length === 0) return null;
  return (
    <View style={styles.group}>
      <Text variant="subheading" accessibilityRole="header">
        {t('contacts.new.requiredTitle')}
      </Text>
      {fields.map((field) => (
        <PropertyInput
          key={field.id}
          field={field}
          draft={drafts[field.key] ?? EMPTY_DRAFT}
          problem={problems[field.key]}
          onChange={(patch) => onChange(field.key, patch)}
        />
      ))}
    </View>
  );
}

interface InputProps {
  field: FieldResponse;
  draft: Draft;
  problem: string | undefined;
  onChange: (patch: Partial<Draft>) => void;
}

function PropertyInput({ field, draft, problem, onChange }: InputProps) {
  const { t } = useTranslation();
  const kind = editorKindOf(field.fieldType);
  if (kind === 'single' || kind === 'multi') {
    return <OptionPicker field={field} draft={draft} problem={problem} onChange={onChange} />;
  }
  if (kind === 'unsupported') {
    return (
      <Banner tone="warning" message={t('contacts.new.unsupported', { label: field.label })} />
    );
  }
  if (kind === 'date' || kind === 'datetime') {
    const withTime = kind === 'datetime';
    return (
      <>
        <TextField
          label={withTime ? `${field.label} · ${t('contactProps.editor.date')}` : field.label}
          hint={t('contactProps.editor.dateHint')}
          value={draft.text}
          onChangeText={(text) => onChange({ text })}
          error={problem}
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          maxLength={10}
        />
        {withTime ? (
          <TextField
            label={`${field.label} · ${t('contactProps.editor.time')}`}
            hint={t('contactProps.editor.timeHint')}
            value={draft.time}
            onChangeText={(time) => onChange({ time })}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            maxLength={5}
          />
        ) : null}
      </>
    );
  }
  return (
    <TextField
      label={field.label}
      hint={field.fieldType === 'phone' ? t('contactProps.editor.phoneHint') : undefined}
      value={draft.text}
      onChangeText={(text) => onChange({ text })}
      error={problem}
      keyboardType={keyboardFor(field.fieldType)}
      multiline={kind === 'longText'}
      numberOfLines={kind === 'longText' ? 4 : 1}
      autoCapitalize="none"
      autoCorrect={false}
    />
  );
}

/** A property with a list of options: a field that shows the choice and opens the list in a sheet. */
function OptionPicker({ field, draft, problem, onChange }: InputProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const single = editorKindOf(field.fieldType) === 'single';
  const fetched = useFieldOptions(field.id, field.options === undefined);
  const options: FieldOptionResponse[] = [...(field.options ?? fetched.data ?? [])]
    .filter((o) => !o.isHidden)
    .sort((a, b) => a.position - b.position);
  const needle = search.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const chosen = draft.picked.map((value) => optionLabel(options, value)).join(', ');

  const close = () => {
    setOpen(false);
    setSearch('');
  };
  const toggle = (value: string) => {
    if (single) {
      onChange({ picked: [value] });
      close();
    } else {
      onChange({
        picked: draft.picked.includes(value)
          ? draft.picked.filter((v) => v !== value)
          : [...draft.picked, value],
      });
    }
  };

  let list;
  if (field.options === undefined && fetched.isPending) {
    list = <ActivityIndicator accessibilityLabel={t('common.loading')} />;
  } else if (field.options === undefined && fetched.isError) {
    list = (
      <View>
        <Banner tone="danger" message={messageForError(fetched.error, t)} />
        <Button
          variant="link"
          align="start"
          label={t('common.retry')}
          onPress={() => void fetched.refetch()}
        />
      </View>
    );
  } else if (options.length === 0) {
    list = <Text muted>{t('contactProps.editor.noOptions')}</Text>;
  } else {
    list = (
      <View accessibilityRole={single ? 'radiogroup' : undefined}>
        {shown.map((option) => (
          <ChoiceRow
            key={option.id}
            label={option.label}
            role={single ? 'radio' : 'checkbox'}
            selected={draft.picked.includes(option.value)}
            onPress={() => toggle(option.value)}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text variant="label">{field.label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={field.label}
        accessibilityValue={{ text: chosen || t('contacts.new.choose') }}
        onPress={() => setOpen(true)}
        style={[
          styles.field,
          {
            backgroundColor: colors.surface,
            borderColor: problem ? colors.danger : colors.borderStrong,
          },
        ]}
      >
        <Text style={styles.value} numberOfLines={1} muted={chosen === ''}>
          {chosen || t('contacts.new.choose')}
        </Text>
        <Icon name="chevron-down" size={18} color="textMuted" />
      </Pressable>
      {problem ? (
        <Text variant="caption" danger accessibilityLiveRegion="polite" accessibilityRole="alert">
          {problem}
        </Text>
      ) : null}
      {open ? (
        <EditSheet title={field.label} onClose={close} onSave={close}>
          {options.length >= SEARCH_FROM ? (
            <TextField
              label={t('contacts.new.search')}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              returnKeyType="search"
            />
          ) : null}
          {list}
        </EditSheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.lg },
  wrap: { gap: spacing.xs },
  field: {
    minHeight: CONTROL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderRadius: radius.md,
  },
  value: { flex: 1 },
});
