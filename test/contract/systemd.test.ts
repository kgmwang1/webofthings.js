import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Raspberry Pi service contracts", () => {
  const unit = readFileSync(
    resolve("deploy/systemd/pi-display-wot.service"),
    "utf8",
  );
  const tmpfiles = readFileSync(
    resolve("deploy/tmpfiles/pi-display-wot.conf"),
    "utf8",
  );

  it("runs the release as a dedicated unprivileged account", () => {
    expect(unit).toContain("User=@SERVICE_USER@");
    expect(unit).toContain("Group=@SERVICE_GROUP@");
    expect(unit).toContain("WorkingDirectory=@INSTALL_PREFIX@/current");
    expect(unit).toContain("EnvironmentFile=@CONFIG_DIRECTORY@/runtime.env");
    expect(unit).toContain(
      "ExecStart=/usr/bin/env @NODE_EXECUTABLE@ @INSTALL_PREFIX@/current/dist/main.js",
    );
    expect(unit).toContain("NoNewPrivileges=yes");
    expect(unit).toContain("ProtectSystem=strict");
    expect(unit).toContain("ReadWritePaths=@STATE_DIRECTORY@");
    expect(unit).not.toMatch(/^User=(?:root|pi)$/m);
  });

  it("uses systemd cgroup cleanup and bounded crash recovery", () => {
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("RestartSec=5");
    expect(unit).toContain("TimeoutStopSec=20");
    expect(unit).toContain("KillMode=control-group");
    expect(unit).toContain("SendSIGKILL=yes");
  });

  it("declares persistent state separately from versioned releases", () => {
    expect(tmpfiles).toContain(
      "d @STATE_DIRECTORY@ 0750 @SERVICE_USER@ @SERVICE_GROUP@ -",
    );
    expect(tmpfiles).toContain(
      "d @CONFIG_DIRECTORY@ 0750 root @SERVICE_GROUP@ -",
    );
    expect(unit).toContain("RuntimeDirectory=pi-display-wot");
    expect(unit).not.toContain("StateDirectory=");
  });
});