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
