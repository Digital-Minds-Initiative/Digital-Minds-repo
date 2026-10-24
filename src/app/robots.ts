import type { MetadataRoute } from 'next';

import { VIEW_LINK_PATH } from '@/shared/contracts/clubs';

/** Committee view links are capabilities, not pages to index (docs/adr/0023-committee-view-link.md). */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/', disallow: `${VIEW_LINK_PATH}/` } };
}
