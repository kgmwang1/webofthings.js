---
title: Test Suites
description: Commands and scope for the Pi Display Sink automated tests
---

## Run the Tests

Install locked dependencies, then run all Vitest suites:

```bash
npm ci
npm test
```

Use `npm run test:unit` for isolated modules and `npm run test:integration` for
runtime boundaries. Contract tests cover the Thing Description, handlers, Avahi,
and systemd assets.
