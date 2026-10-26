import { useRouter } from 'expo-router';
import { Fragment } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { findDoc, type HelpBlock, type HelpInline } from './help-data';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** One run of a paragraph: plain, bold, code, or a pointer to another guide (a web page address is shown as plain text). */
function Inline({ items }: { items: readonly HelpInline[] }) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <>
      {items.map((item, index) => {
        if (item.t === 'bold') {
          return (
            <Text key={index} style={styles.bold}>
              {item.v}
            </Text>
          );
        }
        if (item.t === 'code') {
          return (
            <Text key={index} style={{ fontFamily: MONO, backgroundColor: colors.surfaceMuted }}>
              {item.v}
            </Text>
          );
        }
        if (item.t === 'doc' && findDoc(item.doc)) {
          return (
            <Text
              key={index}
              accessibilityRole="link"
              color="action"
              style={styles.link}
              onPress={() => router.push({ pathname: '/help/[id]', params: { id: item.doc } })}
            >
              {item.v}
            </Text>
          );
        }
        return <Fragment key={index}>{item.v}</Fragment>;
      })}
    </>
  );
}

/** The body of a guide: headings, paragraphs, lists and notes, in one column. */
export function HelpBlocks({ blocks }: { blocks: readonly HelpBlock[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.column}>
      {blocks.map((block, index) => {
        if (block.t === 'h') {
          return (
            <Text
              key={index}
              variant={block.level === 2 ? 'heading' : 'subheading'}
              accessibilityRole="header"
              style={styles.heading}
            >
              {block.text}
            </Text>
          );
        }
        if (block.t === 'p') {
          return (
            <Text key={index}>
              <Inline items={block.inline} />
            </Text>
          );
        }
        if (block.t === 'note') {
          return (
            <View
              key={index}
              style={[
                styles.note,
                { backgroundColor: colors.actionSoft, borderStartColor: colors.action },
              ]}
            >
              <Text>
                <Inline items={block.inline} />
              </Text>
            </View>
          );
        }
        return (
          <View key={index} style={styles.list}>
            {block.items.map((item, position) => (
              <View key={position} style={styles.item}>
                <Text style={styles.marker}>{block.t === 'ol' ? `${position + 1}.` : '•'}</Text>
                <Text style={styles.itemText}>
                  <Inline items={item} />
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing.md },
  heading: { marginTop: spacing.md },
  bold: { fontWeight: '700' },
  link: { textDecorationLine: 'underline' },
  note: {
    borderRadius: radius.md,
    borderStartWidth: 4,
    padding: spacing.md,
  },
  list: { gap: spacing.sm },
  item: { flexDirection: 'row', gap: spacing.sm },
  marker: { minWidth: 20 },
  itemText: { flex: 1 },
});
