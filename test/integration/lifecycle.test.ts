import { spawn } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

interface ProcessResult {
  readonly code: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function runWithSignal(signal: NodeJS.Signals): Promise<ProcessResult> {
  const entryPoint = path.resolve(__dirname, "../../dist/main.js");
  const script = [
    `const { run } = require(${JSON.stringify(entryPoint)});`,
    "const originalLog = console.log;",
    "console.log = (...args) => {",
    "originalLog(...args);",
    `if (args[0] === "Runtime started") setImmediate(() => process.emit(${JSON.stringify(signal)}));`,
    "};",
    "void run().catch((error) => { console.error(error); process.exitCode = 1; });",
  ].join(" ");
  const child = spawn(process.execPath, ["--eval", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    let stderr = "";
    let stdout = "";
    let shutdownTimeout: NodeJS.Timeout | undefined;
    const startupTimeout = setTimeout(() => {
      child.kill();
      reject(new Error("Runtime did not start within 15 seconds"));
    }, 15_000);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.includes("Runtime started") && shutdownTimeout === undefined) {
        clearTimeout(startupTimeout);
        shutdownTimeout = setTimeout(() => {
          child.kill();
          reject(new Error(`Runtime did not stop within 3 seconds after ${signal}`));
        }, 3_000);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(startupTimeout);
      clearTimeout(shutdownTimeout);
      resolve({ code, stderr, stdout });
    });
  });
}

describe.each(["SIGINT", "SIGTERM"] as const)(
  "runtime lifecycle for %s",
  (signal) => {
    it(
      "stops cleanly within the shutdown bound",
      async () => {
        const result = await runWithSignal(signal);

        expect(result.code).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain("Runtime started");
        expect(result.stdout).toContain(`Runtime stopped after ${signal}`);
      },
      20_000,
    );
  },
);