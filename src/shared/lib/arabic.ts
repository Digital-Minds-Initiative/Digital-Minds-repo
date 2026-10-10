/**
 * Arabic-aware text normalisation for search.
 *
 * People type names inconsistently: "احمد" vs "أحمد", "فاطمة" vs "فاطمه", with or without
 * diacritics. Both the stored `User.searchName` and the user's query go through the same function,
 * so a plain `contains` match finds them all.
 */

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ALEF_VARIANTS = /[آأإٱ]/g; // آ أ إ ٱ
const ARABIC_INDIC_DIGITS = /[٠-٩]/g; // ٠-٩
const EXTENDED_ARABIC_INDIC_DIGITS = /[۰-۹]/g; // ۰-۹

/** Converts Arabic-Indic and Persian digits to 0-9. */
export function toLatinDigits(value: string): string {
  return value
    .replace(ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EXTENDED_ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function normalizeForSearch(value: string): string {
  return toLatinDigits(value.normalize('NFKC'))
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(ALEF_VARIANTS, 'ا')
    .replace(/ى/g, 'ي') // ى → ي
    .replace(/ی/g, 'ي') // Persian ی → ي
    .replace(/ک/g, 'ك') // Persian ک → ك
    .replace(/ة/g, 'ه') // ة → ه
    .replace(/ؤ/g, 'و') // ؤ → و
    .replace(/ئ/g, 'ي') // ئ → ي
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
