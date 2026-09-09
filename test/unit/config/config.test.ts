import { describe, expect, it } from "vitest";

import { loadConfig } from "../../../src/config/config";
import { ConfigurationError } from "../../../src/config/schema";

describe("loadConfig", () => {
  it("provides local development defaults", () => {
    expect(loadConfig({})).toEqual({
      advertisedBaseUrl: "http://127.0.0.1:8484",
      bindAddress: "127.0.0.1",
      boundary: {
        allowedOrigins: [],
        maxBodyBytes: 16_384,
        rateLimitMaxRequests: 60,
        rateLimitWindowMs: 60_000,
        replayWindowMs: 300_000,
      },
      deployed: false,
      deviceName: "Pi Display Sink",
      port: 8484,
      thingId: "urn:dev:wot:pi-display-sink",
    });
  });

  it("applies environment overrides and permits an ephemeral bind port", () => {
    expect(
      loadConfig({
        PI_DISPLAY_ADVERTISED_BASE_URL: "http://display.test:19090/things/",
        PI_DISPLAY_BIND_ADDRESS: "0.0.0.0",
        PI_DISPLAY_DEVICE_NAME: "Lab Display",
        PI_DISPLAY_PORT: "0",
        PI_DISPLAY_THING_ID: "urn:example:display:lab",
      }),
    ).toMatchObject({
      advertisedBaseUrl: "http://display.test:19090/things",
      bindAddress: "0.0.0.0",
      deviceName: "Lab Display",
      port: 0,
      thingId: "urn:example:display:lab",
    });
  });

  it("reports all invalid deployed settings with actionable names", () => {
    expect(() =>
      loadConfig({
        PI_DISPLAY_ADVERTISED_BASE_URL: "http://display.test",
        PI_DISPLAY_DEPLOYED: "true",
        PI_DISPLAY_PORT: "70000",
      }),
    ).toThrow(ConfigurationError);

    try {
      loadConfig({ PI_DISPLAY_DEPLOYED: "true" });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toContain("PI_DISPLAY_ADVERTISED_BASE_URL");
      expect((error as Error).message).toContain("PI_DISPLAY_BIND_ADDRESS");
      expect((error as Error).message).toContain("PI_DISPLAY_CORS_ALLOWED_ORIGINS");
      expect((error as Error).message).toContain("PI_DISPLAY_USERNAME");
      expect((error as Error).message).toContain("PI_DISPLAY_THING_ID");
      expect((error as Error).message).toContain("PI_DISPLAY_TLS_CERT_PATH");
    }
  });
});