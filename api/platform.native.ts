import 'react-native-url-polyfill/auto';
import * as ExpoCrypto from 'expo-crypto';

// Supply the primitives Supabase's PKCE flow needs when Hermes lacks WebCrypto.
// This avoids the SDK falling back to Math.random() and a plain code challenge.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues: ExpoCrypto.getRandomValues,
      randomUUID: ExpoCrypto.randomUUID,
      subtle: {
        digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
          const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
          if (name.toUpperCase() !== 'SHA-256') throw new Error('This native PKCE adapter supports SHA-256 only.');
          return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, data);
        },
      },
    },
  });
}
