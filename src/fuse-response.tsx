import { SuggestionCard } from './suggestion-card';
import { StyleSheet, Text, View } from 'react-native';
import type { FuseResponse } from '../api/ai';
import { colors, fonts } from './theme';
import { ActivityRow } from './activity-row';

export function FuseResponseView({ response, presentation = 'chat' }: { response: FuseResponse; presentation?: 'home' | 'chat' }) {
  const message = response.message;
  return <View style={[styles.container, presentation === 'home' && styles.homeContainer]}>
    {response.blocks.map((block, index) => {
      if (block.type === 'text') return null;
      if (block.type === 'task') return <ActivityRow key={'task:' + block.data.id} kind="task" title={block.data.title} date={block.data.due_date} completed={block.data.is_completed} />;
      if (block.type === 'schedule') return <ActivityRow key={'schedule:' + block.data.id} kind="schedule" title={block.data.title} date={block.data.is_all_day ? block.data.start_date + 'T12:00:00' : block.data.start} allDay={block.data.is_all_day} completed={block.data.is_completed} />;
      return <SuggestionCard key={'suggestion:' + block.data.id} suggestion={block.data} />;
    })}
    {!!message && <Text style={[styles.message, presentation === 'home' && styles.homeMessage]}>{message}</Text>}
    {presentation === 'chat' && response.blocks.map((block, index) => block.type === 'text' ? <Text key={index} style={styles.reason}>{block.data.content}</Text> : null)}
  </View>;
}
const styles = StyleSheet.create({
  container: { gap: 12 },
  message: { fontFamily: fonts.semibold, color: '#E6E6E6', fontSize: 16, lineHeight: 19, marginTop: 24 },
  homeContainer: { gap: 8 },
  homeMessage: { fontSize: 14, lineHeight: 16, marginTop: 12 },
  reason: { fontFamily: fonts.regular, color: colors.placeholder, fontSize: 12 },
});
