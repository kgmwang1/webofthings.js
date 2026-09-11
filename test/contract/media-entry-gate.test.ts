import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { evaluateMediaEntry } = require("../../scripts/check-media-entry.cjs") as {
  evaluateMediaEntry: (options: {
    evidence?: unknown;
    runTest: (condition: { id: string }) => { detail: string; passed: boolean };
  }) => {
    conditions: Array<{ id: string; status: string }>;
    result: string;
  };
};

const passingEvidence = {
  platform: "raspberry-pi-4",
  systemdChildProcessReaping: {
    method: "live cgroup cleanup",
    service: "pi-display-wot.service",
    status: "pass",
  },
  resourceBaseline: {
    durationSeconds: 86400,
    identityAnomalies: 0,
    powerAnomalies: 0,
    restartAnomalies: 0,
    rssKiB: { maximum: 89720, minimum: 78604 },
    sampleCount: 1431,
    status: "pass",
  },
};

describe("real-media entry gate", () => {
  it("reports every passing condition independently", () => {
    const result = evaluateMediaEntry({
      evidence: passingEvidence,
      runTest: () => ({ detail: "passed", passed: true }),
    });

    expect(result.result).toBe("pass");
    expect(result.conditions).toHaveLength(6);
    expect(result.conditions.every(({ status }) => status === "pass")).toBe(true);
  });

  it("blocks real receiver work when conditions fail or are unavailable", () => {
    const result = evaluateMediaEntry({
      runTest: ({ id }) => ({ detail: "checked", passed: id !== "approval-cannot-be-bypassed" }),
    });

    expect(result.result).toBe("blocked");
    expect(result.conditions).toHaveLength(6);
    expect(result.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "approval-cannot-be-bypassed", status: "fail" }),
      expect.objectContaining({
        id: "systemd-reclaims-service-child-processes",
        status: "unavailable",
      }),
      expect.objectContaining({ id: "pi-resource-baselines-recorded", status: "unavailable" }),
    ]));
  });
});