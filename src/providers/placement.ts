import { MESSAGE_ID_HEADER } from '../shared/types.js';

const HEADER_RE = new RegExp(`^${MESSAGE_ID_HEADER}:\\s*(\\S+)`, 'im');

/** Extract the MTA's message id from the buffered DATA stream, so a
 *  provider can report placement back by id (seed-list style). */
export function messageIdFrom(chunks: Buffer[]): string | null {
  return Buffer.concat(chunks).toString('utf8').match(HEADER_RE)?.[1] ?? null;
}
