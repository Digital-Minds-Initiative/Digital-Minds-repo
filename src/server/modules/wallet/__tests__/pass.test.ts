import { execFileSync } from 'node:child_process';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strFromU8, unzipSync } from 'fflate';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import walletPassAr from '@/i18n/messages/ar/walletPass.json';
import type { MemberCard } from '@/shared/contracts/wallet';
import { cardVariantFor, type CardVariant } from '@/shared/lib/member-card';
import { buildPassDefinition, cardRoleLabel, stampRow } from '@/shared/lib/wallet-pass';

import { buildGoogleObject, buildGoogleSaveUrl } from '../google-wallet';
import { ART_THEMES } from '../pass/art-theme';
import { buildPkpass } from '../pass/build';
import { HERO_SIZE, markLogo, markSquare, STRIP_SIZE, stripArt } from '../pass/images';
import { hexToRgb } from '../pass/png';

const member: MemberCard = {
  membershipId: '01900000-0000-7000-8000-00000000abcd',
  club: { id: '01900000-0000-7000-8000-000000000001', name: 'نادي طويق', slug: 'tuwaiq' },
  mood: 'tech',
  memberCode: 'DM-0000ABCD',
  fullName: 'يوسف علي الشمراني',
  role: 'عضو فعال',
  clubRole: 'MEMBER',
  tone: 'paper',
  tonePreference: null,
  stickers: [],
  share: {
    enabled: true,
    showPoints: true,
    showActivity: false,
    url: 'https://digitalmindsint.org/c/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
  qr: 'https://digitalmindsint.org/c/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ledCommittees: [],
  committees: ['لجنة التطوير', 'لجنة المحتوى'],
  hijriYear: 1448,
  gregorianYear: 2026,
  points: 140,
  stampsEarned: 2,
  stampsTotal: 6,
  wallet: { apple: true, google: true },
};

const lead: MemberCard = { ...member, ledCommittees: ['لجنة التطوير'], tone: 'matte' };
const officer: MemberCard = {
  ...member,
  club: { id: '01900000-0000-7000-8000-000000000002', name: 'نادي الحاسبات', slug: 'computing' },
  mood: 'gem',
  clubRole: 'CLUB_OFFICER',
  tone: 'matte',
};

const VARIANTS: CardVariant[] = ['paper-tech', 'matte-tech', 'matte-gem', 'paper-gem'];

function decode(png: Uint8Array) {
  return PNG.sync.read(Buffer.from(png));
}

describe('pass definition', () => {
  const definition = buildPassDefinition(member, 'http://localhost:3000', walletPassAr);

  it('is a store card that shows the points where a collapsed pass still shows them', () => {
    expect(definition.header).toEqual([
      expect.objectContaining({ key: 'points', value: 140, numberStyle: 'PKNumberStyleDecimal' }),
    ]);
    expect(definition.primary[0]?.value).toBe(member.fullName);
  });

  it('puts the card link in the QR and the code under it, and keeps contact details off the pass', () => {
    // The QR holds the card's link while it is shared; the code is printed under it either way.
    expect(definition.barcodeMessage).toBe(member.qr);
    expect(definition.barcodeAltText).toBe('DM-0000ABCD');
    const visible = JSON.stringify({
      ...definition,
      back: definition.back.filter((f) => f.key !== 'platform'),
    });
    expect(visible).not.toMatch(/@/);
  });

  it('draws earned stamps filled and the rest hollow, left to right in any reading direction', () => {
    expect(stampRow(2, 6)).toBe('●●○○○○');
    expect(stampRow(9, 6)).toBe('●●●●●●');
    expect(stampRow(-1, 6)).toBe('○○○○○○');
    const stamps = definition.auxiliary.find((f) => f.key === 'stamps')?.value;
    expect(stamps).toBe('‪●●○○○○‬');
  });

  it('falls back to the member code when the card is not shared', () => {
    const private_ = {
      ...member,
      share: { ...member.share, enabled: false, url: null },
      qr: member.memberCode,
    };
    expect(
      buildPassDefinition(private_, 'http://localhost:3000', walletPassAr).barcodeMessage,
    ).toBe('DM-0000ABCD');
  });

  it('lists the earned stickers on the back, by name, and nothing when there are none', () => {
    const earned = {
      ...member,
      stickers: [
        { key: 'star' as const, source: 'awarded' as const, placement: null },
        { key: 'lead' as const, source: 'role' as const, placement: null },
      ],
    };
    const back = buildPassDefinition(earned, '', walletPassAr).back;
    expect(back.find((field) => field.key === 'stickers')?.value).toBe('نجم الشهر، قائد لجنة');
    expect(
      buildPassDefinition(member, '', walletPassAr).back.some((field) => field.key === 'stickers'),
    ).toBe(false);
  });

  it('calls officers, leads and members what they are', () => {
    expect(cardRoleLabel(officer, walletPassAr)).toBe('مسؤول النادي');
    expect(cardRoleLabel(lead, walletPassAr)).toBe('مسؤول لجنة التطوير');
    expect(cardRoleLabel(member, walletPassAr)).toBe('عضو فعال');
  });
});

describe('the four colourways', () => {
  it('follow role and club', () => {
    expect(cardVariantFor(member)).toBe('paper-tech');
    expect(cardVariantFor(lead)).toBe('matte-tech');
    expect(cardVariantFor(officer)).toBe('matte-gem');
    expect(cardVariantFor({ ...officer, tone: 'paper' })).toBe('paper-gem');
    // The member's own choice decides, whatever their role.
    expect(cardVariantFor({ ...member, tone: 'matte' })).toBe('matte-tech');
  });

  it('match the badge tokens in tokens.css, value for value', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    const token = (name: string) =>
      new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase();
    expect(ART_THEMES['paper-tech'].ground).toBe(token('badge-white'));
    expect(ART_THEMES['matte-tech'].ground).toBe(token('badge-matte'));
    expect(ART_THEMES['matte-gem'].ground).toBe(token('uqu-dark-cyan'));
    expect(ART_THEMES['paper-tech'].text).toBe(token('badge-ink'));
    expect(ART_THEMES['matte-tech'].text).toBe(token('badge-canvas'));
    expect(ART_THEMES['matte-tech'].panelBase).toBe(token('badge-panel-indigo'));
    expect(ART_THEMES['paper-tech'].panelBase).toBe(token('badge-panel-lilac'));
    expect(ART_THEMES['matte-gem'].panelBase).toBe(token('badge-panel-cyan'));
    expect(ART_THEMES['paper-gem'].panelBase).toBe(token('badge-panel-mint'));
    expect(ART_THEMES['matte-gem'].blobs[0]).toBe(token('badge-gold'));
    expect(ART_THEMES['matte-tech'].blobs[0]).toBe(token('tuwaiq-lilac'));
    expect(ART_THEMES['paper-tech'].mark).toBe(token('tuwaiq-indigo'));
  });

  it('keep text and labels readable on their ground (WCAG AA, 4.5:1)', () => {
    const luminance = (hex: string) => {
      const { r, g, b } = hexToRgb(hex);
      const channel = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const variant of VARIANTS) {
      const theme = ART_THEMES[variant];
      expect(contrast(theme.text, theme.ground), `${variant} text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.label, theme.ground), `${variant} label`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('pass images', () => {
  it('are Apple sizes: strip 375 x 144 pt, the icon 38 pt at @2x', () => {
    const strip = decode(
      stripArt('paper-tech', STRIP_SIZE.width, STRIP_SIZE.height).toPng({ alpha: false }),
    );
    expect([strip.width, strip.height]).toEqual([375, 144]);
    const icon = decode(markSquare('matte-gem', 76).toPng({ alpha: false }));
    expect([icon.width, icon.height]).toEqual([76, 76]);
  });

  it('are Google sizes: hero 1032 x 336', () => {
    const hero = decode(
      stripArt('matte-tech', HERO_SIZE.width, HERO_SIZE.height).toPng({ alpha: false }),
    );
    expect([hero.width, hero.height]).toEqual([1032, 336]);
  });

  it('are different pictures for each colourway, and the same every time for one', () => {
    const png = (v: CardVariant) =>
      stripArt(v, 375, 144).toPng({ alpha: false }).toString('base64');
    expect(new Set(VARIANTS.map(png)).size).toBe(4);
    expect(png('matte-gem')).toBe(png('matte-gem'));
  });

  it('paint the panel with grain, not a flat colour', () => {
    const strip = decode(stripArt('paper-tech', 375, 144).toPng({ alpha: false }));
    const seen = new Set<number>();
    for (let i = 0; i < strip.data.length; i += 4 * 97) seen.add(strip.data[i] ?? 0);
    expect(seen.size).toBeGreaterThan(20);
  });

  it('keep the pass small enough to send by message (images under 1 MB)', () => {
    const total = [
      stripArt('paper-tech', 375, 144).toPng({ alpha: false }),
      stripArt('paper-tech', 750, 288).toPng({ alpha: false }),
      markLogo('paper-tech', 108).toPng(),
    ].reduce((sum, png) => sum + png.length, 0);
    expect(total).toBeLessThan(1_000_000);
  });

  it('put the club logo on the strip: the white logo is much lighter than its indigo panel', () => {
    const art = stripArt('matte-tech', 375, 144);
    const row = Math.round(144 * 0.27);
    let brightest = 0;
    for (let x = 100; x < 275; x++)
      brightest = Math.max(brightest, art.data[(row * 375 + x) * 4] ?? 0);
    expect(brightest).toBeGreaterThan(200);
  });
});

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasOpenssl())('signed .pkpass', () => {
  let dir = '';
  let signing: Parameters<typeof buildPkpass>[1];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'wallet-test-'));
    const make = (name: string) => {
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          join(dir, `${name}.key`),
          '-out',
          join(dir, `${name}.crt`),
          '-subj',
          `/CN=${name}`,
          '-days',
          '1',
        ],
        { stdio: 'ignore' },
      );
    };
    make('signer');
    make('wwdr');
    signing = {
      passTypeIdentifier: 'pass.test.digitalminds',
      teamIdentifier: 'TEAM123456',
      signerCert: readFileSync(join(dir, 'signer.crt'), 'utf8'),
      signerKey: readFileSync(join(dir, 'signer.key'), 'utf8'),
      signerKeyPassphrase: undefined,
      wwdr: readFileSync(join(dir, 'wwdr.crt'), 'utf8'),
    };
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const build = (card: MemberCard) =>
    unzipSync(new Uint8Array(buildPkpass(card, signing, 'http://localhost:3000')));
  const passJson = (card: MemberCard) =>
    JSON.parse(strFromU8(build(card)['pass.json'] ?? new Uint8Array())) as Record<string, unknown>;

  it('is a zip holding pass.json, a manifest, a signature and every image', () => {
    const files = build(member);
    for (const name of [
      'pass.json',
      'manifest.json',
      'signature',
      'icon.png',
      'icon@2x.png',
      'icon@3x.png',
      'logo.png',
      'logo@2x.png',
      'logo@3x.png',
      'strip.png',
      'strip@2x.png',
    ]) {
      expect(files[name], name).toBeDefined();
    }
  });

  it('says what the definition says, for the configured pass type', () => {
    const pass = passJson(member);
    expect(pass.passTypeIdentifier).toBe('pass.test.digitalminds');
    expect(pass.teamIdentifier).toBe('TEAM123456');
    expect(pass.serialNumber).toBe(member.membershipId);
    expect(pass.sharingProhibited).toBe(true);
    expect(pass.storeCard).toBeDefined();
    expect(JSON.stringify(pass)).toContain('DM-0000ABCD');
    expect(JSON.stringify(pass)).toContain('PKBarcodeFormatQR');
  });

  it('is dressed in the badge colours of its member: white, matte, or the Computing teal', () => {
    expect(passJson(member).backgroundColor).toBe('rgb(251, 249, 244)');
    expect(passJson(lead).backgroundColor).toBe('rgb(20, 18, 26)');
    expect(passJson(officer).backgroundColor).toBe('rgb(12, 39, 44)');
    expect(passJson(lead).foregroundColor).toBe('rgb(244, 241, 234)');
  });

  it('names the officer and the lead by what they hold', () => {
    expect(JSON.stringify(passJson(officer))).toContain('مسؤول النادي');
    expect(JSON.stringify(passJson(lead))).toContain('مسؤول لجنة التطوير');
  });

  it('lists a hash for every file except itself and the signature', () => {
    const files = build(member);
    const manifest = JSON.parse(strFromU8(files['manifest.json'] ?? new Uint8Array())) as Record<
      string,
      string
    >;
    const expected = Object.keys(files).filter((n) => n !== 'manifest.json' && n !== 'signature');
    expect(Object.keys(manifest).sort()).toEqual(expected.sort());
    expect(Object.values(manifest).every((hash) => /^[0-9a-f]{40}$/.test(hash))).toBe(true);
  });

  it('stays under 1 MB', () => {
    expect(buildPkpass(lead, signing, 'http://localhost:3000').length).toBeLessThan(1_000_000);
  });
});

describe('Google Wallet link', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const config = {
    issuerId: '3388000000012345678',
    serviceAccountEmail: 'wallet@digital-minds.iam.gserviceaccount.com',
    privateKey,
  };
  const now = new Date('2026-11-24T10:00:00Z');
  const url = buildGoogleSaveUrl(officer, config, 'https://digitalmindsint.org', now);
  const token = url.slice('https://pay.google.com/gp/v/save/'.length);

  it('is a pay.google.com save link carrying a three-part JWT', () => {
    expect(url.startsWith('https://pay.google.com/gp/v/save/')).toBe(true);
    expect(token.split('.')).toHaveLength(3);
  });

  it('is signed RS256 by the service account: the signature verifies with the public key', () => {
    const [header, claims, signature] = token.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    const verifier = createVerify('RSA-SHA256').update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('fails verification when the claims are changed after signing', () => {
    const [header, , signature] = token.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ iss: 'someone-else' })).toString('base64url');
    const verifier = createVerify('RSA-SHA256').update(`${header}.${forged}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(false);
  });

  it('carries the claims Google requires, tied to this origin', () => {
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
    ) as Record<string, unknown>;
    expect(claims).toMatchObject({
      iss: config.serviceAccountEmail,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(now.getTime() / 1000),
      origins: ['https://digitalmindsint.org'],
    });
  });

  it('describes the card: the member, their role, the code, the colourway pictures', () => {
    const object = buildGoogleObject(officer, config, 'https://digitalmindsint.org');
    expect(object.id).toBe(`${config.issuerId}.${officer.membershipId}`);
    expect(object.classId).toBe(`${config.issuerId}.digital_minds_member`);
    expect(object.hexBackgroundColor).toBe('#0c272c');
    expect(object.header.defaultValue.value).toBe(officer.fullName);
    expect(object.subheader.defaultValue.value).toBe('مسؤول النادي');
    expect(object.barcode).toMatchObject({
      type: 'QR_CODE',
      value: officer.qr,
      alternateText: officer.memberCode,
    });
    expect(object.heroImage.sourceUri.uri).toBe(
      'https://digitalmindsint.org/api/v1/public/wallet-art/hero-matte-gem',
    );
    expect(object.logo.sourceUri.uri).toBe(
      'https://digitalmindsint.org/api/v1/public/wallet-art/logo-matte-gem',
    );
    expect(object.textModulesData.map((m) => m.id)).toEqual([
      'points',
      'role',
      'year',
      'committees',
    ]);
  });

  it('never puts an email or phone in the pass', () => {
    expect(JSON.stringify(buildGoogleObject(officer, config, 'https://x.example'))).not.toMatch(
      /@/,
    );
  });
});
