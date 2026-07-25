[WIP]

# mta-playground

A toy MTA that takes email delivery seriously. Simulated mailbox providers
(fake-gmail, fake-outlook, fake-yahoo) respond with real-world SMTP behavior:
greylisting, reputation rate limits, contradictory status codes, and all the
other ways real providers make delivery hard.

Built to explore the problem space, not to send real email.

## Purpose

Email delivery looks simple (SMTP is from 1982) and is brutally hard in
practice, because the receiving side is a set of opaque third parties with
undocumented, changing rules. Most delivery code is impossible to exercise
locally: you can't ask Gmail to greylist you on demand.

This playground flips that: providers are local SMTP servers with
configurable hostile behavior, so queueing, throttling, retry, backoff and
bounce classification can be developed and tested against realistic
responses, offline.

## Background

Response strings are taken from real sources: Google's official SMTP error
table, Yahoo's sender hub, and the SMTP Field Manual (Postmark's collection
of raw production responses). Retry defaults are inspired by Postfix,
compressed so a demo run is watchable in minutes instead of days.

## References

**Provider responses (real-world data)**
- [SMTP Field Manual](https://smtpfieldmanual.com) — raw SMTP responses
  collected from production, by provider and by code (Postmark)
  - [Google](https://smtpfieldmanual.com/provider/google/)
  - [Outlook](https://smtpfieldmanual.com/provider/outlook/)
  - [Yahoo](https://smtpfieldmanual.com/provider/yahoo/)
- [Gmail SMTP errors and codes](https://support.google.com/a/answer/3726730) — Google's official error table
- [Yahoo SMTP error codes](https://senders.yahooinc.com/smtp-error-codes/) — official sender hub, TSS/BL codes
- [Microsoft postmaster](https://postmaster.live.com) — Outlook.com sender info

**Sender requirements**
- [Gmail Email sender guidelines](https://support.google.com/mail/answer/81126) — the 2024 bulk sender rules (SPF/DKIM/DMARC, <0.3% spam rate)
- [Google Postmaster Tools](https://postmaster.google.com) — reputation dashboards

**Standards**
- [RFC 5321](https://datatracker.ietf.org/doc/html/rfc5321) — SMTP
- [RFC 3463](https://datatracker.ietf.org/doc/html/rfc3463) — Enhanced status codes (x.y.z)
- [RFC 6647](https://datatracker.ietf.org/doc/html/rfc6647) — Greylisting

**Retry behavior baseline**
- [Postfix queue configuration](https://www.postfix.org/postconf.5.html) — minimal/maximal_backoff_time, queue lifetime
- [Exponential backoff and jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) — the full-jitter strategy used in retry.ts

**MTA design (further reading)**
- [KumoMTA docs](https://docs.kumomta.com) — modern open-source MTA in Rust; queue strategy and traffic shaping

## Proposal / Architecture

```
             control plane                      data plane
┌────────┐   ┌─────────┐   ┌──────────┐   ┌─────────────────┐
│ client │ → │  api    │ → │ RabbitMQ │ → │  mta consumer   │
└────────┘   │ (Hono)  │   │ outbound │   │ route→deliver→  │
             └─────────┘   └──────────┘   │ classify→retry  │
                                ↑         └───────┬─────────┘
                                │ TTL dead-letter │ SMTP
                          ┌─────┴─────┐   ┌───────┴─────────┐
                          │ retry.Ns  │   │ fake-gmail :2525│
                          │ queues    │   │ fake-outlook ...│
                          └───────────┘   └─────────────────┘
```

- **API never talks SMTP.** A provider slowdown can't block ingestion; the
  queue absorbs spikes. (Control plane / data plane separation.)
- **Retries are TTL dead-letter queues.** A deferred message sits in
  `emails.retry.30s` until RabbitMQ dead-letters it back to the outbound
  queue. No sleeping workers, no polling.
- **Classification reads the text, not just the code.** Yahoo's TSS11
  arrives as a 553 whose text says "Retrying will NOT succeed" (permanent).
  Outlook's 554 5.2.122 is a per-hour limit (retriable). Providers
  contradict their own codes; the classifier knows.
- **Suppression is recipient-level only.** A 5.7.x reputation block means
  the sender is the problem, not the address — suppressing it would be a
  bug. See `shouldSuppress()`.

## Provider behaviors

| Provider | Port | Implemented |
|---|---|---|
| fake-gmail | 2525 | greylisting (421 4.7.0), rate limit (421 4.7.28), hard bounce (550 5.1.1), spam-folder placement for recently-limited senders, `- gsmtp` marker |
| fake-outlook | 2526 | low concurrent-connection limit (421 4.3.2), reputation rate limit (451 4.7.650), mid-session drops for `drop*` recipients |
| fake-yahoo | 2527 | slow responses, TSS04 volume deferrals (421), TSS11 permanent-in-disguise (553) for `spammer*` senders |

## Running

```sh
docker compose up -d        # RabbitMQ (+ management UI at :15672)
pnpm install
pnpm dev                    # api :3000, mta consumer, providers :2525-2527
```

Send something:

```sh
curl -X POST localhost:3000/send \
  -H 'Content-Type: application/json' \
  -d '{"from":"me@example.test","to":"user@fake-gmail.test","subject":"hello"}'
```

Watch the MTA logs: first attempt gets greylisted (421), the retry is
scheduled with jittered exponential backoff, and the next attempt after the
greylist window is accepted. Try `to: "unknown1@fake-gmail.test"` for a
hard bounce and suppression.

Standalone greylisting demo (no RabbitMQ needed):

```sh
pnpm tsx src/providers/smoke.ts
```

## Tests

```sh
pnpm test
```

The classifier suite covers the fun cases: TSS11 (text overrides code),
Outlook per-hour 554 (transient despite 5xx), 5.7.x non-suppression, and
dropped connections.

## Implementation plan

- [x] Phase 1: api + queue + mta + fake-gmail (greylisting, rate limit,
      hard bounce, spam placement) + classifier with tests
- [x] Phase 2: fake-outlook and fake-yahoo personalities
- [ ] Phase 3: persistence with Postgres + Drizzle — store messages and
      delivery attempts, tracking execution status per message (queued,
      deferred, delivered, bounced, suppressed)
- [ ] Phase 4: per-IP reputation score consulted by providers; warmup demo
- [ ] Phase 5: live dashboard (queues, attempts, outcomes, inbox vs spam)

## Open questions

- Should reputation be per-IP, per-domain, or both? (Real providers weigh
  domain reputation increasingly more.)
- How far to take TLS simulation (STARTTLS negotiation, cert failures)?
