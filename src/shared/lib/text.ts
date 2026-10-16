/**
 * Free-text normalisation shared by every field people type by hand.
 *
 * Text arrives pasted from spreadsheets and documents and typed on phones, so the same words
 * reach us with a trailing space, a double space or a tab in the middle. One rule for all of it:
 * trim the ends and collapse every run of whitespace to a single space. It is applied in the
 * contract field *and* again in the service that stores the value, so a service called directly
 * (a script, the CSV import) cannot store a differently spaced version of the same text.
 *
 * Nothing else is touched: letters, case and punctuation are the author's.
 */
export function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
