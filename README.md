---
title: Pi Display Sink
description: Node-WoT control plane and Raspberry Pi service for a display sink
---

## Overview

Pi Display Sink exposes an authenticated W3C Web of Things Thing Description for
a receiver-neutral display control plane. The current implementation uses a
deterministic fake receiver to validate session approval, playback, stop,
failure, and recovery behavior.

The service targets 64-bit Raspberry Pi OS on Raspberry Pi 4. Node.js 22 and 24
are supported for development and continuous integration.

## Development

```bash
npm ci
npm run build
npm run lint
npm test
```

Run the local service after building:

```bash
npm start
```

The default development endpoint is `http://127.0.0.1:8484/pidisplaysink`.
Deployed systems require HTTPS, HTTP Basic authentication, explicit CORS
origins, and provisioned identity.

## Deployment

Create the ARM64 appliance artifact with `npm run release`. Install and manage
it with the non-interactive operations documented in
[docs/operator-guide.md](docs/operator-guide.md). The guide covers provisioning,
discovery, authentication, operation, reset, logs, supported platforms,
upgrades, and rollback.

Existing users should read [docs/migration.md](docs/migration.md) for removed
endpoints, representations, and extension surfaces.

## License

This project is licensed under Apache-2.0. See [LICENSE](LICENSE).
