import 'server-only';

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

import { env } from '@/server/env';
import { logger } from '@/server/logger';
import { CARD_LINK_PATH } from '@/shared/contracts/cards';

/*
 * The token behind the link a member's QR opens (docs/adr/0032-card-link-and-stickers.md). It is
 * a capability, handled exactly like a committee's view token (docs/adr/0023): 192 random bits;
 * the database keeps an HMAC of it, which is what a request is looked up by, and an AES-256-GCM
 * copy so the QR can be drawn again. Both are useless without VIEW_LINK_SECRET, and the copy is
 * bound to the membership it belongs to, so a row moved onto another member does not decrypt.
 * They use their own labels, so a committee's token can never open a card or the other way round.
 */

const TOKEN_BYTES = 24;
const KEY_INFO = 'member-card-token-v1';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function generateCardToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** The lookup key for a token. The same token always gives the same key. */
export function cardTokenHash(token: string): string {
  return createHmac('sha256', env.VIEW_LINK_SECRET).update(`member-card:${token}`).digest('hex');
}

function encryptionKey(): Buffer {
  return Buffer.from(hkdfSync('sha256', env.VIEW_LINK_SECRET, '', KEY_INFO, 32));
}

/** `nonce ‖ tag ‖ ciphertext`, bound to the membership it belongs to. */
export function encryptCardToken(token: string, membershipId: string): Uint8Array<ArrayBuffer> {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(membershipId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return new Uint8Array(Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]));
}

/** The token back, or null when the bytes cannot be read (another secret, another member, damage). */
export function decryptCardToken(cipher: Uint8Array, membershipId: string): string | null {
  try {
    const bytes = Buffer.from(cipher);
    const nonce = bytes.subarray(0, NONCE_BYTES);
    const tag = bytes.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
    const ciphertext = bytes.subarray(NONCE_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), nonce, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(membershipId, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Neither personal data nor the member's doing; log the membership, never the bytes.
    logger.warn('A card token could not be decrypted', { membershipId });
    return null;
  }
}

/** The address the QR holds. */
export function cardLinkUrl(token: string): string {
  return `${env.APP_ORIGIN}${CARD_LINK_PATH}/${token}`;
}

/** A fresh token and the three values a card row stores for it. */
export function newCardToken(membershipId: string, now: Date) {
  const token = generateCardToken();
  return {
    token,
    hash: cardTokenHash(token),
    cipher: encryptCardToken(token, membershipId),
    createdAt: now,
  };
}
