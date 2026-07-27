import { Fragment, useEffect, useState } from 'react';
import type { MessageDetail, MessageRow } from '../types';

function codeTone(code: number | null): string {
  if (code === null) return 'drop';
  if (code < 300) return 'ok';
  if (code < 500) return 'defer';
  return 'fail';
}

function AttemptTimeline({ id, status }: { id: string; status: string }) {
  const [detail, setDetail] = useState<MessageDetail | null>(null);

  // Refetch when the status chip changes so an open row stays current.
  useEffect(() => {
    fetch(`/api/messages/${id}`)
      .then((r) => r.json())
      .then(setDetail)
      .catch(() => {});
  }, [id, status]);

  if (!detail) return <p className="empty">Loading attempts…</p>;
  if (detail.attempts.length === 0)
    return <p className="empty">No SMTP conversation yet for this message.</p>;

  return (
    <ol className="timeline">
      {detail.attempts.map((a) => (
        <li key={a.id} className="attempt">
          <span className={`wire-tag tone-${codeTone(a.code)}`}>
            {a.code ?? 'DROP'}
          </span>
          <div>
            <p className="attempt-head">
              attempt {a.attempt} · {a.provider}
              {a.enhancedCode ? ` · ${a.enhancedCode}` : ''}
              {a.retryInSeconds !== null
                ? ` · retry in ${a.retryInSeconds}s`
                : ''}
            </p>
            <p className="attempt-response">
              {a.response ?? 'connection closed without response'}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function MessagesTable({ messages }: { messages: MessageRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section className="panel messages">
      <h2 className="panel-title">messages</h2>
      {messages.length === 0 ? (
        <p className="empty">
          No mail yet. Send one:{' '}
          <code>
            curl -X POST localhost:3000/send -d {'{'}"from":…,"to":…{'}'}
          </code>
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>status</th>
              <th>from</th>
              <th>to</th>
              <th>queued at</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <Fragment key={m.id}>
                <tr
                  className={openId === m.id ? 'row row-open' : 'row'}
                  tabIndex={0}
                  onClick={() => setOpenId(openId === m.id ? null : m.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setOpenId(openId === m.id ? null : m.id);
                    }
                  }}
                >
                  <td>
                    <span className={`chip chip-${m.status}`}>{m.status}</span>
                  </td>
                  <td>{m.from}</td>
                  <td>{m.to}</td>
                  <td>{new Date(m.queuedAt).toLocaleTimeString('en-GB')}</td>
                </tr>
                {openId === m.id && (
                  <tr className="detail-row">
                    <td colSpan={4}>
                      <AttemptTimeline id={m.id} status={m.status} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
