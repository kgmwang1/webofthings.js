import { describe, expect, it, vi } from "vitest";

import { BrokerError } from "../../../src/broker/errors";
import {
  BROKER_CONTRACT_VERSION,
  SessionBroker,
} from "../../../src/broker/display-broker";
import { FakeReceiver } from "../../../src/receivers/fake-receiver";

const request = (sessionId: string) => ({
  protocol: "fake",
  requestedAt: "2026-09-09T10:00:00.000Z",
  senderName: "Living Room",
  sessionId,
});

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("SessionBroker", () => {
  it("exports a versioned broker contract", () => {
    expect(BROKER_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("serializes concurrent requests and returns a deterministic busy result", async () => {
    const receiver = new FakeReceiver();
    const broker = new SessionBroker(receiver);
    await broker.start();

    const [first, second] = await Promise.all([
      broker.receiveRequest(request("one")),
      broker.receiveRequest(request("two")),
    ]);

    expect(first).toEqual({ accepted: true, sessionId: "one" });
    expect(second).toEqual({
      accepted: false,
      activeSessionId: "one",
      reason: "busy",
    });
    expect(broker.snapshot().activeSession?.id).toBe("one");
  });

  it("approves, plays, and stops while publishing committed state first", async () => {
    const receiver = new FakeReceiver();
    const broker = new SessionBroker(receiver);
    const observations: string[] = [];
    broker.subscribe((snapshot, event) => {
      observations.push(`${snapshot.status}:${event?.type ?? "change"}`);
    });
    await broker.start();
    await broker.receiveRequest(request("one"));
    await broker.approve("one");
    receiver.playing("one");
    await settle();
    await broker.stop("one");

    expect(observations).toEqual([
      "pendingApproval:sessionRequested",
      "connecting:change",
      "playing:sessionStarted",
      "stopping:change",
      "idle:sessionEnded",
    ]);
    expect(broker.snapshot()).toMatchObject({ activeSession: null, status: "idle" });
  });

  it("preserves observations through connect and disconnect cycles", async () => {
    const receiver = new FakeReceiver();
    const broker = new SessionBroker(receiver);
    const observations: string[] = [];
    broker.subscribe((snapshot) => observations.push(snapshot.status));
    await broker.start();

    for (const sessionId of ["one", "two"]) {
      await broker.receiveRequest(request(sessionId));
      await broker.approve(sessionId);
      receiver.connected(sessionId);
      receiver.playing(sessionId);
      await settle();
      receiver.disconnected(sessionId);
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(observations).toEqual([
      "pendingApproval",
      "connecting",
      "playing",
      "idle",
      "pendingApproval",
      "connecting",
      "playing",
      "idle",
    ]);
  });

  it("expires approval and ignores stale events for a subsequent owner", async () => {
    vi.useFakeTimers();
    try {
      const receiver = new FakeReceiver();
      const broker = new SessionBroker(receiver, { approvalTtlMs: 100 });
      await broker.start();
      await broker.receiveRequest(request("old"));
      await vi.advanceTimersByTimeAsync(100);
      expect(broker.snapshot().status).toBe("idle");

      await broker.receiveRequest(request("new"));
      receiver.playing("old");
      receiver.failure("old");
      receiver.disconnected("old");
      await settle();
      expect(broker.snapshot()).toMatchObject({
        activeSession: { id: "new" },
        status: "pendingApproval",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets an approval queued at the deadline win before the expiry callback", async () => {
    vi.useFakeTimers();
    try {
      const receiver = new FakeReceiver();
      const broker = new SessionBroker(receiver, { approvalTtlMs: 100 });
      await broker.start();
      await broker.receiveRequest(request("one"));

      const expiry = vi.advanceTimersByTimeAsync(100);
      const approval = broker.approve("one");
      await expiry;

      await expect(approval).resolves.toBeUndefined();
      expect(broker.snapshot().status).toBe("connecting");
      expect(receiver.calls).toContainEqual({ operation: "approve", value: "one" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not allow receiver events to bypass session approval", async () => {
    const receiver = new FakeReceiver();
    const broker = new SessionBroker(receiver);
    await broker.start();
    await broker.receiveRequest(request("one"));

    receiver.connected("one");
    receiver.playing("one");
    await new Promise((resolve) => setImmediate(resolve));

    expect(broker.snapshot()).toMatchObject({
      activeSession: { id: "one", state: "pendingApproval" },
      status: "pendingApproval",
    });
    expect(receiver.calls).not.toContainEqual({ operation: "approve", value: "one" });
  });

  it("bounds stalled adapter cleanup and releases ownership", async () => {
    vi.useFakeTimers();
    try {
      const receiver = new FakeReceiver();
      receiver.stop = () => new Promise(() => undefined);
      const broker = new SessionBroker(receiver, { cleanupTimeoutMs: 100 });
      await broker.start();
      await broker.receiveRequest(request("one"));

      const stopping = broker.stop("one");
      await vi.advanceTimersByTimeAsync(200);
      await stopping;

      expect(broker.snapshot().status).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is idempotent for duplicate requests, terminal commands, and shutdown", async () => {
    const receiver = new FakeReceiver();
    const broker = new SessionBroker(receiver);
    await broker.start();
    await broker.receiveRequest(request("one"));
    await expect(broker.receiveRequest(request("one"))).resolves.toEqual({
      accepted: true,
      sessionId: "one",
    });
    await broker.approve("one");
    await broker.approve("one");
    expect(receiver.calls.filter(({ operation }) => operation === "approve")).toHaveLength(1);
    await broker.stop("one");
    await broker.stop("one");

    await broker.receiveRequest(request("two"));
    await broker.reject("two");
    await broker.reject("two");
    await Promise.all([broker.shutdown(), broker.shutdown()]);

    expect(receiver.calls.filter(({ operation }) => operation === "reject")).toHaveLength(1);
    expect(receiver.calls.filter(({ operation }) => operation === "shutdown")).toHaveLength(1);
  });

  it("surfaces safe adapter errors and releases ownership after cleanup", async () => {
    const receiver = new FakeReceiver();
    const broker = new SessionBroker(receiver);
    const events: string[] = [];
    broker.subscribe((_snapshot, event) => {
      if (event !== undefined) events.push(event.type);
    });
    await broker.start();
    await broker.receiveRequest(request("one"));
    receiver.failNext("approve", new Error("secret transport details"));

    await expect(broker.approve("one")).rejects.toMatchObject({
      code: "adapter-failure",
      message: "Receiver could not approve",
    } satisfies Partial<BrokerError>);
    expect(events).toContain("sessionError");
    expect(broker.snapshot().status).toBe("idle");
  });

  it("publishes only allowlisted request metadata and a generic failure message", async () => {
    const receiver = new FakeReceiver();
    const broker = new SessionBroker(receiver);
    const events: unknown[] = [];
    broker.subscribe((_snapshot, event) => events.push(event));
    await broker.start();
    await broker.receiveRequest({
      ...request("one"),
      credentials: "not-public",
      streamUrl: "https://user:password@example.test/private",
    } as Parameters<SessionBroker["receiveRequest"]>[0]);
    receiver.failure("one", "playback-failed", "password=not-public");
    await settle();

    expect(JSON.stringify(events)).not.toContain("not-public");
    expect(JSON.stringify(events)).not.toContain("streamUrl");
    expect(events).toContainEqual(expect.objectContaining({
      code: "playback-failed",
      message: "Receiver session failed",
      type: "sessionError",
    }));
  });

  it.each(["pendingApproval", "connecting", "playing"] as const)(
    "shuts down safely while %s",
    async (targetState) => {
      const receiver = new FakeReceiver();
      const broker = new SessionBroker(receiver);
      await broker.start();
      await broker.receiveRequest(request("one"));
      if (targetState !== "pendingApproval") await broker.approve("one");
      if (targetState === "playing") {
        receiver.playing("one");
        await settle();
      }

      await broker.shutdown();

      expect(broker.snapshot().status).toBe("idle");
      await expect(broker.receiveRequest(request("two"))).rejects.toMatchObject({
        code: "shutting-down",
      });
    },
  );
});