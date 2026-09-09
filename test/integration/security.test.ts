import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { SessionBroker } from "../../src/broker/display-broker";
import { loadConfig } from "../../src/config/config";
import { FakeReceiver } from "../../src/receivers/fake-receiver";
import type { ServientRuntime } from "../../src/runtime/servient";
import { startServientRuntime } from "../../src/runtime/servient";
import { exposeDisplaySink } from "../../src/things/expose-display-sink";

const identityDirectory = join(tmpdir(), `pi-display-security-${process.pid}`);
const certificatePath = join(identityDirectory, "device.crt");
const keyPath = join(identityDirectory, "device.key");
const username = "security-test";
const password = "test-password-not-a-secret";
const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
let runtime: ServientRuntime | undefined;

function bashPath(path: string): string {
  return process.platform === "win32"
    ? path.replace(/^([A-Za-z]):/, (_, drive: string) => `/mnt/${drive.toLowerCase()}`).replaceAll("\\", "/")
    : path;
}

function deployedConfig(overrides: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    PI_DISPLAY_ADVERTISED_BASE_URL: "https://display.example/things",
    PI_DISPLAY_BIND_ADDRESS: "127.0.0.1",
    PI_DISPLAY_CORS_ALLOWED_ORIGINS: "https://controller.example",
    PI_DISPLAY_DEPLOYED: "true",
    PI_DISPLAY_PASSWORD: password,
    PI_DISPLAY_PORT: "0",
    PI_DISPLAY_THING_ID: "urn:example:display:secure-test",
    PI_DISPLAY_TLS_CERT_PATH: certificatePath,
    PI_DISPLAY_TLS_KEY_PATH: keyPath,
    PI_DISPLAY_USERNAME: username,
    ...overrides,
  });
}

interface SecureRequestOptions {
  readonly body?: string;
  readonly headers?: Record<string, string>;
  readonly method?: string;
  readonly path: string;
}

function secureRequest(options: SecureRequestOptions): Promise<{
  body: string;
  headers: import("node:http").IncomingHttpHeaders;
  status: number;
}> {
  if (runtime === undefined) {
    throw new Error("Secure runtime has not started");
  }
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        headers: options.headers,
        hostname: "127.0.0.1",
        method: options.method ?? "GET",
        path: options.path,
        port: runtime?.httpServer.getPort(),
        rejectUnauthorized: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            status: response.statusCode ?? 0,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(options.body);
  });
}

async function startSecureRuntime(environment: NodeJS.ProcessEnv = {}): Promise<SessionBroker> {
  const config = deployedConfig(environment);
  runtime = await startServientRuntime(config);
  const broker = new SessionBroker(new FakeReceiver());
  await exposeDisplaySink(runtime, config, broker);
  return broker;
}

beforeAll(() => {
  mkdirSync(identityDirectory, { recursive: true });
  const certificate = bashPath(certificatePath);
  const key = bashPath(keyPath);
  execFileSync("bash", [
    "-lc",
    `openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 1 -subj /CN=localhost -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' -keyout '${key}' -out '${certificate}' 2>/dev/null`,
  ]);
});

afterEach(async () => {
  await runtime?.shutdown.shutdown();
  runtime = undefined;
});

afterAll(() => rmSync(identityDirectory, { force: true, recursive: true }));

describe("deployed HTTPS boundary", () => {
  it("fails startup when provisioned TLS identity files are invalid", async () => {
    await expect(
      startServientRuntime(
        deployedConfig({ PI_DISPLAY_TLS_CERT_PATH: join(identityDirectory, "missing.crt") }),
      ),
    ).rejects.toThrow();
  });

  it("requires Basic credentials for the TD, properties, and actions without leaking them", async () => {
    await startSecureRuntime();

    expect((await secureRequest({ path: "/pidisplaysink" })).status).toBe(401);
    expect(
      (await secureRequest({
        headers: { authorization: "Basic aW52YWxpZDppbnZhbGlk" },
        path: "/pidisplaysink/properties/status",
      })).status,
    ).toBe(401);
    expect(
      (await secureRequest({
        body: "25",
        headers: {
          authorization: "Basic aW52YWxpZDppbnZhbGlk",
          "content-type": "application/json",
          "x-request-id": "invalid-credential-request",
        },
        method: "POST",
        path: "/pidisplaysink/actions/setVolume",
      })).status,
    ).toBe(401);

    const tdResponse = await secureRequest({
      headers: { authorization },
      path: "/pidisplaysink",
    });
    expect(tdResponse.status).toBe(200);
    const td = JSON.parse(tdResponse.body) as Record<string, unknown>;
    expect(td.security).toBe("basic_sc");
    expect(JSON.stringify(td)).not.toContain(username);
    expect(JSON.stringify(td)).not.toContain(password);
    expect(JSON.stringify(td)).not.toContain("nosec");
  });

  it("allows only configured CORS origins and preserves that origin on the TD route", async () => {
    await startSecureRuntime();
    const allowed = await secureRequest({
      headers: { authorization, origin: "https://controller.example" },
      path: "/pidisplaysink",
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://controller.example");

    const denied = await secureRequest({
      headers: { authorization, origin: "https://attacker.example" },
      path: "/pidisplaysink/properties/status",
    });
    expect(denied.status).toBe(403);

    const preflight = await secureRequest({
      headers: { origin: "https://controller.example" },
      method: "OPTIONS",
      path: "/pidisplaysink/actions/setVolume",
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("rejects declared oversized bodies before Node-WoT consumes them", async () => {
    await startSecureRuntime({ PI_DISPLAY_MAX_BODY_BYTES: "8" });
    const response = await secureRequest({
      body: "123456789",
      headers: {
        authorization,
        "content-length": "9",
        "content-type": "application/json",
        "x-request-id": "oversized-request-0001",
      },
      method: "POST",
      path: "/pidisplaysink/actions/setVolume",
    });
    expect(response.status).toBe(413);
  });

  it("rate-limits the socket peer regardless of spoofed forwarding headers", async () => {
    await startSecureRuntime({ PI_DISPLAY_RATE_LIMIT_MAX_REQUESTS: "1" });
    expect(
      (await secureRequest({ headers: { authorization }, path: "/pidisplaysink" })).status,
    ).toBe(200);
    const throttled = await secureRequest({
      headers: { authorization, "x-forwarded-for": "203.0.113.50" },
      path: "/pidisplaysink",
    });
    expect(throttled.status).toBe(429);
  });

  it("requires replay IDs for authenticated actions and rejects reuse", async () => {
    await startSecureRuntime();
    const request = (requestId?: string) =>
      secureRequest({
        body: "25",
        headers: {
          authorization,
          "content-type": "application/json",
          ...(requestId === undefined ? {} : { "x-request-id": requestId }),
        },
        method: "POST",
        path: "/pidisplaysink/actions/setVolume",
      });

    expect((await request()).status).toBe(428);
    expect((await request("volume-request-0001")).status).toBe(204);
    expect((await request("volume-request-0001")).status).toBe(409);
  });

  it("keeps one approval owner under request exhaustion and rejects spoofed approval", async () => {
    const broker = await startSecureRuntime();
    await broker.receiveRequest({
      protocol: "fake",
      requestedAt: "2026-09-09T10:00:00.000Z",
      sessionId: "owner",
    });
    const attempts = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        broker.receiveRequest({
          protocol: "fake",
          requestedAt: "2026-09-09T10:00:00.000Z",
          sessionId: `spoof-${index}`,
        }),
      ),
    );
    expect(attempts.every((attempt) => !attempt.accepted && attempt.reason === "busy")).toBe(true);

    const approval = await secureRequest({
      body: JSON.stringify({ sessionId: "spoof-0" }),
      headers: {
        authorization,
        "content-type": "application/json",
        "x-request-id": "spoofed-approval-0001",
      },
      method: "POST",
      path: "/pidisplaysink/actions/approveSession",
    });
    expect(approval.status).toBe(500);
    expect(broker.snapshot().activeSession).toMatchObject({ id: "owner", state: "pendingApproval" });
  });
});