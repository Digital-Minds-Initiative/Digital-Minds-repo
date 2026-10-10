import 'server-only';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Plain-text version, for clients that do not render HTML. */
  text: string;
}

/** Sends one email. Throws when the provider refuses it or cannot be reached. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
