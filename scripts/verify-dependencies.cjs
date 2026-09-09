const fs = require("node:fs");
const path = require("node:path");

const manifest = require("../package.json");
const expectedDependencies = {
  "@node-wot/binding-http": "0.9.2",
  "@node-wot/core": "0.9.2",
};
const prohibitedDependencies = new Set([
  "body-parser",
  "express",
  "handlebars",
  "msgpack5",
  "node-dht-sensor",
  "onoff",
  "websocket",
  "ws",
]);

if (JSON.stringify(manifest.dependencies) !== JSON.stringify(expectedDependencies)) {
  throw new Error("Direct runtime dependencies do not match the approved baseline");
}
for (const dependency of prohibitedDependencies) {
  if (
    dependency in (manifest.dependencies ?? {}) ||
    dependency in (manifest.optionalDependencies ?? {})
  ) {
    throw new Error(`Prohibited direct dependency: ${dependency}`);
  }
}
if (
  manifest.overrides?.["find-my-way"] !== "9.7.0" ||
  manifest.overrides?.uuid !== "11.1.1"
) {
  throw new Error("Dependency overrides do not match the approved baseline");
}

const sourceRoot = path.resolve(__dirname, "../src");
const pending = [sourceRoot];
while (pending.length > 0) {
  const currentPath = pending.pop();
  for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      pending.push(entryPath);
    } else if (fs.readFileSync(entryPath, "utf8").includes("TuyaCustomBearer")) {
      throw new Error(`Prohibited Tuya bearer is used by ${entryPath}`);
    }
  }
}

console.log("Direct dependencies and prohibited-feature checks passed.");