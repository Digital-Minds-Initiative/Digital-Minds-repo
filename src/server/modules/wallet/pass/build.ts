import 'server-only';

import { PKPass } from 'passkit-generator';

import walletPassAr from '@/i18n/messages/ar/walletPass.json';
import type { WalletSigning } from '@/server/env';
import type { MemberCard } from '@/shared/contracts/wallet';
import { cardVariantFor } from '@/shared/lib/member-card';
import { buildPassDefinition } from '@/shared/lib/wallet-pass';

import { ART_THEMES } from './art-theme';
import { markLogo, markSquare, STRIP_SIZE, stripArt } from './images';
import { hexToRgb } from './png';

function rgb(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * The signed `.pkpass` for one card: a zip of `pass.json`, its images, a manifest of their hashes
 * and the PKCS#7 signature iOS checks before it offers to add the pass.
 *
 * A store card (Apple's style for membership and points cards): the website's pixel head and the
 * name «Digital Minds» in the logo area, the points in the header, the gradient panel with the
 * club's own logo as the strip, the member's name over it, then role and year, committees and
 * stamps, and the QR. The pass is white for members and matte for officers and leads, in Tuwaiq's
 * indigo or the Computing club's teal and gold: the same four badges the website shows.
 */
export function buildPkpass(card: MemberCard, signing: WalletSigning, appOrigin: string): Buffer {
  const definition = buildPassDefinition(card, appOrigin, walletPassAr);
  const variant = cardVariantFor(card);
  const theme = ART_THEMES[variant];

  const strip1 = stripArt(variant, STRIP_SIZE.width, STRIP_SIZE.height);
  const strip2 = stripArt(variant, STRIP_SIZE.width * 2, STRIP_SIZE.height * 2);
  const strip3 = stripArt(variant, STRIP_SIZE.width * 3, STRIP_SIZE.height * 3);

  const pass = new PKPass(
    {
      'icon.png': markSquare(variant, 38).toPng({ alpha: false }),
      'icon@2x.png': markSquare(variant, 76).toPng({ alpha: false }),
      'icon@3x.png': markSquare(variant, 114).toPng({ alpha: false }),
      'logo.png': markLogo(variant, 36).toPng(),
      'logo@2x.png': markLogo(variant, 72).toPng(),
      'logo@3x.png': markLogo(variant, 108).toPng(),
      'strip.png': strip1.toPng({ alpha: false }),
      'strip@2x.png': strip2.toPng({ alpha: false }),
      'strip@3x.png': strip3.toPng({ alpha: false }),
    },
    {
      wwdr: signing.wwdr,
      signerCert: signing.signerCert,
      signerKey: signing.signerKey,
      ...(signing.signerKeyPassphrase ? { signerKeyPassphrase: signing.signerKeyPassphrase } : {}),
    },
    {
      formatVersion: 1,
      passTypeIdentifier: signing.passTypeIdentifier,
      teamIdentifier: signing.teamIdentifier,
      serialNumber: definition.serialNumber,
      organizationName: definition.organizationName,
      description: definition.description,
      logoText: definition.logoText,
      backgroundColor: rgb(theme.ground),
      foregroundColor: rgb(theme.text),
      labelColor: rgb(theme.label),
      // The code is the member's own; keep it out of the share sheet.
      sharingProhibited: true,
    },
  );

  pass.type = 'storeCard';
  pass.headerFields.push(...definition.header);
  pass.primaryFields.push(...definition.primary);
  pass.secondaryFields.push(...definition.secondary);
  pass.auxiliaryFields.push(...definition.auxiliary);
  pass.backFields.push(...definition.back);
  pass.setBarcodes({
    format: 'PKBarcodeFormatQR',
    message: definition.barcodeMessage,
    messageEncoding: 'iso-8859-1',
    altText: definition.barcodeAltText,
  });

  return pass.getAsBuffer();
}
