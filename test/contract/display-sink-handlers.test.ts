import { describe, expect, it } from "vitest";

import displaySinkTd from "../../src/things/display-sink.td.json";
import {
  parseSessionCommand,
  parseVolume,
} from "../../src/things/expose-display-sink";

describe("PiDisplaySink handler contract", () => {
  it.each(["approveSession", "rejectSession", "stopSession"] as const)(
    "validates %s independently in agreement with its TD schema",
    (action) => {
      expect(displaySinkTd.actions[action].input).toMatchObject({
        required: ["sessionId"],
        type: "object",
      });
      expect(parseSessionCommand({ sessionId: "session-1" })).toEqual({
        sessionId: "session-1",
      });
      expect(() => parseSessionCommand({})).toThrow("non-empty sessionId");
      expect(() => parseSessionCommand({ sessionId: "" })).toThrow("non-empty sessionId");
      expect(() => parseSessionCommand("session-1")).toThrow("non-empty sessionId");
    },
  );

  it("validates setVolume independently in agreement with its TD schema", () => {
    expect(displaySinkTd.actions.setVolume.input).toMatchObject({
      maximum: 100,
      minimum: 0,
      type: "integer",
    });
    expect(parseVolume(0)).toBe(0);
    expect(parseVolume(100)).toBe(100);
    expect(() => parseVolume(-1)).toThrow("integer from 0 to 100");
    expect(() => parseVolume(50.5)).toThrow("integer from 0 to 100");
    expect(() => parseVolume("50")).toThrow("integer from 0 to 100");
  });
});