---
title: Migration from the Legacy Web of Things Sample
description: Breaking changes and rollback guidance for the Node-WoT migration
---

## Migration Boundary

The repository is now a dedicated Pi display-sink control plane, not a general
sensor gateway. The migration replaces the pre-standard resource model with a
W3C Thing Description 1.1, Node-WoT HTTP forms, a typed session broker, and a
receiver adapter boundary.

## Removed Runtime Surfaces

The following legacy behavior is intentionally unsupported:

- The `/things`, `/models`, and `/resources` routes
- The `/api/things`, `/api/models`, and `/api/resources` routes
- The `/ws` WebSocket endpoint
- HTML, JSON-LD, and MessagePack representations
- Credentials in query strings, request bodies, or static repository files
- The `Object.observe()` and `Array.observe()` extension mechanisms
- Sensor, LED, PIR, DHT22, and GPIO plug-ins and bundled native drivers
- The `wot.js`, `wot-server.js`, `routes`, `servers`, `middleware`, `resources`,
  `views`, `plugins`, `drivers`, and `utils` extension surfaces

Clients must discover the `_wot._tcp` service, retrieve `/pidisplaysink` over
authenticated HTTPS, and follow the forms in the returned Thing Description.
Compatibility aliases are not provided.

## Operational Changes

Identity and credentials are provisioned on the target rather than stored in the
repository. The service runs as `pi-display-wot`, binds its Node-WoT server to
loopback, and accepts external traffic through nginx. Avahi advertises the
configured HTTPS origin.

Package operations use versioned directories under
`/opt/pi-display-wot/releases`. The `current` and `previous` symlinks provide
atomic upgrade and one-step rollback while persistent state remains under
`/var/lib/pi-display-wot` and `/etc/pi-display-wot`.

## Rollback

Before upgrade, retain the previous artifact, checksum, SBOM, dependency report,
and build inputs. After upgrade, compare the Thing ID and runtime environment
hashes with the baseline. Use the supported rollback operation if validation
fails:

```bash
sudo bash scripts/install.sh rollback
```

Rollback restores the previous application release without restoring removed
compatibility endpoints. Migrating clients back to the historical protocol
requires redeploying the complete historical appliance image and its isolated
configuration, which is outside this package.
