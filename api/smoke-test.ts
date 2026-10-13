import { config } from 'dotenv';
import WebSocket from 'ws';

// Node 20 doesn't expose WebSocket globally; native Expo builds do.
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;

config({ path: ['.env.local', '.env'] });

async function main() {
  // Import after loading env files so Expo-style public variables are available.
  const [{ getSuggestions }, { getSupabaseClient }] = await Promise.all([
    import('./suggestions'),
    import('./supabase'),
  ]);

  const client = getSupabaseClient();
  const topicId = process.argv[2];
  let topics: { id: string; name: string }[] = topicId ? [{ id: topicId, name: 'requested topic' }] : [];
  if (!topicId) {
    const { data, error } = await client.from('topics').select('id,name').order('name');
    if (error) throw error;
    topics = data ?? [];
  }

  if (topics.length === 0) {
    throw new Error('No readable topics found. Check the Data API and topic SELECT policy.');
  }

  let populatedTopicCount = 0;
  for (const topic of topics) {
    const suggestions = await getSuggestions({ topicId: topic.id });
    if (suggestions.length > 0) populatedTopicCount++;
    console.log(`\n${topic.name} (${topic.id}): ${suggestions.length} active suggestion(s)`);
    for (const suggestion of suggestions) {
      console.log(`- ${suggestion.title} [${suggestion.id}]`);
    }
    if (topicId) break;
  }

  if (!topicId && populatedTopicCount === 0) {
    console.log('\nNo active suggestions are linked to any readable topic yet.');
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
