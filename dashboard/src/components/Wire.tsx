import type { StatusEvent } from '../types';
import type { WireLine } from '../useLive';

/** Class of an SMTP reply code → the semantic color family. */
function codeClass(code: number | null): string {
  if (code === null) return 'drop';
  if (code < 300) return 'ok';
  if (code < 500) return 'defer';
  return 'fail';
}

function line(event: StatusEvent): { cls: string; tag: string; text: string } {
  switch (event.type) {
    case 'message.queued':
      return {
        cls: 'queued',
        tag: 'QUEUED',
        text: `${event.email.from} → ${event.email.to}`,
      };
    case 'delivery.attempted':
      return {
        cls: codeClass(event.code),
        tag: event.code === null ? 'DROP' : String(event.code),
        text: `${event.provider} #${event.attempt} ${
          event.response ?? 'connection closed without response'
        }`,
      };
    case 'message.accepted':
      return {
        cls: event.folder === 'spam' ? 'defer' : 'ok',
        tag: event.folder.toUpperCase(),
        text: `${event.provider} placed mail for ${event.to}`,
      };
    case 'message.suppressed':
      return {
        cls: 'supp',
        tag: 'SKIP',
        text: 'send dropped — recipient is on the suppression list',
      };
    case 'address.suppressed':
      return {
        cls: 'supp',
        tag: 'SUPP',
        text: `${event.address} added to the suppression list`,
      };
  }
}

export function Wire({ lines }: { lines: WireLine[] }) {
  return (
    <aside className="wire" aria-label="Live event wire">
      <h2 className="panel-title">event wire</h2>
      {lines.length === 0 ? (
        <p className="empty">
          Quiet so far. POST /send to wake the pipeline — every status event
          prints here as it happens.
        </p>
      ) : (
        <ol className="wire-list">
          {lines.map(({ key, at, event }) => {
            const { cls, tag, text } = line(event);
            return (
              <li key={key} className="wire-line">
                <time dateTime={at}>
                  {new Date(at).toLocaleTimeString('en-GB')}
                </time>
                <span className={`wire-tag tone-${cls}`}>{tag}</span>
                <span className="wire-text">{text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
