import { describe, expect, it } from 'vitest';

import { parseServerEnv } from '../env';

const valid = {
  DATABASE_URL: 'postgresql://user:secret@localhost:5432/digital_minds',
  ALLOWED_EMAIL_DOMAINS: 'uqu.edu.sa',
};

const apple = {
  WALLET_PASS_TYPE_ID: 'pass.org.example.digitalminds',
  WALLET_TEAM_ID: 'ABCDE12345',
  WALLET_SIGNER_CERT: '-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----',
  WALLET_SIGNER_KEY: '-----BEGIN PRIVATE KEY-----\nBBB\n-----END PRIVATE KEY-----',
  WALLET_WWDR_CERT: '-----BEGIN CERTIFICATE-----\nCCC\n-----END CERTIFICATE-----',
};

const google = {
  GOOGLE_WALLET_ISSUER_ID: '3388000000012345678',
  GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: 'wallet@digital-minds.iam.gserviceaccount.com',
  GOOGLE_WALLET_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nDDD\n-----END PRIVATE KEY-----',
};

describe('wallet settings', () => {
  it('leave both wallets off when nothing is set, so the app still runs', () => {
    expect(parseServerEnv(valid)).toMatchObject({ WALLET: null, GOOGLE_WALLET: null });
  });

  it('read the Apple settings as PEM, as written or base64-encoded on one line', () => {
    const plain = parseServerEnv({ ...valid, ...apple });
    expect(plain.WALLET?.signerCert).toContain('BEGIN CERTIFICATE');
    const encoded = parseServerEnv({
      ...valid,
      ...apple,
      WALLET_SIGNER_KEY: Buffer.from(apple.WALLET_SIGNER_KEY).toString('base64'),
    });
    expect(encoded.WALLET?.signerKey).toBe(apple.WALLET_SIGNER_KEY);
  });

  it('refuse half of the Apple settings, and say which are missing', () => {
    expect(() =>
      parseServerEnv({ ...valid, WALLET_PASS_TYPE_ID: apple.WALLET_PASS_TYPE_ID }),
    ).toThrow(/WALLET_TEAM_ID is required when any other WALLET_\* signing variable is set/);
  });

  it('read the Google settings, with the key as written or base64-encoded', () => {
    const plain = parseServerEnv({ ...valid, ...google });
    expect(plain.GOOGLE_WALLET).toMatchObject({
      issuerId: google.GOOGLE_WALLET_ISSUER_ID,
      serviceAccountEmail: google.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL,
    });
    const encoded = parseServerEnv({
      ...valid,
      ...google,
      GOOGLE_WALLET_PRIVATE_KEY: Buffer.from(google.GOOGLE_WALLET_PRIVATE_KEY).toString('base64'),
    });
    expect(encoded.GOOGLE_WALLET?.privateKey).toBe(google.GOOGLE_WALLET_PRIVATE_KEY);
  });

  it('refuse half of the Google settings', () => {
    expect(() =>
      parseServerEnv({ ...valid, GOOGLE_WALLET_ISSUER_ID: google.GOOGLE_WALLET_ISSUER_ID }),
    ).toThrow(/GOOGLE_WALLET_PRIVATE_KEY is required when any other GOOGLE_WALLET_\* variable/);
  });

  it('refuse a plain http origin when Google Wallet is on, since Google fetches the pictures from it', () => {
    expect(() => parseServerEnv({ ...valid, ...google, APP_ORIGIN: 'http://example.org' })).toThrow(
      /APP_ORIGIN must be https when Google Wallet is set up/,
    );
    expect(
      parseServerEnv({ ...valid, ...google, APP_ORIGIN: 'https://example.org' }).GOOGLE_WALLET,
    ).not.toBeNull();
  });

  it('keep the two wallets independent', () => {
    expect(parseServerEnv({ ...valid, ...apple })).toMatchObject({ GOOGLE_WALLET: null });
    expect(parseServerEnv({ ...valid, ...google })).toMatchObject({ WALLET: null });
  });
});
