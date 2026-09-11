---
title: Pi Display Sink Operator Guide
description:
  Provision, discover, operate, upgrade, reset, and troubleshoot the appliance
---

## Supported Platforms

The release artifact targets 64-bit Raspberry Pi OS on Raspberry Pi 4.
Development and continuous integration use Node.js 22 and 24. The package
expects systemd, nginx, Avahi, OpenSSL, and a system Node.js executable at
`/usr/bin/node`.

## Build the Artifact

From a clean checkout, install locked dependencies and build the release:

```bash
npm ci
npm run release
```

Release outputs are written to `artifacts/`. Keep the archive, checksum
manifest, SBOM, dependency report, source revision, and build-input manifest
together.

## Provision and Install

Copy the release archive and repository `scripts/install.sh` to the appliance.
Run installation as root. Set a stable Ethernet hostname because it becomes the
certificate name, advertised origin, and discovery target.

```bash
sudo env PI_DISPLAY_PUBLIC_HOST=display.example.lan \
  PI_DISPLAY_RELEASE_ID=release-0.1.0 \
  bash scripts/install.sh install artifacts/pi-display-wot-0.1.0-linux-arm64.tar.gz
```

Installation creates a persistent Thing ID in `/var/lib/pi-display-wot/thing-id`
and generates the TLS certificate, private key, and runtime credentials under
`/etc/pi-display-wot/`. Back up the Thing ID separately. Never copy
`runtime.env` or `device.key` into source control.

## Discover the Thing

Avahi advertises `_wot._tcp` for the configured host and HTTPS port. On a client
that can resolve multicast DNS, browse for the service and retrieve the Thing
Description:

```bash
avahi-browse --resolve --terminate _wot._tcp
curl --cacert device.crt \
  --user "$PI_DISPLAY_USERNAME:$PI_DISPLAY_PASSWORD" \
  https://display.example.lan/pidisplaysink
```

Use canonical Ethernet multicast DNS for appliance validation. Wi-Fi autoconnect
should stay disabled when it would produce an ambiguous discovery path.

## Authenticate and Operate

Read the generated username and password on the appliance as an authorized
administrator:

```bash
sudo sed -n '/^PI_DISPLAY_\(USERNAME\|PASSWORD\)=/p' /etc/pi-display-wot/runtime.env
```

Clients use HTTP Basic authentication and the generated certificate trust
anchor. The Thing Description provides forms for the `status`, `activeSession`,
`supportedProtocols`, `deviceName`, and `volume` properties; session and volume
actions; and lifecycle events. There are no real media receiver protocols in
this release. The fake receiver validates the control-plane lifecycle only.

Run the appliance smoke check after installation or an upgrade:

```bash
sudo /opt/pi-display-wot/current/scripts/smoke-test.sh --expected-model pi4
```

Add `--exercise-recovery` only during a maintenance window.

## Upgrade and Roll Back

Upgrade with a unique release identifier:

```bash
sudo env PI_DISPLAY_PUBLIC_HOST=display.example.lan \
  PI_DISPLAY_RELEASE_ID=release-0.1.1 \
  bash scripts/install.sh upgrade artifacts/pi-display-wot-0.1.1-linux-arm64.tar.gz
```

The installer preserves `/var/lib/pi-display-wot` and `/etc/pi-display-wot`,
switches the `current` symlink atomically, and records the prior target as
`previous`. Roll back without changing identity or configuration:

```bash
sudo bash scripts/install.sh rollback
```

Run the smoke check after each direction. Record the active release target,
artifact checksum, Thing ID hash, runtime environment hash, and service restart
count as rollback evidence.

## Reset and Credential Lifecycle

Certificate renewal preserves the private key, credentials, and Thing ID.
Rotation preserves the Thing ID while replacing the key, certificate, and
credentials. Run these commands from the active release:

```bash
sudo /opt/pi-display-wot/current/scripts/generate-device-identity.sh renew
sudo /opt/pi-display-wot/current/scripts/generate-device-identity.sh rotate
```

A reset destroys the existing identity and credentials and requires explicit
confirmation:

```bash
sudo bash scripts/install.sh reset --confirm-reset
```

Uninstall retains identity and configuration by default. Permanent removal
requires both destructive flags:

```bash
sudo bash scripts/uninstall.sh
sudo bash scripts/uninstall.sh --purge-state --confirm-reset
```

## Logs and Troubleshooting

Inspect service state and recent logs without exposing the credentials file:

```bash
systemctl status pi-display-wot.service nginx avahi-daemon
journalctl -u pi-display-wot.service --since today --no-pager
nginx -t
avahi-browse --resolve --terminate _wot._tcp
```

If startup fails, verify that `runtime.env` exists with mode `0640`, the
certificate paths are absolute, the advertised URL is HTTPS, and all CORS
entries are explicit HTTPS origins. Use
`systemctl show pi-display-wot.service -p NRestarts -p MainPID -p User` to
inspect recovery.
