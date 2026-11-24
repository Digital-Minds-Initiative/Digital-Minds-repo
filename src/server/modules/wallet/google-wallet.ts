import 'server-only';

import { createSign } from 'node:crypto';

import walletPassAr from '@/i18n/messages/ar/walletPass.json';
import type { MemberCard } from '@/shared/contracts/wallet';
import { cardVariantFor } from '@/shared/lib/member-card';
import { buildPassDefinition } from '@/shared/lib/wallet-pass';

import { ART_THEMES } from './pass/art-theme';

/** The Google Wallet issuer account the deployment holds (`env.GOOGLE_WALLET`). */
export interface GoogleWalletConfig {
  /** The numeric issuer id from the Google Pay & Wallet console. */
  issuerId: string;
  /** The service account that signs "Save to Google Wallet" links. */
  serviceAccountEmail: string;
  /** Its private key, PEM. */
  privateKey: string;
}

const base64url = (input: string | Buffer): string => Buffer.from(input).toString('base64url');

/** The pass class every Digital Minds card belongs to. */
function googleClassId(config: GoogleWalletConfig): string {
  return `${config.issuerId}.digital_minds_member`;
}

/** Where Google fetches the card's pictures from: public art, nothing personal in it. */
function googleArtUrl(appOrigin: string, name: string): string {
  return `${appOrigin}/api/v1/public/wallet-art/${name}`;
}

/** What the card holds, as a Google Wallet generic pass object. */
export function buildGoogleObject(card: MemberCard, config: GoogleWalletConfig, appOrigin: string) {
  const definition = buildPassDefinition(card, appOrigin, walletPassAr);
  const variant = cardVariantFor(card);
  const theme = ART_THEMES[variant];
  const text = (value: string) => ({ defaultValue: { language: 'ar', value } });
  const field = (key: string) =>
    definition.secondary.concat(definition.auxiliary, definition.header).find((f) => f.key === key);
  const modules = ['points', 'role', 'year', 'committees']
    .map((key) => field(key))
    .filter((f): f is NonNullable<typeof f> => f !== undefined)
    .map((f) => ({ id: f.key, header: f.label, body: String(f.value) }));

  return {
    id: `${config.issuerId}.${card.membershipId}`,
    classId: googleClassId(config),
    state: 'ACTIVE',
    hexBackgroundColor: theme.ground,
    cardTitle: text('Digital Minds'),
    header: text(card.fullName),
    subheader: text(definition.secondary[0]?.value.toString() ?? card.role),
    logo: {
      sourceUri: { uri: googleArtUrl(appOrigin, `logo-${variant}`) },
      contentDescription: text('Digital Minds'),
    },
    heroImage: {
      sourceUri: { uri: googleArtUrl(appOrigin, `hero-${variant}`) },
      contentDescription: text(card.club.name),
    },
    barcode: {
      type: 'QR_CODE',
      value: definition.barcodeMessage,
      alternateText: definition.barcodeAltText,
    },
    textModulesData: modules,
  };
}

/**
 * The "Save to Google Wallet" link for one card: a JWT signed (RS256) with the service account's
 * key, which carries the whole pass, so nothing has to exist on Google's side first. It opens in
 * a browser on any Android phone, or on a computer signed in to a Google account. Google fetches
 * the pictures from `appOrigin`, which therefore has to be a public https address.
 */
export function buildGoogleSaveUrl(
  card: MemberCard,
  config: GoogleWalletConfig,
  appOrigin: string,
  now: Date = new Date(),
): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: config.serviceAccountEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(now.getTime() / 1000),
    origins: [appOrigin],
    payload: {
      genericClasses: [{ id: googleClassId(config) }],
      genericObjects: [buildGoogleObject(card, config, appOrigin)],
    },
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(config.privateKey);
  return `https://pay.google.com/gp/v/save/${signingInput}.${base64url(signature)}`;
}
