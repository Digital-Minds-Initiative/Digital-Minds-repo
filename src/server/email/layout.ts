import 'server-only';

/*
 * The look every email shares: an Arabic, right-to-left card on a grey page. Email clients ignore
 * stylesheets and CSS variables, so this uses inline styles with literal colours (the design-token
 * rule is for the app UI). Every value put into the HTML goes through `escapeHtml`.
 */

const TEXT = '#1f2933';
const MUTED = '#52606d';
const FAINT = '#7b8794';

/** A full HTML email: the platform name on top, `content` (already HTML), a footer line. */
export function emailDocument(input: {
  subject: string;
  platform: string;
  content: string;
  footer: string;
}): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f5f7;font-family:Tahoma,Arial,sans-serif;direction:rtl;text-align:right">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
<p style="margin:0 0 24px;font-size:18px;font-weight:bold;color:${TEXT}">${escapeHtml(input.platform)}</p>
${input.content}
<p style="margin:24px 0 0;font-size:12px;color:${FAINT}">${escapeHtml(input.footer)}</p>
</div>
</body>
</html>`;
}

/** One paragraph of body text; `muted` for the closing "ignore this" line. */
export function emailParagraph(value: string, { muted = false } = {}): string {
  const colour = muted ? `color:${MUTED}` : '';
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:${TEXT};${colour}">${escapeHtml(value)}</p>`;
}

/** A link styled as a button. `href` must be a URL the server built, never user input. */
export function emailButton(label: string, href: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;border-radius:8px;background:#5b3cc4;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">${escapeHtml(label)}</a></p>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const EMAIL_COLOURS = { text: TEXT, muted: MUTED };
