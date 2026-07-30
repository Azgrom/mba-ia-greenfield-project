const mailpitUrl = `http://${process.env.MAIL_HOST ?? 'mailpit'}:8025`;

export interface MailpitAddress {
  Name: string;
  Address: string;
}

/**
 * Subset of Mailpit's `GET /api/v1/messages` entry that the tests assert on.
 * Mailpit returns more fields; only the ones actually read are declared.
 */
export interface MailpitMessageSummary {
  ID: string;
  From: MailpitAddress;
  To: MailpitAddress[];
  Subject: string;
}

/** Subset of Mailpit's `GET /api/v1/message/{id}` payload. */
export interface MailpitMessage extends MailpitMessageSummary {
  HTML: string;
  Text: string;
}

export async function getMailpitMessages(): Promise<MailpitMessageSummary[]> {
  const res = await fetch(`${mailpitUrl}/api/v1/messages`);
  const data = (await res.json()) as { messages?: MailpitMessageSummary[] };
  return data.messages ?? [];
}

export async function getMailpitMessage(id: string): Promise<MailpitMessage> {
  const res = await fetch(`${mailpitUrl}/api/v1/message/${id}`);
  return (await res.json()) as MailpitMessage;
}

export async function clearMailpitMessages(): Promise<void> {
  await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
}
