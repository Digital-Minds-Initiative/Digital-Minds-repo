import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearSentEmails, devEmailSender, maskEmail, sentEmails } from '../dev';
import { createResendSender } from '../resend';

const message = {
  to: 's443001234@st.uqu.edu.sa',
  subject: 'Subject',
  html: '<p>html</p>',
  text: 'text',
};

describe('dev email sender', () => {
  afterEach(clearSentEmails);

  it('keeps sent emails in memory until cleared', async () => {
    await devEmailSender.send(message);
    expect(sentEmails()).toEqual([message]);
    clearSentEmails();
    expect(sentEmails()).toEqual([]);
  });

  it('masks addresses for the console', () => {
    expect(maskEmail('s443001234@st.uqu.edu.sa')).toBe('s44***@st.uqu.edu.sa');
    expect(maskEmail('ab@uqu.edu.sa')).toBe('ab***@uqu.edu.sa');
    expect(maskEmail('not-an-email')).toBe('***');
  });
});

describe('Resend sender', () => {
  it('posts the message with the API key and sender address', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{}'));
    await createResendSender({ apiKey: 're_key', from: 'DM <no-reply@x.org>', fetch }).send(
      message,
    );

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer re_key' });
    expect(JSON.parse(String(init?.body))).toEqual({
      from: 'DM <no-reply@x.org>',
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  });

  it('throws without naming the recipient when Resend refuses', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('', { status: 422 }));
    const sending = createResendSender({ apiKey: 'k', from: 'f', fetch }).send(message);
    await expect(sending).rejects.toThrow('HTTP 422');
    await expect(sending).rejects.not.toThrow(message.to);
  });
});
