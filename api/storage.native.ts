import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';

// Supabase sessions can exceed SecureStore's per-value limits on some devices.
const CHUNK_SIZE = 500;
const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
type Manifest = { revision: string; count: number };
let pending: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = pending.then(operation, operation);
  pending = next.catch(() => undefined);
  return next;
}

async function manifest(key: string): Promise<Manifest | null> {
  const value = await SecureStore.getItemAsync(key, options);
  return value ? JSON.parse(value) as Manifest : null;
}

async function removeChunks(key: string, stored: Manifest | null) {
  if (!stored) return;
  for (let i = 0; i < stored.count; i++) {
    await SecureStore.deleteItemAsync(`${key}.${stored.revision}.${i}`, options);
  }
}

export const authStorage = {
  getItem(key: string): Promise<string | null> {
    return serialize(async () => {
      const stored = await manifest(key);
      if (!stored) return null;
      const chunks: string[] = [];
      for (let i = 0; i < stored.count; i++) {
        const chunk = await SecureStore.getItemAsync(`${key}.${stored.revision}.${i}`, options);
        if (chunk === null) return null;
        chunks.push(chunk);
      }
      return chunks.join('');
    });
  },
  setItem(key: string, value: string): Promise<void> {
    return serialize(async () => {
      const previous = await manifest(key);
      const characters = Array.from(value);
      const stored = { revision: randomUUID(), count: Math.ceil(characters.length / CHUNK_SIZE) };
      for (let i = 0; i < stored.count; i++) {
        await SecureStore.setItemAsync(`${key}.${stored.revision}.${i}`, characters.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE).join(''), options);
      }
      // Commit only once every chunk has been written.
      await SecureStore.setItemAsync(key, JSON.stringify(stored), options);
      await removeChunks(key, previous);
    });
  },
  removeItem(key: string): Promise<void> {
    return serialize(async () => {
      const stored = await manifest(key);
      await SecureStore.deleteItemAsync(key, options);
      await removeChunks(key, stored);
    });
  },
};

export const canPersistSession = true;
