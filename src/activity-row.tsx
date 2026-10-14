import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { fonts } from './theme';

export function activityLabel(kind: 'task' | 'schedule', date: string | null | undefined, allDay = false, timezone?: string) {
  if (kind === 'task') return { primary: date ? new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No date', secondary: '' };
  if (!date) return { primary: 'All day', secondary: '' };
  if (allDay) {
    const day = date.slice(0, 10);
    return { primary: 'All day', secondary: day === new Date().toLocaleDateString('en-CA') ? '' : new Date(day + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) };
  }
  const value = new Date(date);
  const options = timezone ? { timeZone: timezone } : {};
  const today = value.toLocaleDateString('en-CA', options) === new Date().toLocaleDateString('en-CA', options);
  const day = today ? '' : value.toLocaleDateString(undefined, { ...options, month: 'short', day: 'numeric' });
  const parts = new Intl.DateTimeFormat('en-US', { ...options, hour: '2-digit', minute: '2-digit', hour12: true }).formatToParts(value);
  return { primary: parts.find(p => p.type === 'hour')?.value + '.' + parts.find(p => p.type === 'minute')?.value, secondary: parts.find(p => p.type === 'dayPeriod')?.value.toLowerCase() + (day ? ' · ' + day : '') };
}
export function ActivityRow({ kind, title, date, allDay, timezone, completed, control }: { kind: 'task' | 'schedule'; title: string; date?: string | null; allDay?: boolean; timezone?: string; completed?: boolean; control?: ReactNode }) {
  const label = activityLabel(kind, date, allDay, timezone);
  return <View style={styles.row}>
    <View style={styles.date}><Text style={styles.primary}>{label.primary}</Text>{!!label.secondary && <Text style={styles.secondary}>{label.secondary}</Text>}</View>
    <LinearGradient colors={kind === 'task' ? ['#8F2728', '#F34144'] : ['#0F1F4A', '#4065CB']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.bar, !!control && { paddingRight: 44 }]}>
      <Text numberOfLines={2} style={[styles.title, completed && styles.completed]}>{title}</Text>{control}
    </LinearGradient>
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 39, gap: 4 },
  date: { width: 52, alignItems: 'center', justifyContent: 'center' },
  primary: { fontFamily: fonts.suggestionTitle, fontSize: 13, lineHeight: 17, color: '#B3BDCB', textAlign: 'center', includeFontPadding: false },
  secondary: { fontFamily: fonts.suggestionBody, fontSize: 13, lineHeight: 15, color: '#B3BDCB', textAlign: 'center', includeFontPadding: false },
  bar: { flex: 1, minHeight: 39, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingLeft: 12, paddingRight: 12, paddingVertical: 3 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, textAlign: 'center', color: '#F1F1F1', includeFontPadding: false },
  completed: { textDecorationLine: 'line-through' },
});
