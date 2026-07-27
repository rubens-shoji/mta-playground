import { useEffect, useRef, useState } from 'react';
import type { MessageRow, Stats, StatusEvent } from './types';

export interface WireLine {
  key: number;
  at: string;
  event: StatusEvent;
}

/**
 * One hook owns all live state: initial snapshot from the REST endpoints,
 * then the SSE stream mutates it in place. Stats re-poll on an interval —
 * queue depths change without emitting events.
 */
export function useLive() {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [wire, setWire] = useState<WireLine[]>([]);
  const [connected, setConnected] = useState(false);
  const wireKey = useRef(0);

  useEffect(() => {
    fetch('/api/messages')
      .then((r) => r.json())
      .then(setMessages)
      .catch(() => {});

    const pollStats = () =>
      fetch('/api/stats')
        .then((r) => r.json())
        .then(setStats)
        .catch(() => {});
    pollStats();
    const timer = setInterval(pollStats, 3000);

    const es = new EventSource('/api/events');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const event: StatusEvent = JSON.parse(e.data);

      // Build the entry before the updater runs: updaters execute at flush
      // time, and two events in one batch would otherwise read the same key.
      wireKey.current += 1;
      const entry = {
        key: wireKey.current,
        at: new Date().toISOString(),
        event,
      };
      setWire((prev) => [entry, ...prev].slice(0, 80));

      if (event.type === 'message.queued') {
        const { id, from, to, queuedAt } = event.email;
        setMessages((prev) => [
          { id, from, to, status: 'queued' as const, queuedAt },
          ...prev.filter((m) => m.id !== id),
        ]);
      } else if (event.type === 'delivery.attempted') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId ? { ...m, status: event.status } : m,
          ),
        );
      } else if (event.type === 'message.suppressed') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId
              ? { ...m, status: 'suppressed' as const }
              : m,
          ),
        );
      }
    };

    return () => {
      clearInterval(timer);
      es.close();
    };
  }, []);

  return { messages, stats, wire, connected };
}
