const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const softwareConditions = [
  {
    id: "versioned-broker-contract",
    file: "test/unit/broker/display-broker.test.ts",
    name: "exports a versioned broker contract",
  },
  {
    id: "fake-receiver-failure-injection",
    file: "test/unit/receivers/fake-receiver.test.ts",
    name: "injects one operation failure",
  },
  {
    id: "approval-cannot-be-bypassed",
    file: "test/unit/broker/display-broker.test.ts",
    name: "does not allow receiver events to bypass session approval",
  },
  {
    id: "observations-survive-connect-disconnect",
    file: "test/unit/broker/display-broker.test.ts",
    name: "preserves observations through connect and disconnect cycles",
  },
];

function runFocusedTest(condition) {
  const result = spawnSync(
    process.execPath,
    [
      resolve("node_modules/vitest/vitest.mjs"),
      "run",
      condition.file,
      "--testNamePattern",
      condition.name,
      "--reporter=dot",
    ],
    { encoding: "utf8" },
  );
  return {
    detail: result.status === 0
      ? "focused test passed"
      : (result.stderr || result.stdout || "focused test failed").trim().slice(-500),
    passed: result.status === 0,
  };
}

function evidenceCondition(id, available, valid, failureDetail) {
  if (!available) {
    return { detail: "required Pi 4 evidence is unavailable", id, status: "unavailable" };
  }
  return valid
    ? { detail: "recorded Pi 4 evidence passed", id, status: "pass" }
    : { detail: failureDetail, id, status: "fail" };
}

function evaluateMediaEntry({ evidence, runTest = runFocusedTest }) {
  const conditions = softwareConditions.map((condition) => {
    try {
      const result = runTest(condition);
      return {
        detail: result.detail,
        id: condition.id,
        status: result.passed ? "pass" : "fail",
      };
    } catch (error) {
      return {
        detail: error instanceof Error ? error.message : String(error),
        id: condition.id,
        status: "fail",
      };
    }
  });

  const evidenceAvailable = evidence !== undefined && evidence !== null;
  const systemd = evidence?.systemdChildProcessReaping;
  conditions.splice(3, 0, evidenceCondition(
    "systemd-reclaims-service-child-processes",
    evidenceAvailable,
    evidence?.platform === "raspberry-pi-4" &&
      systemd?.status === "pass" &&
      systemd?.service === "pi-display-wot.service" &&
      typeof systemd?.method === "string" && systemd.method.length > 0,
    "Pi 4 systemd child-process evidence is invalid or failed",
  ));

  const baseline = evidence?.resourceBaseline;
  conditions.push(evidenceCondition(
    "pi-resource-baselines-recorded",
    evidenceAvailable,
    evidence?.platform === "raspberry-pi-4" &&
      baseline?.status === "pass" &&
      baseline?.durationSeconds >= 86400 &&
      baseline?.sampleCount > 0 &&
      baseline?.rssKiB?.minimum > 0 &&
      baseline?.rssKiB?.maximum >= baseline?.rssKiB?.minimum &&
      baseline?.identityAnomalies === 0 &&
      baseline?.restartAnomalies === 0 &&
      baseline?.powerAnomalies === 0,
    "Pi 4 resource baseline is invalid or failed",
  ));

  return {
    schemaVersion: 1,
    gate: "real-media-entry",
    result: conditions.every(({ status }) => status === "pass") ? "pass" : "blocked",
    conditions,
  };
}

function parseArguments(arguments_) {
  const options = {
    evidence: resolve("evidence/pi4-release-baseline.json"),
    output: undefined,
  };
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if ((name !== "--evidence" && name !== "--output") || value === undefined) {
      throw new Error("usage: check-media-entry.cjs [--evidence PATH] [--output PATH]");
    }
    options[name.slice(2)] = resolve(value);
  }
  return options;
}

function readEvidence(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

if (require.main === module) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = evaluateMediaEntry({ evidence: readEvidence(options.evidence) });
    const output = `${JSON.stringify(result, null, 2)}\n`;
    if (options.output === undefined) process.stdout.write(output);
    else writeFileSync(options.output, output);
    process.exitCode = result.result === "pass" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

module.exports = { evaluateMediaEntry };