import { describe, expect, it } from "vitest";

import {
  decideTransition,
  sessionEventTypes,
  sessionStates,
  sessionTransitionTable,
} from "../../../src/broker/session-state";

describe("session transition contract", () => {
  it("defines a deterministic decision for every state and event pair", () => {
    for (const state of sessionStates) {
      expect(Object.keys(sessionTransitionTable[state])).toEqual(sessionEventTypes);
      for (const event of sessionEventTypes) {
        expect(sessionStates).toContain(decideTransition(state, event).state);
      }
    }
  });

  it("covers the complete successful session lifecycle", () => {
    expect(decideTransition("idle", "request")).toEqual({
      accepted: true,
      state: "pendingApproval",
    });
    expect(decideTransition("pendingApproval", "approve")).toEqual({
      accepted: true,
      state: "connecting",
    });
    expect(decideTransition("connecting", "playing")).toEqual({
      accepted: true,
      state: "playing",
    });
    expect(decideTransition("playing", "stop")).toEqual({
      accepted: true,
      state: "stopping",
    });
    expect(decideTransition("stopping", "cleanupComplete")).toEqual({
      accepted: true,
      state: "idle",
    });
  });

  it("makes duplicate terminal commands deterministic and safe", () => {
    expect(decideTransition("idle", "reject")).toEqual({
      accepted: false,
      reason: "already-terminal",
      state: "idle",
    });
    expect(decideTransition("stopping", "stop")).toEqual({
      accepted: true,
      state: "stopping",
    });
    expect(decideTransition("idle", "disconnect")).toEqual({
      accepted: false,
      reason: "already-terminal",
      state: "idle",
    });
    expect(decideTransition("idle", "shutdown")).toEqual({
      accepted: true,
      state: "idle",
    });
  });
});