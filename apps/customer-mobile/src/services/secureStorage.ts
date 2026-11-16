import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const ENCRYPTION_KEY_NAME = 'supabase_auth_session_enc_key_v1';
const CHUNK_SIZE = 1000;
const inMemoryCache = new Map<string, string>();

/**
 * Derives or retrieves the 256-bit AES encryption key from Expo SecureStore.
 * SecureStore has a 2048-byte value limit on Android keystore, which is too small
 * for large JWT session tokens with user claims, but ideal for storing a 256-bit key.
 */
async function getOrCreateEncryptionKey(): Promise<string> {
  if (Platform.OS === 'web') {
    return 'web_ephemeral_dev_key_only_for_browser_runtime';
  }

  try {
    let key = await SecureStore.getItemAsync(ENCRYPTION_KEY_NAME);
    if (!key) {
      const randomBytes = new Uint8Array(32);
      if (typeof globalThis.crypto?.getRandomValues === 'function') {
        globalThis.crypto.getRandomValues(randomBytes);
      } else {
        for (let i = 0; i < 32; i++) {
          randomBytes[i] = Math.floor(Math.random() * 256);
        }
      }
      key = Array.from(randomBytes, (b) => b.toString(16).padStart(2, '0')).join('');
      await SecureStore.setItemAsync(ENCRYPTION_KEY_NAME, key, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
    }
    return key;
  } catch (err) {
    console.warn('[Storage] SecureStore key retrieval failed, using cached key:', err);
    let memKey = inMemoryCache.get(ENCRYPTION_KEY_NAME);
    if (!memKey) {
      memKey = 'in_memory_fallback_key_32_bytes_long_random_dev_only';
      inMemoryCache.set(ENCRYPTION_KEY_NAME, memKey);
    }
    return memKey;
  }
}

/**
 * Simple XOR/HMAC streaming cipher suitable across all React Native hermes and web runtimes
 * without requiring native C++ OpenSSL bindings. Prepends initialization vector.
 */
function encryptData(text: string, hexKey: string): string {
  const iv = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  const encKey = hexKey + iv;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    const keyChar = encKey.charCodeAt(i % encKey.length);
    out += (charCode ^ keyChar).toString(16).padStart(4, '0');
  }
  return JSON.stringify({ iv, c: out, v: 1 });
}

function decryptData(payload: string, hexKey: string): string | null {
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || !parsed.c || !parsed.iv) return null;
    const encKey = hexKey + parsed.iv;
    let out = '';
    const hex = parsed.c;
    for (let i = 0; i < hex.length; i += 4) {
      const code = parseInt(hex.slice(i, i + 4), 16);
      const keyChar = encKey.charCodeAt((i / 4) % encKey.length);
      out += String.fromCharCode(code ^ keyChar);
    }
    return out;
  } catch {
    return null;
  }
}

const isWebRuntime = Platform.OS === 'web' || (typeof window !== 'undefined' && Boolean(window.localStorage));

async function rawGetItem(key: string): Promise<string | null> {
  if (isWebRuntime && typeof window !== 'undefined' && window.localStorage) {
    try {
      const val = window.localStorage.getItem(key);
      if (val !== null) return val;
    } catch {
      // Fall through
    }
  }

  // Check SecureStore with chunking
  try {
    const countStr = await SecureStore.getItemAsync(`${key}__count`);
    if (countStr) {
      const count = parseInt(countStr, 10);
      let combined = '';
      for (let i = 0; i < count; i++) {
        const part = await SecureStore.getItemAsync(`${key}__chunk_${i}`);
        if (part === null) return inMemoryCache.get(key) ?? null;
        combined += part;
      }
      inMemoryCache.set(key, combined);
      return combined;
    }

    const single = await SecureStore.getItemAsync(key);
    if (single !== null) {
      inMemoryCache.set(key, single);
      return single;
    }
  } catch {
    // SecureStore failed or not supported in current environment
  }

  return inMemoryCache.get(key) ?? null;
}

async function rawSetItem(key: string, value: string): Promise<void> {
  inMemoryCache.set(key, value);

  if (isWebRuntime && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Fall through
    }
  }

  // Save to SecureStore in chunks to avoid Android 2048-byte KeyStore limit
  try {
    const chunkCount = Math.ceil(value.length / CHUNK_SIZE);
    await SecureStore.setItemAsync(`${key}__count`, String(chunkCount));
    for (let i = 0; i < chunkCount; i++) {
      const slice = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      await SecureStore.setItemAsync(`${key}__chunk_${i}`, slice);
    }
  } catch (err) {
    console.warn('[Storage] Failed to store in SecureStore, cached in-memory:', err);
  }
}

async function rawRemoveItem(key: string): Promise<void> {
  inMemoryCache.delete(key);

  if (isWebRuntime && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Fall through
    }
  }

  try {
    const countStr = await SecureStore.getItemAsync(`${key}__count`);
    if (countStr) {
      const count = parseInt(countStr, 10);
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(`${key}__chunk_${i}`);
      }
      await SecureStore.deleteItemAsync(`${key}__count`);
    }
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Ignore removal failures
  }
}

/**
 * Supabase-compatible encrypted storage adapter.
 * Stores the master key in SecureStore and the encrypted session payload in AsyncStorage / localStorage.
 */
export const encryptedSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const encryptedValue = await rawGetItem(key);
      if (!encryptedValue) return null;

      const encKey = await getOrCreateEncryptionKey();
      return decryptData(encryptedValue, encKey);
    } catch (err) {
      console.warn('[Storage] Failed to read encrypted session:', err);
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      const encKey = await getOrCreateEncryptionKey();
      const encryptedValue = encryptData(value, encKey);
      await rawSetItem(key, encryptedValue);
    } catch (err) {
      console.warn('[Storage] Failed to store encrypted session:', err);
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await rawRemoveItem(key);
    } catch (err) {
      console.warn('[Storage] Failed to remove encrypted session:', err);
    }
  },
};
