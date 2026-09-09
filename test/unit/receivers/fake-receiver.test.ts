import { describe, expect, it } from "vitest";

import type { ReceiverEvent } from "../../../src/receivers/receiver-adapter";
import { FakeReceiver } from "../../../src/receivers/fake-receiver";

describe("FakeReceiver", () => {
  it("drives receiver-neutral inbound and lifecycle events deterministically", async () => {
    const receiver = new FakeReceiver(["fake-a", "fake-b"]);
    const events: ReceiverEvent[] = [];
    await receiver.start((event) => events.push(event));
    receiver.request({
      protocol: "fake-a",
      requestedAt: "2026-09-09T10:00:00.000Z",
      sessionId: "one",
    });
    receiver.connected("one");
    receiver.playing("one");
    receiver.failure("one", "playback-failed", "Could not decode");
    receiver.disconnected("one");

    expect(receiver.supportedProtocols).toEqual(["fake-a", "fake-b"]);
    expect(events.map(({ type }) => type)).toEqual([
      "request",
      "connected",
      "playing",
      "failure",
      "disconnected",
    ]);
  });

  it("injects one operation failure without exposing controls in the adapter contract", async () => {
    const receiver = new FakeReceiver();
    await receiver.start(() => undefined);
    receiver.failNext("approve");

    await expect(receiver.approve("one")).rejects.toThrow("approve failed");
    await expect(receiver.approve("one")).resolves.toBeUndefined();
  });
});