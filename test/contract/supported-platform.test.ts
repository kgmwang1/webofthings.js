import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const supportedPlatformFiles = [
  ".github/workflows/ci.yml",
  "README.md",
  "docs/operator-guide.md",
  "scripts/appliance-test.sh",
  "scripts/smoke-test.sh",
];

describe("supported appliance platform", () => {
  it("limits current release surfaces to Raspberry Pi 4", () => {
    const unsupportedModel = `pi${5}`;
    const unsupportedProductName = `raspberry pi ${5}`;
    for (const file of supportedPlatformFiles) {
      const content = readFileSync(resolve(file), "utf8").toLowerCase();
      expect(content, file).not.toContain(unsupportedModel);
      expect(content, file).not.toContain(unsupportedProductName);
    }

    expect(readFileSync(resolve("README.md"), "utf8")).toContain(
      "64-bit Raspberry Pi OS on Raspberry Pi 4",
    );
  });
});