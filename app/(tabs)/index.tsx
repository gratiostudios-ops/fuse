import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowCircleRightIcon, CaretDownIcon } from 'phosphor-react-native';
import { colors, fonts } from '../../src/theme';
import { supabase } from '../../src/lib/supabase';

async function askAI(message: string) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session) throw new Error('Please sign in before asking Fuse AI.');

  const { data, error } = await supabase.functions.invoke(
    'fuse-ai',
    { body: { message } }
  );

  if (error) throw error;

  if (typeof data?.message !== 'string' || !data.message.trim()) {
    throw new Error('Fuse AI returned an empty response. Please try again.');
  }
  return data.message;
}



export default function HomeScreen() {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);

  async function sendMessage() {
    const input = message.trim();
    if (!input || sending.current) return;
    sending.current = true;
    setLoading(true);
    setError('');
    try {
      const reply = await askAI(input);
      setMessages(previous => [...previous, { role: 'user', text: input }, { role: 'assistant', text: reply }]);
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach Fuse AI. Please try again.');
    } finally {
      sending.current = false;
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.organizer}>
        <Text style={styles.organizerLabel}>Organizer</Text>
        <CaretDownIcon size={17} color={colors.foreground} style={styles.caret} />
      </View>
      <View style={styles.blankBody}>
        {messages.map((item, index) => (
          <View key={index} style={styles.message}>
            <Text style={styles.messageLabel}>{item.role === 'user' ? 'You' : 'Fuse'}</Text>
            <Text style={styles.messageText}>{item.text}</Text>
          </View>
        ))}
        {loading && <Text style={styles.messageText}>Thinking…</Text>}
        {!!error && <Text accessibilityRole="alert" style={styles.messageText}>{error}</Text>}
      </View>
      <View style={styles.composer} accessibilityLabel="Chat composer">
        <View style={styles.input}>
          <TextInput style={styles.placeholder} placeholder="Ask anything" placeholderTextColor={colors.placeholder}
            accessibilityLabel="Message to Fuse AI" value={message} onChangeText={setMessage}
            maxLength={2000} editable={!loading} returnKeyType="send" onSubmitEditing={sendMessage} />
          <Pressable accessibilityRole="button" accessibilityLabel="Send message"
            disabled={loading || !message.trim()} onPress={sendMessage}>
            <ArrowCircleRightIcon size={36} weight="fill" color={loading || !message.trim() ? '#E8E8E8' : colors.foreground} />
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, minHeight: 180, paddingBottom: 7 },
  organizer: { height: 31, marginLeft: 24, marginRight: 25, borderBottomWidth: 1, borderBottomColor: colors.divider, flexDirection: 'row', justifyContent: 'space-between' },
  organizerLabel: { marginLeft: 3, fontFamily: fonts.medium, fontSize: 14, lineHeight: 17, color: colors.foreground, includeFontPadding: false },
  caret: { marginTop: 5, marginRight: 4 },
  blankBody: { flex: 1, minHeight: 40, padding: 24, gap: 16 },
  message: { gap: 4 },
  messageLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.placeholder },
  messageText: { fontFamily: fonts.regular, fontSize: 14, color: colors.foreground },
  composer: { height: 71, marginLeft: 16, marginRight: 17, paddingLeft: 9, paddingRight: 8, paddingTop: 10, paddingBottom: 9, backgroundColor: colors.composer, borderRadius: 33 },
  input: { height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.0784314)', paddingLeft: 16, paddingRight: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  placeholder: { flex: 1, marginRight: 8, fontFamily: fonts.regular, fontSize: 14, color: colors.foreground, includeFontPadding: false },
});
