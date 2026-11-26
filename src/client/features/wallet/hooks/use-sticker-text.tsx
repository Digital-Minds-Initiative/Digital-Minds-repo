'use client';

import { useTranslations } from 'next-intl';
import { createContext, useContext } from 'react';

import {
  isCustomStickerKey,
  type CustomStickerDef,
  type StickerKey,
  type StickerRef,
} from '@/shared/lib/stickers';

/** The designs of the custom stickers on the card in view, by key, so any part of it can draw them. */
export const StickerDefsContext = createContext<ReadonlyMap<string, CustomStickerDef>>(new Map());

/** The design behind a custom key, or null for a built-in one (or one whose design is not here). */
export function useStickerDef(key: StickerRef): CustomStickerDef | null {
  const defs = useContext(StickerDefsContext);
  return isCustomStickerKey(key) ? (defs.get(key) ?? null) : null;
}

/** What a sticker is called and how it is got, in words, for a built-in one or a custom one. */
export function useStickerText() {
  const tName = useTranslations('walletPass.sticker');
  const tHint = useTranslations('walletPass.stickerHint');
  const builtin = (key: StickerRef): StickerKey | null => (isCustomStickerKey(key) ? null : key);
  return {
    name(key: StickerRef, custom?: CustomStickerDef | null): string {
      const own = builtin(key);
      return custom?.name ?? (own ? tName(own) : '');
    },
    howTo(key: StickerRef, custom?: CustomStickerDef | null): string {
      const own = builtin(key);
      return custom?.howTo ?? (own ? tHint(own) : '');
    },
  };
}
