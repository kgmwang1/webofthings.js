import Helpers from "@node-wot/core/dist/helpers";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config/config";
import displaySinkTd from "../../src/things/display-sink.td.json";
import { createDisplaySinkTd } from "../../src/things/expose-display-sink";

describe("PiDisplaySink Thing Description", () => {
  it("is a valid TD 1.1 exposed Thing contract", () => {
    expect(displaySinkTd["@context"]).toBe("https://www.w3.org/2022/wot/td/v1.1");
    expect(Helpers.validateExposedThingInit(displaySinkTd).valid).toBe(true);
    expect(displaySinkTd.security).toBe("nosec_sc");
    expect(displaySinkTd.securityDefinitions.nosec_sc.scheme).toBe("nosec");
  });

  it("declares the complete property, action, and event surface", () => {
    expect(Object.keys(displaySinkTd.properties)).toEqual([
      "status",
      "activeSession",
      "supportedProtocols",
      "deviceName",
      "volume",
    ]);
    expect(Object.keys(displaySinkTd.actions)).toEqual([
      "approveSession",
      "rejectSession",
      "stopSession",
      "setVolume",
    ]);
    expect(Object.keys(displaySinkTd.events)).toEqual([
      "sessionRequested",
      "sessionStarted",
      "sessionEnded",
      "sessionError",
    ]);
    expect(displaySinkTd.properties.volume).toMatchObject({
      maximum: 100,
      minimum: 0,
      readOnly: true,
      type: "integer",
      unit: "%",
    });
    expect(displaySinkTd.properties.activeSession.oneOf[0]).toEqual({ type: "null" });
  });

  it("rejects malformed TD input", () => {
    const malformed = structuredClone(displaySinkTd);
    (malformed.properties.status as { type: string }).type = "invalid";

    expect(Helpers.validateExposedThingInit(malformed).valid).toBe(false);
  });

  it("uses Basic security instead of nosec in deployed mode", () => {
    const config = loadConfig({
      PI_DISPLAY_ADVERTISED_BASE_URL: "https://display.example/things",
      PI_DISPLAY_DEPLOYED: "true",
      PI_DISPLAY_PASSWORD: "test-password",
      PI_DISPLAY_TLS_CERT_PATH: "test-cert.pem",
      PI_DISPLAY_TLS_KEY_PATH: "test-key.pem",
      PI_DISPLAY_USERNAME: "test-user",
    });
    const td = createDisplaySinkTd(config);

    expect(td.security).toBe("basic_sc");
    expect(td.securityDefinitions).toEqual({
      basic_sc: { in: "header", scheme: "basic" },
    });
  });
});