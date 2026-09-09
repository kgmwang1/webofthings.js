import {
  configEnvironment,
  ConfigurationError,
  type DisplaySinkConfig,
} from "./schema";
import { isAbsolute } from "node:path";

const defaultPort = 8484;

function parsePositiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  diagnostics: string[],
): number {
  const value = environment[name];
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    diagnostics.push(`${name} must be a positive integer`);
    return fallback;
  }
  return parsed;
}

function parseBoolean(value: string | undefined, diagnostics: string[]): boolean {
  if (value === undefined || value === "false") {
    return false;
  }
  if (value === "true") {
    return true;
  }

  diagnostics.push(`${configEnvironment.deployed} must be "true" or "false"`);
  return false;
}

function parsePort(value: string | undefined, diagnostics: string[]): number {
  if (value === undefined) {
    return defaultPort;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    diagnostics.push(`${configEnvironment.port} must be an integer from 0 through 65535`);
    return defaultPort;
  }

  return port;
}

function requiredValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  diagnostics: string[],
): string | undefined {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) {
    diagnostics.push(`${name} is required in deployed mode`);
    return undefined;
  }
  return value;
}

function parseAdvertisedBaseUrl(
  value: string,
  deployed: boolean,
  diagnostics: string[],
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    diagnostics.push(`${configEnvironment.advertisedBaseUrl} must be an absolute HTTP(S) URL`);
    return value;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    diagnostics.push(`${configEnvironment.advertisedBaseUrl} must use HTTP or HTTPS`);
  }
  if (deployed && url.protocol !== "https:") {
    diagnostics.push(`${configEnvironment.advertisedBaseUrl} must use HTTPS in deployed mode`);
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    diagnostics.push(`${configEnvironment.advertisedBaseUrl} must not contain a query or fragment`);
  }

  return url.toString().replace(/\/$/, "");
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): DisplaySinkConfig {
  const diagnostics: string[] = [];
  const deployed = parseBoolean(environment[configEnvironment.deployed], diagnostics);
  const port = parsePort(environment[configEnvironment.port], diagnostics);
  const configuredBindAddress = environment[configEnvironment.bindAddress]?.trim();
  const bindAddress = configuredBindAddress || "127.0.0.1";
  const configuredThingId = environment[configEnvironment.thingId]?.trim();
  const thingId = configuredThingId || "urn:dev:wot:pi-display-sink";
  const deviceName = environment[configEnvironment.deviceName]?.trim() || "Pi Display Sink";

  if (deployed && !configuredBindAddress) {
    diagnostics.push(`${configEnvironment.bindAddress} is required in deployed mode`);
  }
  if (deployed && !configuredThingId) {
    diagnostics.push(`${configEnvironment.thingId} is required in deployed mode`);
  }

  if (bindAddress.includes("://")) {
    diagnostics.push(`${configEnvironment.bindAddress} must be a host or IP address, not a URL`);
  }
  if (deviceName.length === 0) {
    diagnostics.push(`${configEnvironment.deviceName} must not be empty`);
  }

  try {
    new URL(thingId);
  } catch {
    diagnostics.push(`${configEnvironment.thingId} must be an absolute URI`);
  }

  const configuredBaseUrl = environment[configEnvironment.advertisedBaseUrl]?.trim();
  if (deployed && !configuredBaseUrl) {
    diagnostics.push(`${configEnvironment.advertisedBaseUrl} is required in deployed mode`);
  }
  const advertisedBaseUrl = parseAdvertisedBaseUrl(
    configuredBaseUrl || `http://127.0.0.1:${port}`,
    deployed,
    diagnostics,
  );

  const username = deployed
    ? requiredValue(environment, configEnvironment.username, diagnostics)
    : environment[configEnvironment.username]?.trim();
  const password = deployed
    ? requiredValue(environment, configEnvironment.password, diagnostics)
    : environment[configEnvironment.password];
  const certificatePath = deployed
    ? requiredValue(environment, configEnvironment.tlsCertificatePath, diagnostics)
    : environment[configEnvironment.tlsCertificatePath]?.trim();
  const keyPath = deployed
    ? requiredValue(environment, configEnvironment.tlsKeyPath, diagnostics)
    : environment[configEnvironment.tlsKeyPath]?.trim();

  if (deployed && username !== undefined && username.includes(":")) {
    diagnostics.push(`${configEnvironment.username} must not contain a colon`);
  }
  if (deployed && password !== undefined && password.length < 16) {
    diagnostics.push(`${configEnvironment.password} must contain at least 16 characters`);
  }
  for (const [name, path] of [
    [configEnvironment.tlsCertificatePath, certificatePath],
    [configEnvironment.tlsKeyPath, keyPath],
  ] as const) {
    if (deployed && path !== undefined && !isAbsolute(path)) {
      diagnostics.push(`${name} must be an absolute path in deployed mode`);
    }
  }

  const configuredOrigins = environment[configEnvironment.corsAllowedOrigins]?.trim();
  if (deployed && !configuredOrigins) {
    diagnostics.push(`${configEnvironment.corsAllowedOrigins} is required in deployed mode`);
  }
  const allowedOrigins = (configuredOrigins ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  for (const origin of allowedOrigins) {
    try {
      const parsed = new URL(origin);
      if (parsed.origin !== origin || (deployed && parsed.protocol !== "https:")) {
        diagnostics.push(`${configEnvironment.corsAllowedOrigins} entries must be HTTPS origins in deployed mode`);
      }
    } catch {
      diagnostics.push(`${configEnvironment.corsAllowedOrigins} entries must be absolute origins`);
    }
  }
  if (allowedOrigins.includes("*")) {
    diagnostics.push(`${configEnvironment.corsAllowedOrigins} must not contain a wildcard`);
  }

  const maxBodyBytes = parsePositiveInteger(
    environment,
    configEnvironment.maxBodyBytes,
    16_384,
    diagnostics,
  );
  const rateLimitMaxRequests = parsePositiveInteger(
    environment,
    configEnvironment.rateLimitMaxRequests,
    60,
    diagnostics,
  );
  const rateLimitWindowMs = parsePositiveInteger(
    environment,
    configEnvironment.rateLimitWindowMs,
    60_000,
    diagnostics,
  );
  const replayWindowMs = parsePositiveInteger(
    environment,
    configEnvironment.replayWindowMs,
    300_000,
    diagnostics,
  );

  if ((username === undefined) !== (password === undefined)) {
    diagnostics.push(`${configEnvironment.username} and ${configEnvironment.password} must be set together`);
  }
  if ((certificatePath === undefined) !== (keyPath === undefined)) {
    diagnostics.push(`${configEnvironment.tlsCertificatePath} and ${configEnvironment.tlsKeyPath} must be set together`);
  }
  if (diagnostics.length > 0) {
    throw new ConfigurationError(diagnostics);
  }

  return {
    advertisedBaseUrl,
    bindAddress,
    boundary: {
      allowedOrigins,
      maxBodyBytes,
      rateLimitMaxRequests,
      rateLimitWindowMs,
      replayWindowMs,
    },
    ...(username !== undefined && password !== undefined
      ? { credentials: { password, username } }
      : {}),
    deployed,
    deviceName,
    port,
    thingId,
    ...(certificatePath !== undefined && keyPath !== undefined
      ? { tls: { certificatePath, keyPath } }
      : {}),
  };
}