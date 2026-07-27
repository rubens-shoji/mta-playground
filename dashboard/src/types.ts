export type MessageStatus =
  | 'queued'
  | 'deferred'
  | 'delivered'
  | 'bounced'
  | 'suppressed';

export interface MessageRow {
  id: string;
  from: string;
  to: string;
  status: MessageStatus;
  queuedAt: string;
}

export interface Attempt {
  id: number;
  attempt: number;
  provider: string;
  code: number | null;
  enhancedCode: string | null;
  response: string | null;
  outcome: 'delivered' | 'transient' | 'permanent';
  retryInSeconds: number | null;
  createdAt: string;
}

export interface MessageDetail extends MessageRow {
  subject: string;
  body: string;
  attempts: Attempt[];
}

export interface Stats {
  statuses: { status: MessageStatus; count: number }[];
  placements: { provider: string; folder: 'inbox' | 'spam'; count: number }[];
  queues: { name: string; messages: number }[];
}

export type StatusEvent =
  | {
      type: 'message.queued';
      email: { id: string; from: string; to: string; queuedAt: string };
    }
  | {
      type: 'delivery.attempted';
      messageId: string;
      attempt: number;
      provider: string;
      code: number | null;
      enhancedCode: string | null;
      response: string | null;
      outcome: 'delivered' | 'transient' | 'permanent';
      retryInSeconds: number | null;
      status: 'deferred' | 'delivered' | 'bounced';
    }
  | {
      type: 'message.accepted';
      messageId: string | null;
      provider: string;
      from: string;
      to: string;
      folder: 'inbox' | 'spam';
    }
  | { type: 'message.suppressed'; messageId: string }
  | { type: 'address.suppressed'; address: string; reason: string };
