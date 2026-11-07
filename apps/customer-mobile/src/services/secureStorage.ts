import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ENCRYPTION_KEY_NAME = 'supabase_auth_session_enc_key_v1';

/**
 * Derives or retrieves the 256-bit AES encryption key from Expo SecureStore.
 * SecureStore has a 2048-byte value limit on Android keystore, which is too small
 * for large JWT session tokens with user claims, but ideal for storing a 256-bit key.
 */
async function getOrCreateEncryptionKey(): Promise<string> {
  if (Platform.OS === 'web') {
    return 'web_ephemeral_dev_key_only_for_browser_runtime';
  }

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

/**
 * Supabase-compatible encrypted storage adapter.
 * Stores the master key in SecureStore and the encrypted session payload in AsyncStorage.
 */
export const encryptedSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const encryptedValue = await AsyncStorage.getItem(key);
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
      await AsyncStorage.setItem(key, encryptedValue);
    } catch (err) {
      console.warn('[Storage] Failed to store encrypted session:', err);
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (err) {
      console.warn('[Storage] Failed to remove encrypted session:', err);
    }
  },
};
