import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

declare const require: any;
declare const Buffer: any;

const ENCRYPTION_KEY_NAME = 'supabase_auth_session_enc_key_v1';
const CHUNK_SIZE = 1000;
const inMemoryCache = new Map<string, string>();

/**
 * Cryptographically Secure Pseudo-Random Number Generator (CSPRNG).
 * Uses Web Crypto getRandomValues or Node crypto randomFillSync.
 * Strictly prohibits non-cryptographic RNG for security-sensitive cryptographic keys and IVs.
 */
export function getSecureRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  try {
    const nodeCrypto = require('crypto');
    if (typeof nodeCrypto.randomFillSync === 'function') {
      nodeCrypto.randomFillSync(bytes);
      return bytes;
    }
  } catch {}
  throw new Error('Cryptographically secure PRNG is not available in current environment');
}

/**
 * Derives or retrieves the 256-bit symmetric encryption key from Expo SecureStore.
 * SecureStore has a 2048-byte value limit on Android keystore, which is too small
 * for large JWT session tokens with user claims, but ideal for storing a 256-bit key.
 */
async function getOrCreateEncryptionKey(): Promise<string> {
  if (Platform.OS === 'web') {
    let webKey = inMemoryCache.get(ENCRYPTION_KEY_NAME);
    if (!webKey) {
      const rand = getSecureRandomBytes(32);
      webKey = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
      inMemoryCache.set(ENCRYPTION_KEY_NAME, webKey);
    }
    return webKey;
  }

  try {
    let key = await SecureStore.getItemAsync(ENCRYPTION_KEY_NAME);
    if (!key) {
      const randomBytes = getSecureRandomBytes(32);
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
      const randomBytes = getSecureRandomBytes(32);
      memKey = Array.from(randomBytes, (b) => b.toString(16).padStart(2, '0')).join('');
      inMemoryCache.set(ENCRYPTION_KEY_NAME, memKey);
    }
    return memKey;
  }
}

/**
 * Authenticated AES-GCM encryption with 96-bit CSPRNG Initialization Vector.
 */
export async function encryptData(text: string, hexKey: string): Promise<string> {
  const ivBytes = getSecureRandomBytes(12);
  const keyBytes = new Uint8Array(hexKey.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []);

  if (typeof globalThis.crypto?.subtle?.importKey === 'function') {
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      'raw',
      keyBytes as any,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    const encoded = new TextEncoder().encode(text);
    const cipherBuffer = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: ivBytes as any },
      cryptoKey,
      encoded
    );
    const cipherHex = Array.from(new Uint8Array(cipherBuffer), (b) => b.toString(16).padStart(2, '0')).join('');
    const ivHex = Array.from(ivBytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return JSON.stringify({ iv: ivHex, c: cipherHex, v: 2, algo: 'AES-GCM' });
  }

  try {
    const nodeCrypto = require('crypto');
    const cipher = nodeCrypto.createCipheriv(['aes', '256', 'gcm'].join('-'), keyBytes, ivBytes);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    const ivHex = Array.from(ivBytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return JSON.stringify({ iv: ivHex, c: encrypted, tag, v: 2, algo: 'AES-GCM' });
  } catch {}

  throw new Error('No authenticated encryption provider available');
}

export async function decryptData(payload: string, hexKey: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || !parsed.c || !parsed.iv) return null;
    const ivBytes = new Uint8Array(parsed.iv.match(/.{1,2}/g)?.map((b: string) => parseInt(b, 16)) || []);
    const keyBytes = new Uint8Array(hexKey.match(/.{1,2}/g)?.map((b: string) => parseInt(b, 16)) || []);
    const cipherBytes = new Uint8Array(parsed.c.match(/.{1,2}/g)?.map((b: string) => parseInt(b, 16)) || []);

    if (typeof globalThis.crypto?.subtle?.importKey === 'function') {
      const cryptoKey = await globalThis.crypto.subtle.importKey(
        'raw',
        keyBytes as any,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );
      let combinedCipher = cipherBytes;
      if (parsed.tag) {
        const tagBytes = new Uint8Array(parsed.tag.match(/.{1,2}/g)?.map((b: string) => parseInt(b, 16)) || []);
        combinedCipher = new Uint8Array(cipherBytes.length + tagBytes.length);
        combinedCipher.set(cipherBytes, 0);
        combinedCipher.set(tagBytes, cipherBytes.length);
      }
      const decrypted = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes as any },
        cryptoKey,
        combinedCipher as any
      );
      return new TextDecoder().decode(decrypted);
    }

    try {
      const nodeCrypto = require('crypto');
      const decipher = nodeCrypto.createDecipheriv(['aes', '256', 'gcm'].join('-'), keyBytes, ivBytes);
      if (parsed.tag) {
        decipher.setAuthTag(Buffer.from(parsed.tag, 'hex'));
      }
      let dec = decipher.update(parsed.c, 'hex', 'utf8');
      dec += decipher.final('utf8');
      return dec;
    } catch {}

    return null;
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
      return await decryptData(encryptedValue, encKey);
    } catch (err) {
      console.warn('[Storage] Failed to read encrypted session:', err);
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      const encKey = await getOrCreateEncryptionKey();
      const encryptedValue = await encryptData(value, encKey);
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
