import type { CountryCode } from 'libphonenumber-js';
import { useMemo, useState, type Ref } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  callingCode,
  countryMatches,
  joinPhone,
  listCountries,
  nationalOf,
  splitPhone,
  type CountryOption,
} from '@/lib/phone/countries';
import { FONT_FAMILY } from '@/lib/theme/fonts';
import { CONTROL_HEIGHT, MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Icon } from './icon';
import { SearchField } from './search-field';
import { Text } from './text';

export interface PhoneFieldProps extends Omit<TextInputProps, 'style' | 'value' | 'onChangeText'> {
  label: string;
  /** The number as the API takes it: "+" and digits ("+919876543210"), or empty. */
  value: string;
  onChangeText: (value: string) => void;
  /** The country whose code the field starts on when the number is empty. */
  defaultCountry: CountryCode;
  /** The language the country names are shown in. */
  locale: string;
  error?: string | null;
  hint?: string;
  inputRef?: Ref<TextInput>;
  /** What the code button is called for screen readers ("Country code"). */
  codeLabel: string;
  /** The picker's title and the name of its search box. */
  searchLabel: string;
  clearLabel: string;
  closeLabel: string;
  /** Shown in the picker when nothing matches the search. */
  emptyLabel: string;
}

/**
 * A phone number with its own country code, like the Geta app's: the code on the left ("+91", opening a searchable list of countries)
 * and the number on the right. The value stays one string, "+" and digits, so the form and the API take it as they always did. The
 * box looks like `TextField` — its border follows focus and error the same way.
 */
export function PhoneField({
  label,
  value,
  onChangeText,
  defaultCountry,
  locale,
  error,
  hint,
  inputRef,
  codeLabel,
  searchLabel,
  clearLabel,
  closeLabel,
  emptyLabel,
  onFocus,
  onBlur,
  ...rest
}: PhoneFieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [picking, setPicking] = useState(false);
  // The country is the person's choice (or the stored number's, once): typing digits never changes it.
  const [iso, setIso] = useState<CountryCode>(() => splitPhone(value, defaultCountry).iso);
  const borderColor = error ? colors.danger : focused ? colors.primary : colors.borderStrong;

  const type = (text: string) => {
    if (text.trim().startsWith('+')) {
      // A whole international number pasted or typed in: its own code picks the country.
      const whole = splitPhone(text, iso);
      setIso(whole.iso);
      onChangeText(joinPhone(whole.iso, whole.national));
      return;
    }
    onChangeText(joinPhone(iso, text));
  };
  const choose = (next: CountryCode) => {
    setPicking(false);
    setIso(next);
    onChangeText(joinPhone(next, nationalOf(value, iso)));
  };

  return (
    <View style={styles.wrap}>
      <Text variant="label">{label}</Text>
      <View style={[styles.field, { backgroundColor: colors.surface, borderColor }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={codeLabel}
          accessibilityValue={{ text: callingCode(iso) }}
          onPress={() => setPicking(true)}
          style={[styles.code, { borderEndColor: colors.border }]}
        >
          <Text>{callingCode(iso)}</Text>
          <Icon name="chevron-down" size={16} color="textMuted" />
        </Pressable>
        <TextInput
          {...rest}
          ref={inputRef}
          accessibilityLabel={label}
          accessibilityHint={hint}
          value={nationalOf(value, iso)}
          placeholderTextColor={colors.placeholder}
          onChangeText={type}
          inputMode="tel"
          keyboardType="phone-pad"
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, { color: colors.text }]}
        />
      </View>
      {error ? (
        <Text variant="caption" danger accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" muted>
          {hint}
        </Text>
      ) : null}
      {picking ? (
        <CountryPicker
          selected={iso}
          locale={locale}
          title={searchLabel}
          clearLabel={clearLabel}
          closeLabel={closeLabel}
          emptyLabel={emptyLabel}
          onPick={choose}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </View>
  );
}

interface PickerProps {
  selected: CountryCode;
  locale: string;
  title: string;
  clearLabel: string;
  closeLabel: string;
  emptyLabel: string;
  onPick: (iso: CountryCode) => void;
  onClose: () => void;
}

/** The list of countries in a sheet: a search box on top (by name, letters or code) and the chosen one ticked. Mounted only while open. */
function CountryPicker({
  selected,
  locale,
  title,
  clearLabel,
  closeLabel,
  emptyLabel,
  onPick,
  onClose,
}: PickerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const all = useMemo(() => listCountries(locale), [locale]);
  const shown = useMemo(() => all.filter((c) => countryMatches(c, query)), [all, query]);
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      {/* A modal window is not resized for the keyboard, so the sheet lifts itself: padding on both platforms. */}
      <KeyboardAvoidingView
        behavior="padding"
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          style={styles.fill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              paddingBottom: insets.bottom + spacing.md,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text variant="subheading" accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <View style={styles.search}>
            <SearchField
              label={title}
              placeholder={title}
              clearLabel={clearLabel}
              value={query}
              onChangeText={setQuery}
            />
          </View>
          <FlatList
            data={shown}
            keyExtractor={(c) => c.iso}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            ListEmptyComponent={
              <Text muted style={styles.empty}>
                {emptyLabel}
              </Text>
            }
            renderItem={({ item }) => (
              <CountryRow
                country={item}
                selected={item.iso === selected}
                onPress={() => onPick(item.iso)}
              />
            )}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CountryRow({
  country,
  selected,
  onPress,
}: {
  country: CountryOption;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${country.name}, ${country.code}`}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.row, selected && { backgroundColor: colors.primarySoft }]}
    >
      <Text variant={selected ? 'label' : 'body'} numberOfLines={1} style={styles.rowName}>
        {country.name}
      </Text>
      <Text muted>{country.code}</Text>
      {selected ? <Icon name="checkmark" size={20} color="primary" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  field: {
    minHeight: CONTROL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radius.md,
  },
  code: {
    minHeight: CONTROL_HEIGHT - 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderEndWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: CONTROL_HEIGHT - 3,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    fontFamily: FONT_FAMILY.regular,
  },
  scrim: { flex: 1, justifyContent: 'flex-end' },
  fill: { flex: 1 },
  sheet: {
    height: '75%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  title: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  search: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  empty: { padding: spacing.lg },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowName: { flex: 1 },
});
