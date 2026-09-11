const { mkdirSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const outputPath = resolve(process.argv[2] ?? "artifacts/pi-display-wot.cdx.json");
mkdirSync(dirname(outputPath), { recursive: true });

const executable = process.execPath;
const cliPath = resolve(__dirname, "../node_modules/@cyclonedx/cyclonedx-npm/bin/cyclonedx-npm-cli.js");
const result = spawnSync(
  executable,
  [
    cliPath,
    "--package-lock-only",
    "--omit",
    "dev",
    "--output-reproducible",
    "--validate",
    "--output-format",
    "JSON",
    "--output-file",
    outputPath,
  ],
  { encoding: "utf8", stdio: "inherit" },
);

if (result.error !== undefined) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
console.log(outputPath);