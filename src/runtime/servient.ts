import { Servient } from "@node-wot/core";
import { HttpServer } from "@node-wot/binding-http";

import type { DisplaySinkConfig } from "../config/schema";

import {
  type StartupStep,
  ShutdownController,
  startWithRollback,
} from "./shutdown";

export interface ServientRuntime {
  readonly httpServer: HttpServer;
  readonly servient: Servient;
  readonly shutdown: ShutdownController;
  readonly wot: typeof WoT;
}

function enforceInteractionMethods(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  next: () => void,
): Promise<void> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const method = request.method ?? "GET";
  const routeMethods = [
    { pattern: /^\/[^/]+$/, allowed: ["GET", "HEAD"] },
    { pattern: /^\/[^/]+\/properties(?:\/[^/]+)?$/, allowed: ["GET", "HEAD", "OPTIONS"] },
    { pattern: /^\/[^/]+\/actions\/[^/]+$/, allowed: ["POST", "OPTIONS"] },
    { pattern: /^\/[^/]+\/events\/[^/]+$/, allowed: ["GET", "HEAD", "OPTIONS"] },
  ].find(({ pattern }) => pattern.test(path));

  if (routeMethods !== undefined && !routeMethods.allowed.includes(method)) {
    response.writeHead(405, { Allow: routeMethods.allowed.join(", ") });
    response.end("Method Not Allowed");
    return Promise.resolve();
  }

  next();
  return Promise.resolve();
}

export async function startServientRuntime(
  config: DisplaySinkConfig,
  shutdown = new ShutdownController(),
): Promise<ServientRuntime> {
  const servient = new Servient();
  const httpServer = new HttpServer({
    address: config.bindAddress,
    baseUri: config.advertisedBaseUrl,
    port: config.port,
    ...(config.tls === undefined
      ? {}
      : {
          serverCert: config.tls.certificatePath,
          serverKey: config.tls.keyPath,
        }),
      middleware: enforceInteractionMethods,
    security: [{ scheme: config.deployed ? "basic" : "nosec" }],
  });
  servient.addServer(httpServer);
  if (config.credentials !== undefined) {
    servient.addCredentials({ [config.thingId]: [config.credentials] });
  }

  let wot: typeof WoT | undefined;
  const steps: readonly StartupStep[] = [
    {
      name: "Servient",
      start: async () => {
        wot = await servient.start();
        return () => servient.shutdown();
      },
    },
  ];

  await startWithRollback(steps, shutdown);

  if (wot === undefined) {
    throw new Error("Servient started without a WoT runtime");
  }

  return { httpServer, servient, shutdown, wot };
}