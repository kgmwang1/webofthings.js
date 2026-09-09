import { createServer } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../../src/config/config";
import { SessionBroker } from "../../src/broker/display-broker";
import { FakeReceiver } from "../../src/receivers/fake-receiver";
import type { ServientRuntime } from "../../src/runtime/servient";
import { startServientRuntime } from "../../src/runtime/servient";
import { ShutdownController } from "../../src/runtime/shutdown";
import displaySinkTd from "../../src/things/display-sink.td.json";
import { exposeDisplaySink } from "../../src/things/expose-display-sink";

const advertisedBaseUrl = "http://display.example:19090/things";
let runtime: ServientRuntime | undefined;

function testConfig(port = 0) {
  return loadConfig({
    PI_DISPLAY_ADVERTISED_BASE_URL: advertisedBaseUrl,
    PI_DISPLAY_DEVICE_NAME: "Test Display",
    PI_DISPLAY_PORT: String(port),
    PI_DISPLAY_THING_ID: "urn:example:display:test",
  });
}

function testBroker(): { broker: SessionBroker; receiver: FakeReceiver } {
  const receiver = new FakeReceiver();
  return { broker: new SessionBroker(receiver), receiver };
}

afterEach(async () => {
  await runtime?.shutdown.shutdown();
  runtime = undefined;
});

describe("PiDisplaySink HTTP exposure", () => {
  it("serves its TD, advertised forms, and initial properties on an ephemeral port", async () => {
    const config = testConfig();
    runtime = await startServientRuntime(config);
    const { broker } = testBroker();
    await exposeDisplaySink(runtime, config, broker);
    const origin = `http://127.0.0.1:${runtime.httpServer.getPort()}`;

    const tdResponse = await fetch(`${origin}/pidisplaysink`);
    expect(tdResponse.status).toBe(200);
    expect(tdResponse.headers.get("content-type")).toContain("application/td+json");
    const td = (await tdResponse.json()) as {
      properties: Record<string, { forms: Array<{ href: string }> }>;
    };
    const formHrefs = Object.values(td.properties).flatMap(({ forms }) =>
      forms.map(({ href }) => href),
    );
    expect(formHrefs.length).toBeGreaterThan(0);
    expect(formHrefs.every((href) => href.startsWith(advertisedBaseUrl))).toBe(true);

    const expectedProperties: Record<string, unknown> = {
      activeSession: null,
      deviceName: "Test Display",
      status: "idle",
      supportedProtocols: ["fake"],
      volume: 100,
    };
    for (const [name, expected] of Object.entries(expectedProperties)) {
      const response = await fetch(`${origin}/pidisplaysink/properties/${name}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expected);
    }
  });

  it.each(["/model", "/properties", "/actions", "/restClient.html", "/websocketsClient.html"])(
    "returns 404 for removed legacy route %s",
    async (path) => {
      const config = testConfig();
      runtime = await startServientRuntime(config);
      const { broker } = testBroker();
      await exposeDisplaySink(runtime, config, broker);

      const response = await fetch(
        `http://127.0.0.1:${runtime.httpServer.getPort()}${path}`,
      );
      expect(response.status).toBe(404);
    },
  );

  it("returns 405 for unsupported interaction methods and 415 for unsupported action media", async () => {
    const config = testConfig();
    runtime = await startServientRuntime(config);
    const { broker } = testBroker();
    await exposeDisplaySink(runtime, config, broker);
    const origin = `http://127.0.0.1:${runtime.httpServer.getPort()}/pidisplaysink`;

    const methodResponse = await fetch(`${origin}/properties/status`, { method: "DELETE" });
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get("allow")).toContain("GET");

    const mediaResponse = await fetch(`${origin}/actions/setVolume`, {
      body: "100",
      headers: { "content-type": "application/yaml" },
      method: "POST",
    });
    expect(mediaResponse.status).toBe(415);
  });

  it("rolls back the listener when malformed TD input fails production", async () => {
    const config = testConfig();
    runtime = await startServientRuntime(config);
    const malformed = structuredClone(displaySinkTd);
    (malformed.properties.status as { type: string }).type = "invalid";

    await expect(
      exposeDisplaySink(
        runtime,
        config,
        testBroker().broker,
        malformed as WoT.ExposedThingInit,
      ),
    ).rejects.toThrow("Thing Description JSON schema validation failed");
    await runtime.shutdown.shutdown();
    expect(runtime.httpServer.getPort()).toBe(-1);
    runtime = undefined;
  });

  it("fails startup clearly when the configured port is occupied", async () => {
    const occupied = createServer();
    await new Promise<void>((resolve, reject) => {
      occupied.once("error", reject);
      occupied.listen(0, "127.0.0.1", resolve);
    });
    const address = occupied.address();
    if (address === null || typeof address === "string") {
      throw new Error("Test server did not bind a TCP port");
    }

    await expect(
      startServientRuntime(testConfig(address.port), new ShutdownController()),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
    await new Promise<void>((resolve, reject) =>
      occupied.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  });

  it("destroys the Thing before shutting down the Servient", async () => {
    const config = testConfig();
    runtime = await startServientRuntime(config);
    const { broker } = testBroker();
    const { thing } = await exposeDisplaySink(runtime, config, broker);
    const order: string[] = [];
    const destroyThing = thing.destroy.bind(thing);
    const shutdownServient = runtime.servient.shutdown.bind(runtime.servient);
    vi.spyOn(thing, "destroy").mockImplementation(async () => {
      order.push("thing");
      await destroyThing();
    });
    vi.spyOn(runtime.servient, "shutdown").mockImplementation(async () => {
      order.push("servient");
      await shutdownServient();
    });

    await runtime.shutdown.shutdown();
    expect(order).toEqual(["thing", "servient"]);
    runtime = undefined;
  });

  it("invokes validated actions and exposes committed broker state", async () => {
    const config = testConfig();
    runtime = await startServientRuntime(config);
    const { broker, receiver } = testBroker();
    await exposeDisplaySink(runtime, config, broker);
    const origin = `http://127.0.0.1:${runtime.httpServer.getPort()}/pidisplaysink`;

    await broker.receiveRequest({
      protocol: "fake",
      requestedAt: "2026-09-09T10:00:00.000Z",
      sessionId: "one",
    });
    const approve = await fetch(`${origin}/actions/approveSession`, {
      body: JSON.stringify({ sessionId: "one" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(approve.status).toBe(204);
    expect(await (await fetch(`${origin}/properties/status`)).json()).toBe("connecting");

    receiver.playing("one");
    await new Promise((resolve) => setImmediate(resolve));
    expect(await (await fetch(`${origin}/properties/status`)).json()).toBe("playing");

    const volume = await fetch(`${origin}/actions/setVolume`, {
      body: "35",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(volume.status).toBe(204);
    expect(await (await fetch(`${origin}/properties/volume`)).json()).toBe(35);
  });

  it("rejects malformed action payloads independently of handler invocation", async () => {
    const config = testConfig();
    runtime = await startServientRuntime(config);
    const { broker } = testBroker();
    await exposeDisplaySink(runtime, config, broker);
    const origin = `http://127.0.0.1:${runtime.httpServer.getPort()}/pidisplaysink`;

    const invalidSession = await fetch(`${origin}/actions/approveSession`, {
      body: JSON.stringify({ sessionId: "" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const invalidVolume = await fetch(`${origin}/actions/setVolume`, {
      body: "50.5",
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(invalidSession.status).toBe(500);
    expect(invalidVolume.status).toBe(500);
    expect(broker.snapshot()).toMatchObject({ status: "idle", volume: 100 });
  });

  it("delivers committed property changes through long-poll observation", async () => {
    const config = testConfig();
    runtime = await startServientRuntime(config);
    const { broker } = testBroker();
    await exposeDisplaySink(runtime, config, broker);
    const origin = `http://127.0.0.1:${runtime.httpServer.getPort()}/pidisplaysink`;
    const observation = fetch(`${origin}/properties/volume/observable`);
    await new Promise((resolve) => setTimeout(resolve, 25));

    await fetch(`${origin}/actions/setVolume`, {
      body: "42",
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    const response = await observation;
    expect(response.status).toBe(200);
    expect(await response.json()).toBe(42);
  });
});