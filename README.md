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