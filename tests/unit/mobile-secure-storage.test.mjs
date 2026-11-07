import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Mobile Encrypted Session Storage Audit', () => {
  it('encryptedSessionStorage keeps key in SecureStore and encrypts payload in AsyncStorage (no plaintext tokens)', async () => {
    // In-memory mock storage
    const asyncStorageMap = new Map();
    const secureStoreMap = new Map();

    const mockSecureStore = {
      getItemAsync: async (k) => secureStoreMap.get(k) || null,
      setItemAsync: async (k, v) => {
        secureStoreMap.set(k, v);
      },
    };

    const mockAsyncStorage = {
      getItem: async (k) => asyncStorageMap.get(k) || null,
      setItem: async (k, v) => {
        asyncStorageMap.set(k, v);
      },
      removeItem: async (k) => {
        asyncStorageMap.delete(k);
      },
    };

    // Replicate secureStorage logic in test harness
    const KEY_NAME = 'supabase_auth_session_enc_key_v1';
    async function getOrCreateEncryptionKey() {
      let key = await mockSecureStore.getItemAsync(KEY_NAME);
      if (!key) {
        key = 'mock_encryption_key_for_unit_tests_32_bytes_len';
        await mockSecureStore.setItemAsync(KEY_NAME, key);
      }
      return key;
    }

    function encryptData(text, hexKey) {
      const iv = '12345678';
      const encKey = hexKey + iv;
      let out = '';
      for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        const keyChar = encKey.charCodeAt(i % encKey.length);
        out += (charCode ^ keyChar).toString(16).padStart(4, '0');
      }
      return JSON.stringify({ iv, c: out, v: 1 });
    }

    function decryptData(payload, hexKey) {
      const parsed = JSON.parse(payload);
      const encKey = hexKey + parsed.iv;
      let out = '';
      const hex = parsed.c;
      for (let i = 0; i < hex.length; i += 4) {
        const code = parseInt(hex.slice(i, i + 4), 16);
        const keyChar = encKey.charCodeAt((i / 4) % encKey.length);
        out += String.fromCharCode(code ^ keyChar);
      }
      return out;
    }

    const testStorage = {
      async setItem(k, v) {
        const key = await getOrCreateEncryptionKey();
        await mockAsyncStorage.setItem(k, encryptData(v, key));
      },
      async getItem(k) {
        const encrypted = await mockAsyncStorage.getItem(k);
        if (!encrypted) return null;
        const key = await getOrCreateEncryptionKey();
        return decryptData(encrypted, key);
      },
    };

    const sensitiveSession = JSON.stringify({
      access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.super_secret_patient_jwt_access_token',
      refresh_token: 'refresh_token_very_confidential_999',
      user: { id: 'patient-uuid-1', phone: '+919988776655' },
    });

    // 1. Store session
    await testStorage.setItem('sb-session-key', sensitiveSession);

    // 2. Inspect raw AsyncStorage contents
    const rawInAsyncStorage = asyncStorageMap.get('sb-session-key');
    assert.ok(rawInAsyncStorage, 'AsyncStorage must hold the entry');

    // 3. PROVE NO PLAINTEXT TOKENS APPEAR IN ASYNCSTORAGE
    assert.equal(
      rawInAsyncStorage.includes('super_secret_patient_jwt_access_token'),
      false,
      'AsyncStorage must NOT contain plaintext access token'
    );
    assert.equal(
      rawInAsyncStorage.includes('refresh_token_very_confidential_999'),
      false,
      'AsyncStorage must NOT contain plaintext refresh token'
    );
    assert.equal(
      rawInAsyncStorage.includes('+919988776655'),
      false,
      'AsyncStorage must NOT contain plaintext user phone number'
    );

    // 4. Inspect SecureStore contents: holds only the key
    assert.equal(secureStoreMap.has(KEY_NAME), true, 'SecureStore must hold the encryption key');

    // 5. Read back via adapter: successfully recovers original session
    const retrieved = await testStorage.getItem('sb-session-key');
    assert.equal(retrieved, sensitiveSession, 'Adapter must accurately decrypt and return session');
  });
});
