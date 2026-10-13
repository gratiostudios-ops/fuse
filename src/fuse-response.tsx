import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { FuseResponse } from '../api/ai';
import { colors, fonts } from './theme';

export function FuseResponseView({ response }: { response: FuseResponse }) {
  return <View style={styles.container}>
    {!!response.message && <Text style={styles.message}>{response.message}</Text>}
    {response.blocks.map((block, index) => {
      if (block.type === 'text') return <Text key={index} style={styles.reason}>{block.data.content}</Text>;
      const d = block.data;
      return <View key={`${block.type}:${d.id}`} style={[styles.card, { borderLeftColor: block.type === 'task' ? '#D66767' : block.type === 'schedule' ? '#6596DB' : '#64AA7B' }]}>
        <Text style={styles.label}>{block.type === 'schedule' ? 'Event' : block.type === 'task' ? 'Task' : 'Suggestion'}</Text>
        <Text style={styles.title}>{d.title}</Text>
        {block.type === 'task' && <Text style={styles.detail}>{block.data.is_completed ? 'Completed · ' : 'Due · '}{block.data.due_date}{block.data.due_time ? ` at ${block.data.due_time.slice(0, 5)}` : ''}</Text>}
        {block.type === 'schedule' && <Text style={styles.detail}>{new Date(block.data.start).toLocaleString()} – {new Date(block.data.end).toLocaleString()}</Text>}
        {block.type === 'suggestion' && <>
          {block.data.duration_minutes !== null && <Text style={styles.detail}>{block.data.duration_minutes} minutes</Text>}
          <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(block.data.video_url).catch(() => {}); }}>
            <Text style={styles.link}>Watch video</Text>
          </Pressable>
        </>}
      </View>;
    })}
  </View>;
}
const styles = StyleSheet.create({
  container: { gap: 10 },
  message: { fontFamily: fonts.regular, color: colors.foreground, fontSize: 14 },
  card: { padding: 14, borderRadius: 10, backgroundColor: colors.composer, borderLeftWidth: 4, gap: 6 },
  label: { fontFamily: fonts.medium, color: colors.placeholder, fontSize: 11 },
  title: { fontFamily: fonts.medium, color: colors.foreground, fontSize: 14 },
  detail: { fontFamily: fonts.regular, color: colors.foreground, fontSize: 12 },
  reason: { fontFamily: fonts.regular, color: colors.placeholder, fontSize: 12 },
  link: { fontFamily: fonts.medium, color: '#64AA7B', fontSize: 13, paddingVertical: 4 },
});
