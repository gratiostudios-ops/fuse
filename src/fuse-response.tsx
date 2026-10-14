import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { FuseResponse } from '../api/ai';
import { colors, fonts } from './theme';
import { ActivityRow } from './activity-row';
import { homeSummary, stripLegacyLoadWarning } from '../supabase/functions/_shared/contract';

export function FuseResponseView({ response, presentation = 'chat' }: { response: FuseResponse; presentation?: 'home' | 'chat' }) {
  const message = presentation === 'home' ? homeSummary(response.blocks) : stripLegacyLoadWarning(response.message);
  return <View style={styles.container}>
    {response.blocks.map((block, index) => {
      if (block.type === 'text') return null;
      if (block.type === 'task') return <ActivityRow key={'task:' + block.data.id} kind="task" title={block.data.title} date={block.data.due_date} completed={block.data.is_completed} />;
      if (block.type === 'schedule') return <ActivityRow key={'schedule:' + block.data.id} kind="schedule" title={block.data.title} date={block.data.is_all_day ? block.data.start_date + 'T12:00:00' : block.data.start} allDay={block.data.is_all_day} completed={block.data.is_completed} />;
      const d = block.data;
      return <View key={`${block.type}:${d.id}`} style={[styles.card, { borderLeftColor: '#64AA7B' }]}>
        <Text style={styles.label}>Suggestion</Text>
        <Text style={styles.title}>{d.title}</Text>
        {block.type === 'suggestion' && <>
          {block.data.duration_minutes !== null && <Text style={styles.detail}>{block.data.duration_minutes} minutes</Text>}
          <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(block.data.video_url).catch(() => {}); }}>
            <Text style={styles.link}>Watch video</Text>
          </Pressable>
        </>}
      </View>;
    })}
    {!!message && <Text style={styles.message}>{message}</Text>}
    {presentation === 'chat' && response.blocks.map((block, index) => block.type === 'text' ? <Text key={index} style={styles.reason}>{block.data.content}</Text> : null)}
  </View>;
}
const styles = StyleSheet.create({
  container: { gap: 12 },
  message: { fontFamily: fonts.semibold, color: '#E6E6E6', fontSize: 16, lineHeight: 19, marginTop: 24 },
  card: { padding: 14, borderRadius: 10, backgroundColor: colors.composer, borderLeftWidth: 4, gap: 6 },
  label: { fontFamily: fonts.medium, color: colors.placeholder, fontSize: 11 },
  title: { fontFamily: fonts.medium, color: colors.foreground, fontSize: 14 },
  detail: { fontFamily: fonts.regular, color: colors.foreground, fontSize: 12 },
  reason: { fontFamily: fonts.regular, color: colors.placeholder, fontSize: 12 },
  link: { fontFamily: fonts.medium, color: '#64AA7B', fontSize: 13, paddingVertical: 4 },
});
