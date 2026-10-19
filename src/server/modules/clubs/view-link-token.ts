import 'server-only';

import { createHmac, createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import { env } from '@/server/env';
import { logger } from '@/server/logger';
import { VIEW_LINK_PATH, type CommitteeViewLink } from '@/shared/contracts/clubs';

/*
 * The token behind a committee's public view link (docs/adr/0023-committee-view-link.md).
 *
 * It is a capability: whoever holds it reads that committee's names and points, so it is treated
 * like a password that has to stay readable. Two derived values are stored, both useless without
 * VIEW_LINK_SECRET, which lives in the environment and not in the database:
 *
 *   viewTokenHash   HMAC-SHA256 of the token — what a request is looked up by. The HMAC is also
 *                   what keeps the lookup from leaking how close a guess was: the value compared
 *                   in the index is unrelated to the token the caller sent.
 *   viewTokenCipher the token under AES-256-GCM, so an officer can copy the link again later.
 *                   The committee's id is the additional data, so a row copied onto another
 *                   committee does not decrypt.
 *
 * Rotating VIEW_LINK_SECRET therefore invalidates every view link; officers renew them. It
 * defaults to AUTH_SECRET, so a deployment that sets only that one still works — and can later
 * give the links their own secret without touching anything else.
 */

/** 24 bytes = 192 bits, base64url: the 32 characters `viewTokenSchema` describes. */
const TOKEN_BYTES = 24;

const KEY_INFO = 'committee-view-token-v1';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function generateViewToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** The lookup key for a token. The same token always gives the same key. */
export function viewTokenHash(token: string): string {
  return createHmac('sha256', env.VIEW_LINK_SECRET).update(`committee-view:${token}`).digest('hex');
}

function encryptionKey(): Buffer {
  return Buffer.from(hkdfSync('sha256', env.VIEW_LINK_SECRET, '', KEY_INFO, 32));
}

/** `nonce ‖ tag ‖ ciphertext`, bound to the committee it belongs to. */
export function encryptViewToken(token: string, committeeId: string): Uint8Array<ArrayBuffer> {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(committeeId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return new Uint8Array(Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]));
}

/**
 * The token back, or null when the stored bytes cannot be read: a different VIEW_LINK_SECRET, another
 * committee's row, or a damaged value. A null means the officer is told there is no link to copy
 * and can create a new one — never a 500.
 */
export function decryptViewToken(cipher: Uint8Array, committeeId: string): string | null {
  try {
    const bytes = Buffer.from(cipher);
    const nonce = bytes.subarray(0, NONCE_BYTES);
    const tag = bytes.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
    const ciphertext = bytes.subarray(NONCE_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), nonce, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(committeeId, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Not personal data and not the caller's fault; log the committee, never the bytes.
    logger.warn('A committee view token could not be decrypted', { committeeId });
    return null;
  }
}

/** The link as the API answers it: the whole URL, so no client assembles it. */
export function toViewLink(token: string, createdAt: Date): CommitteeViewLink {
  return {
    url: `${env.APP_ORIGIN}${VIEW_LINK_PATH}/${token}`,
    token,
    createdAt: createdAt.toISOString(),
  };
}

/** What every committee without an active link answers. */
export const NO_VIEW_LINK: CommitteeViewLink = { url: null, token: null, createdAt: null };
