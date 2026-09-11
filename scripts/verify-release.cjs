const { createHash } = require("node:crypto");
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const { basename, resolve } = require("node:path");

const outputDirectory = resolve(process.argv[2] ?? "artifacts");
const manifestPath = resolve(outputDirectory, "SHA256SUMS");
if (!existsSync(manifestPath)) {
  throw new Error(`Missing checksum manifest: ${manifestPath}`);
}

const expectedSuffixes = [
  "-linux-arm64.tar.gz",
  ".cdx.json",
  "-dependencies.json",
  "-build-inputs.txt",
  "-media-entry.json",
];
const files = readdirSync(outputDirectory).filter((name) => name !== "SHA256SUMS");
for (const suffix of expectedSuffixes) {
  if (files.filter((name) => name.endsWith(suffix)).length !== 1) {
    throw new Error(`Expected exactly one release file ending in ${suffix}`);
  }
}

const checksumLines = readFileSync(manifestPath, "utf8").trim().split(/\r?\n/);
if (checksumLines.length !== files.length) {
  throw new Error("Checksum manifest does not cover every release file");
}
for (const line of checksumLines) {
  const match = /^([a-f0-9]{64}) [ *](.+)$/.exec(line);
  if (match === null) {
    throw new Error(`Invalid checksum line: ${line}`);
  }
  const filePath = resolve(outputDirectory, match[2]);
  if (basename(filePath) !== match[2] || !existsSync(filePath)) {
    throw new Error(`Checksum references an invalid file: ${match[2]}`);
  }
  const actual = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  if (actual !== match[1]) {
    throw new Error(`Checksum mismatch: ${match[2]}`);
  }
}

const sbomName = files.find((name) => name.endsWith(".cdx.json"));
const sbom = JSON.parse(readFileSync(resolve(outputDirectory, sbomName), "utf8"));
if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion === undefined) {
  throw new Error("Release SBOM is not a CycloneDX document");
}
const mediaEntryName = files.find((name) => name.endsWith("-media-entry.json"));
const mediaEntry = JSON.parse(readFileSync(resolve(outputDirectory, mediaEntryName), "utf8"));
if (
  mediaEntry.gate !== "real-media-entry" ||
  mediaEntry.result !== "pass" ||
  mediaEntry.conditions?.length !== 6 ||
  mediaEntry.conditions.some(({ status }) => status !== "pass")
) {
  throw new Error("Release media-entry gate is missing or blocked");
}
console.log(`Verified ${files.length} release files and their checksums.`);