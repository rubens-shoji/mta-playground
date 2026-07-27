import { MessagesTable } from './components/MessagesTable';
import { Outcomes, Placements, Queues } from './components/Panels';
import { Wire } from './components/Wire';
import { useLive } from './useLive';

export default function App() {
  const { messages, stats, wire, connected } = useLive();

  return (
    <div className="console">
      <header className="masthead">
        <div>
          <p className="eyebrow">mta-playground</p>
          <h1>postmaster console</h1>
        </div>
        <p className={connected ? 'feed feed-live' : 'feed feed-down'}>
          <span className="feed-dot" aria-hidden="true" />
          {connected ? 'event wire live' : 'event wire down'}
        </p>
      </header>

      <main className="board">
        <div className="panels">
          <Outcomes stats={stats} />
          <Queues stats={stats} />
          <Placements stats={stats} />
        </div>
        <MessagesTable messages={messages} />
      </main>

      <Wire lines={wire} />
    </div>
  );
}
