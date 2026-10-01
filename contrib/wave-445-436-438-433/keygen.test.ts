/**
 * Tests for Vellar Keygen Command (#433)
 */

import { describe, it, expect } from 'vitest';
import { generateKey, type KeygenOptions } from './keygen';

describe('keygen', () => {
  describe('generateKey', () => {
    it('should generate ed25519 key pair in JWK format', async () => {
      const options: KeygenOptions = {
        keyType: 'ed25519',
        format: 'jwk'
      };

      const result = await generateKey(options);

      expect(result).toHaveProperty('privateKey');
      expect(result).toHaveProperty('publicKey');
      expect(result.keyType).toBe('ed25519');
      expect(result.format).toBe('jwk');

      // Verify JWK format
      const privateJwk = JSON.parse(result.privateKey);
      expect(privateJwk).toHaveProperty('kty');
    });

    it('should generate secp256k1 key pair in hex format', async () => {
      const options: KeygenOptions = {
        keyType: 'secp256k1',
        format: 'hex'
      };

      const result = await generateKey(options);

      expect(result).toHaveProperty('privateKey');
      expect(result).toHaveProperty('publicKey');
      expect(result.keyType).toBe('secp256k1');
      expect(result.format).toBe('hex');

      // Verify hex format
      expect(result.privateKey).toMatch(/^[0-9a-f]+$/i);
      expect(result.publicKey).toMatch(/^[0-9a-f]+$/i);
    });

    it('should generate RSA key pair in PEM format', async () => {
      const options: KeygenOptions = {
        keyType: 'rsa',
        format: 'pem',
        keySize: 2048
      };

      const result = await generateKey(options);

      expect(result).toHaveProperty('privateKey');
      expect(result).toHaveProperty('publicKey');
      expect(result.keyType).toBe('rsa');
      expect(result.format).toBe('pem');

      // Verify PEM format
      expect(result.privateKey).toContain('-----BEGIN PRIVATE KEY-----');
      expect(result.privateKey).toContain('-----END PRIVATE KEY-----');
      expect(result.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
      expect(result.publicKey).toContain('-----END PUBLIC KEY-----');
    });

    it('should generate symmetric key in base64 format', async () => {
      const options: KeygenOptions = {
        keyType: 'symmetric',
        format: 'base64',
        keySize: 256
      };

      const result = await generateKey(options);

      expect(result).toHaveProperty('privateKey');
      expect(result).not.toHaveProperty('publicKey'); // Symmetric keys have no public key
      expect(result.keyType).toBe('symmetric');
      expect(result.format).toBe('base64');

      // Verify base64 format
      expect(result.privateKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('should include metadata when requested', async () => {
      const options: KeygenOptions = {
        keyType: 'ed25519',
        format: 'jwk',
        includeMetadata: true
      };

      const result = await generateKey(options);

      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('keyId');
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(result.keyId).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should encrypt private key with passphrase', async () => {
      const options: KeygenOptions = {
        keyType: 'ed25519',
        format: 'jwk',
        passphrase: 'test-passphrase-123'
      };

      const result = await generateKey(options);

      expect(result.privateKey).toContain('ENCRYPTED:');
      // Public key should not be encrypted
      expect(result.publicKey).not.toContain('ENCRYPTED:');
    });

    it('should generate different keys on each invocation', async () => {
      const options: KeygenOptions = {
        keyType: 'ed25519',
        format: 'hex'
      };

      const result1 = await generateKey(options);
      const result2 = await generateKey(options);

      expect(result1.privateKey).not.toBe(result2.privateKey);
      expect(result1.publicKey).not.toBe(result2.publicKey);
    });

    it('should respect custom RSA key size', async () => {
      const options: KeygenOptions = {
        keyType: 'rsa',
        format: 'jwk',
        keySize: 4096
      };

      const result = await generateKey(options);

      // Verify key size in JWK
      const privateJwk = JSON.parse(result.privateKey);
      expect(privateJwk).toHaveProperty('n'); // RSA modulus
      
      // Base64-decoded modulus length should be approximately keySize / 8 bytes
      const modulusBytes = Buffer.from(privateJwk.n, 'base64').length;
      expect(modulusBytes).toBeGreaterThanOrEqual(512); // 4096 bits = 512 bytes
    });

    it('should respect custom symmetric key size', async () => {
      const options: KeygenOptions = {
        keyType: 'symmetric',
        format: 'base64',
        keySize: 128
      };

      const result = await generateKey(options);

      // Verify key length (128 bits = 16 bytes, base64 encoded = ~24 chars)
      const keyBytes = Buffer.from(result.privateKey, 'base64').length;
      expect(keyBytes).toBe(16);
    });

    it('should throw error for unsupported key type', async () => {
      const options: KeygenOptions = {
        keyType: 'unsupported' as any,
        format: 'jwk'
      };

      await expect(generateKey(options)).rejects.toThrow('Unsupported key type');
    });

    it('should handle all format combinations for ed25519', async () => {
      const formats: Array<KeygenOptions['format']> = ['pem', 'jwk', 'hex', 'base64'];

      for (const format of formats) {
        const options: KeygenOptions = {
          keyType: 'ed25519',
          format
        };

        const result = await generateKey(options);
        expect(result.format).toBe(format);
        expect(result.privateKey).toBeTruthy();
      }
    });

    it('should generate valid key material for all supported key types', async () => {
      const keyTypes: Array<KeygenOptions['keyType']> = ['ed25519', 'secp256k1', 'rsa', 'symmetric'];

      for (const keyType of keyTypes) {
        const options: KeygenOptions = {
          keyType,
          format: 'jwk'
        };

        const result = await generateKey(options);
        expect(result.keyType).toBe(keyType);
        expect(result.privateKey).toBeTruthy();
      }
    });

    it('should generate unique keyIds for each key', async () => {
      const options: KeygenOptions = {
        keyType: 'ed25519',
        format: 'jwk',
        includeMetadata: true
      };

      const result1 = await generateKey(options);
      const result2 = await generateKey(options);

      expect(result1.keyId).toBeTruthy();
      expect(result2.keyId).toBeTruthy();
      expect(result1.keyId).not.toBe(result2.keyId);
    });
  });

  describe('output formats', () => {
    it('should produce valid PEM format', async () => {
      const options: KeygenOptions = {
        keyType: 'rsa',
        format: 'pem'
      };

      const result = await generateKey(options);

      // PEM format validation
      const pemRegex = /^-----BEGIN (PRIVATE|PUBLIC) KEY-----\n[A-Za-z0-9+/=\n]+-----END (PRIVATE|PUBLIC) KEY-----$/;
      expect(result.privateKey).toMatch(pemRegex);
      expect(result.publicKey).toMatch(pemRegex);
    });

    it('should produce valid JWK format', async () => {
      const options: KeygenOptions = {
        keyType: 'ed25519',
        format: 'jwk'
      };

      const result = await generateKey(options);

      // JWK format validation
      expect(() => JSON.parse(result.privateKey)).not.toThrow();
      expect(() => JSON.parse(result.publicKey!)).not.toThrow();

      const jwk = JSON.parse(result.privateKey);
      expect(jwk).toHaveProperty('kty');
    });

    it('should produce valid hex format', async () => {
      const options: KeygenOptions = {
        keyType: 'ed25519',
        format: 'hex'
      };

      const result = await generateKey(options);

      // Hex format validation
      expect(result.privateKey).toMatch(/^[0-9a-f]+$/i);
      expect(result.publicKey).toMatch(/^[0-9a-f]+$/i);
    });

    it('should produce valid base64 format', async () => {
      const options: KeygenOptions = {
        keyType: 'symmetric',
        format: 'base64'
      };

      const result = await generateKey(options);

      // Base64 format validation
      expect(result.privateKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(() => Buffer.from(result.privateKey, 'base64')).not.toThrow();
    });
  });

  describe('passphrase encryption', () => {
    it('should encrypt and mark private keys with passphrase', async () => {
      const options: KeygenOptions = {
        keyType: 'ed25519',
        format: 'base64',
        passphrase: 'secure-passphrase'
      };

      const result = await generateKey(options);

      expect(result.privateKey).toContain('ENCRYPTED:');
      expect(result.privateKey.startsWith('ENCRYPTED:')).toBe(true);
    });

    it('should not encrypt public keys', async () => {
      const options: KeygenOptions = {
        keyType: 'rsa',
        format: 'pem',
        passphrase: 'secure-passphrase'
      };

      const result = await generateKey(options);

      expect(result.privateKey).toContain('ENCRYPTED:');
      expect(result.publicKey).not.toContain('ENCRYPTED:');
    });

    it('should produce different encrypted outputs for same key with different passphrases', async () => {
      const baseOptions: KeygenOptions = {
        keyType: 'ed25519',
        format: 'hex'
      };

      const result1 = await generateKey({ ...baseOptions, passphrase: 'pass1' });
      const result2 = await generateKey({ ...baseOptions, passphrase: 'pass2' });

      // Even if the underlying keys were the same (they won't be), encryption should differ
      expect(result1.privateKey).not.toBe(result2.privateKey);
    });
  });

  describe('edge cases', () => {
    it('should handle minimum RSA key size', async () => {
      const options: KeygenOptions = {
        keyType: 'rsa',
        format: 'jwk',
        keySize: 2048
      };

      const result = await generateKey(options);
      expect(result.privateKey).toBeTruthy();
    });

    it('should handle symmetric key with metadata and passphrase', async () => {
      const options: KeygenOptions = {
        keyType: 'symmetric',
        format: 'base64',
        keySize: 256,
        passphrase: 'test',
        includeMetadata: true
      };

      const result = await generateKey(options);

      expect(result.privateKey).toContain('ENCRYPTED:');
      expect(result.timestamp).toBeTruthy();
      expect(result.keyId).toBeTruthy();
    });

    it('should not include metadata by default', async () => {
      const options: KeygenOptions = {
        keyType: 'ed25519',
        format: 'jwk'
      };

      const result = await generateKey(options);

      expect(result.timestamp).toBeUndefined();
      expect(result.keyId).toBeUndefined();
    });
  });
});
