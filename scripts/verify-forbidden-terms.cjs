const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");

const excludedPaths = new Set([
  "docs/migration.md",
  "scripts/verify-dependencies.cjs",
  "scripts/verify-forbidden-terms.cjs",
]);
const excludedPrefixes = [".copilot-tracking/"];
const rules = [
  ["obsolete Node.js version requirement", /node(?:\.js)?\s*(?:version\s*)?[<]\s*5(?:\.0\.0)?/i],
  ["removed observe API", /(?:Object|Array)\.observe\s*\(/],
  ["query credential", /query[- ]token|(?:req|request)\.query\.(?:key|token)|[?&](?:key|token)=/i],
  ["committed private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["sample hardware support", /\bGPIO\b|\bDHT22\b|\bnode-dht-sensor\b|\bonoff\b/],
  ["removed route", /["'`](?:\/api)?\/(?:things|models|resources)(?:\/|["'`])/],
];

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean)
  .filter((file) => !excludedPaths.has(file))
  .filter((file) => excludedPrefixes.every((prefix) => !file.startsWith(prefix)));
const violations = [];

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const [name, pattern] of rules) {
    if (pattern.test(content)) {
      violations.push(`${file}: ${name}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Forbidden legacy references found:\n${violations.join("\n")}`);
}
console.log(`Forbidden-term gate passed across ${files.length} source files.`);