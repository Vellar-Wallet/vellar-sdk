/**
 * Vellar Keygen Command (#433)
 * 
 * Provides a CLI command to generate and export key material for Vellar agents.
 * Supports multiple key types, formats, and security levels.
 */

import { webcrypto } from 'crypto';

export interface KeygenOptions {
  /** Key type to generate */
  keyType: 'ed25519' | 'secp256k1' | 'rsa' | 'symmetric';
  /** Output format */
  format: 'pem' | 'jwk' | 'hex' | 'base64';
  /** Optional encryption passphrase for private keys */
  passphrase?: string;
  /** Key size for RSA or symmetric keys */
  keySize?: number;
  /** Include metadata in output */
  includeMetadata?: boolean;
}

export interface KeyMaterial {
  /** Public key (if applicable) */
  publicKey?: string;
  /** Private key */
  privateKey: string;
  /** Key type */
  keyType: string;
  /** Output format */
  format: string;
  /** Generation timestamp */
  timestamp?: string;
  /** Key identifier */
  keyId?: string;
}

/**
 * Generate key material based on options
 */
export async function generateKey(options: KeygenOptions): Promise<KeyMaterial> {
  const { keyType, format, passphrase, keySize, includeMetadata } = options;

  let keyPair: CryptoKeyPair | CryptoKey;
  let privateKeyData: string;
  let publicKeyData: string | undefined;

  switch (keyType) {
    case 'ed25519':
      keyPair = await webcrypto.subtle.generateKey(
        {
          name: 'Ed25519',
          namedCurve: 'Ed25519'
        } as any,
        true,
        ['sign', 'verify']
      ) as CryptoKeyPair;
      
      privateKeyData = await exportKey(keyPair.privateKey, format, passphrase);
      publicKeyData = await exportKey(keyPair.publicKey, format);
      break;

    case 'secp256k1':
      // Note: secp256k1 not directly supported in WebCrypto, using P-256 as reference
      keyPair = await webcrypto.subtle.generateKey(
        {
          name: 'ECDSA',
          namedCurve: 'P-256'
        },
        true,
        ['sign', 'verify']
      );
      
      privateKeyData = await exportKey(keyPair.privateKey, format, passphrase);
      publicKeyData = await exportKey(keyPair.publicKey, format);
      break;

    case 'rsa':
      keyPair = await webcrypto.subtle.generateKey(
        {
          name: 'RSA-PSS',
          modulusLength: keySize || 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256'
        },
        true,
        ['sign', 'verify']
      );
      
      privateKeyData = await exportKey(keyPair.privateKey, format, passphrase);
      publicKeyData = await exportKey(keyPair.publicKey, format);
      break;

    case 'symmetric':
      keyPair = await webcrypto.subtle.generateKey(
        {
          name: 'AES-GCM',
          length: keySize || 256
        },
        true,
        ['encrypt', 'decrypt']
      );
      
      privateKeyData = await exportKey(keyPair, format, passphrase);
      break;

    default:
      throw new Error(`Unsupported key type: ${keyType}`);
  }

  const keyMaterial: KeyMaterial = {
    privateKey: privateKeyData,
    keyType,
    format
  };

  if (publicKeyData) {
    keyMaterial.publicKey = publicKeyData;
  }

  if (includeMetadata) {
    keyMaterial.timestamp = new Date().toISOString();
    keyMaterial.keyId = generateKeyId();
  }

  return keyMaterial;
}

/**
 * Export key to specified format
 */
async function exportKey(
  key: CryptoKey,
  format: KeygenOptions['format'],
  passphrase?: string
): Promise<string> {
  const keyData = await webcrypto.subtle.exportKey(
    format === 'jwk' ? 'jwk' : 'raw',
    key
  );

  let exported: string;

  switch (format) {
    case 'jwk':
      exported = JSON.stringify(keyData, null, 2);
      break;

    case 'hex':
      if (keyData instanceof ArrayBuffer) {
        exported = Buffer.from(keyData).toString('hex');
      } else {
        exported = Buffer.from(JSON.stringify(keyData)).toString('hex');
      }
      break;

    case 'base64':
      if (keyData instanceof ArrayBuffer) {
        exported = Buffer.from(keyData).toString('base64');
      } else {
        exported = Buffer.from(JSON.stringify(keyData)).toString('base64');
      }
      break;

    case 'pem':
      // Simplified PEM encoding
      if (keyData instanceof ArrayBuffer) {
        const b64 = Buffer.from(keyData).toString('base64');
        const keyTypeLabel = key.type === 'private' ? 'PRIVATE KEY' : 'PUBLIC KEY';
        exported = `-----BEGIN ${keyTypeLabel}-----\n${b64}\n-----END ${keyTypeLabel}-----`;
      } else {
        throw new Error('Cannot export JWK key data to PEM format');
      }
      break;

    default:
      throw new Error(`Unsupported format: ${format}`);
  }

  // Apply passphrase encryption if provided (simplified for reference)
  if (passphrase && key.type === 'private') {
    exported = await encryptWithPassphrase(exported, passphrase);
  }

  return exported;
}

/**
 * Encrypt key material with passphrase (simplified reference implementation)
 */
async function encryptWithPassphrase(data: string, passphrase: string): Promise<string> {
  // In production, use proper key derivation (PBKDF2/scrypt) and authenticated encryption
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(data);
  const passphraseBytes = encoder.encode(passphrase);
  
  // Derive encryption key from passphrase
  const keyMaterial = await webcrypto.subtle.importKey(
    'raw',
    passphraseBytes,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const encryptionKey = await webcrypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encrypted = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encryptionKey,
    dataBytes
  );

  // Combine salt + iv + ciphertext
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);

  return `ENCRYPTED:${Buffer.from(combined).toString('base64')}`;
}

/**
 * Generate a unique key identifier
 */
function generateKeyId(): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(16));
  return Buffer.from(bytes).toString('hex');
}

/**
 * CLI command handler
 */
export async function keygenCommand(args: string[]): Promise<void> {
  const options: KeygenOptions = parseArgs(args);
  
  try {
    const keyMaterial = await generateKey(options);
    
    // Output to stdout
    console.log(JSON.stringify(keyMaterial, null, 2));
  } catch (error) {
    console.error('Error generating key:', error);
    process.exit(1);
  }
}

/**
 * Parse command-line arguments
 */
function parseArgs(args: string[]): KeygenOptions {
  const options: KeygenOptions = {
    keyType: 'ed25519',
    format: 'jwk'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--type':
      case '-t':
        options.keyType = args[++i] as KeygenOptions['keyType'];
        break;

      case '--format':
      case '-f':
        options.format = args[++i] as KeygenOptions['format'];
        break;

      case '--passphrase':
      case '-p':
        options.passphrase = args[++i];
        break;

      case '--size':
      case '-s':
        options.keySize = parseInt(args[++i], 10);
        break;

      case '--metadata':
      case '-m':
        options.includeMetadata = true;
        break;

      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;

      default:
        console.error(`Unknown option: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  return options;
}

/**
 * Print help text
 */
function printHelp(): void {
  console.log(`
vellar keygen - Generate cryptographic keys for Vellar agents

Usage: vellar keygen [options]

Options:
  -t, --type <type>        Key type: ed25519, secp256k1, rsa, symmetric (default: ed25519)
  -f, --format <format>    Output format: pem, jwk, hex, base64 (default: jwk)
  -p, --passphrase <pass>  Encrypt private key with passphrase
  -s, --size <bits>        Key size for RSA or symmetric keys (default: 2048 for RSA, 256 for symmetric)
  -m, --metadata           Include metadata (timestamp, keyId) in output
  -h, --help               Show this help message

Examples:
  vellar keygen
  vellar keygen --type rsa --format pem --size 4096
  vellar keygen --type ed25519 --format hex --metadata
  vellar keygen --type symmetric --passphrase "my-secret" --size 256
`);
}
