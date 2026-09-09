import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { DisplaySinkConfig } from "../config/schema";

export type BoundaryNext = () => void;

interface RateWindow {
  count: number;
  startedAt: number;
}

const replayIdPattern = /^[A-Za-z0-9._~-]{16,128}$/;

function credentialsMatch(
  request: IncomingMessage,
  credentials: NonNullable<DisplaySinkConfig["credentials"]>,
): boolean {
  const authorization = request.headers.authorization;
  if (authorization === undefined || !authorization.startsWith("Basic ")) {
    return false;
  }

  let supplied: string;
  try {
    supplied = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = supplied.indexOf(":");
  if (separator < 0) {
    return false;
  }

  const expected = Buffer.from(`${credentials.username}:${credentials.password}`);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export class HttpBoundary {
  private readonly rates = new Map<string, RateWindow>();
  private readonly replayIds = new Map<string, number>();

  constructor(
    private readonly config: DisplaySinkConfig,
    private readonly now: () => number = Date.now,
  ) {}

  handle(
    request: IncomingMessage,
    response: ServerResponse,
    next: BoundaryNext,
  ): Promise<void> {
    const now = this.now();
    const client = request.socket.remoteAddress ?? "unknown";
    this.prune(now);

    if (!this.acceptRate(client, now)) {
      response.writeHead(429, {
        "Retry-After": String(Math.ceil(this.config.boundary.rateLimitWindowMs / 1_000)),
      });
      response.end("Too Many Requests");
      return Promise.resolve();
    }

    if (!this.applyCors(request, response)) {
      return Promise.resolve();
    }

    if (!this.acceptAuthentication(request, response)) {
      return Promise.resolve();
    }

    if (!this.acceptDeclaredBodySize(request, response)) {
      return Promise.resolve();
    }

    if (!this.acceptReplayId(request, response, now)) {
      return Promise.resolve();
    }

    next();
    return Promise.resolve();
  }

  private acceptRate(client: string, now: number): boolean {
    const existing = this.rates.get(client);
    if (
      existing === undefined ||
      now - existing.startedAt >= this.config.boundary.rateLimitWindowMs
    ) {
      this.rates.set(client, { count: 1, startedAt: now });
      return true;
    }
    existing.count += 1;
    return existing.count <= this.config.boundary.rateLimitMaxRequests;
  }

  private applyCors(request: IncomingMessage, response: ServerResponse): boolean {
    const origin = request.headers.origin;
    if (origin === undefined) {
      return true;
    }
    if (!this.config.boundary.allowedOrigins.includes(origin)) {
      response.writeHead(403);
      response.end("Origin Not Allowed");
      return false;
    }

    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Vary", "Origin");
    const setHeader = response.setHeader.bind(response);
    response.setHeader = ((name: string, value: number | string | readonly string[]) =>
      setHeader(
        name,
        name.toLowerCase() === "access-control-allow-origin" ? origin : value,
      )) as ServerResponse["setHeader"];
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-ID",
        "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
        "Access-Control-Max-Age": "600",
      });
      response.end();
      return false;
    }
    return true;
  }

  private acceptAuthentication(
    request: IncomingMessage,
    response: ServerResponse,
  ): boolean {
    if (
      !this.config.deployed ||
      (this.config.credentials !== undefined &&
        credentialsMatch(request, this.config.credentials))
    ) {
      return true;
    }

    response.writeHead(401, {
      "WWW-Authenticate": `Basic realm="${this.config.thingId}"`,
    });
    response.end("Unauthorized");
    return false;
  }

  private acceptDeclaredBodySize(
    request: IncomingMessage,
    response: ServerResponse,
  ): boolean {
    if (request.method !== "POST" && request.method !== "PUT") {
      return true;
    }
    const header = request.headers["content-length"];
    if (header === undefined) {
      return true;
    }
    const length = Number(header);
    if (!Number.isSafeInteger(length) || length < 0) {
      response.writeHead(400);
      response.end("Invalid Content-Length");
      return false;
    }
    if (length > this.config.boundary.maxBodyBytes) {
      response.writeHead(413);
      response.end("Payload Too Large");
      return false;
    }
    return true;
  }

  private acceptReplayId(
    request: IncomingMessage,
    response: ServerResponse,
    now: number,
  ): boolean {
    if (
      !this.config.deployed ||
      request.method !== "POST" ||
      this.config.credentials === undefined
    ) {
      return true;
    }

    const replayId = request.headers["x-request-id"];
    if (typeof replayId !== "string") {
      response.writeHead(428);
      response.end("X-Request-ID Required");
      return false;
    }
    if (!replayIdPattern.test(replayId)) {
      response.writeHead(400);
      response.end("Invalid X-Request-ID");
      return false;
    }
    if (this.replayIds.has(replayId)) {
      response.writeHead(409);
      response.end("Request Replayed");
      return false;
    }
    this.replayIds.set(replayId, now);
    return true;
  }

  private prune(now: number): void {
    for (const [client, window] of this.rates) {
      if (now - window.startedAt >= this.config.boundary.rateLimitWindowMs) {
        this.rates.delete(client);
      }
    }
    for (const [requestId, seenAt] of this.replayIds) {
      if (now - seenAt >= this.config.boundary.replayWindowMs) {
        this.replayIds.delete(requestId);
      }
    }
  }
}