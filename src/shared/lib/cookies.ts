/**
 * Reads one cookie from a `Cookie` request header or from `document.cookie` (same format).
 * Returns null when the cookie is absent or its value is not valid URI encoding.
 */
export function readCookie(cookies: string | null | undefined, name: string): string | null {
  if (!cookies) return null;
  for (const part of cookies.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}
