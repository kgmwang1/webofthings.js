import { createServer } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../../src/config/config";
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

afterEach(async () => {
  await runtime?.shutdown.shutdown();
  runtime = undefined;
});

describe("PiDisplaySink HTTP exposure", () => {
  it("serves its TD, advertised forms, and initial properties on an ephemeral port", async () => {
    const config = testConfig();
    runtime = await startServientRuntime(config);
    await exposeDisplaySink(runtime, config);
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
      supportedProtocols: [],
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
      await exposeDisplaySink(runtime, config);

      const response = await fetch(
        `http://127.0.0.1:${runtime.httpServer.getPort()}${path}`,
      );
      expect(response.status).toBe(404);
    },
  );

  it("returns 405 for unsupported interaction methods and 415 for unsupported action media", async () => {
    const config = testConfig();
    runtime = await startServientRuntime(config);
    await exposeDisplaySink(runtime, config);
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
      exposeDisplaySink(runtime, config, malformed as WoT.ExposedThingInit),
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
    const { thing } = await exposeDisplaySink(runtime, config);
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
});