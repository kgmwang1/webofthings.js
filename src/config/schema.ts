export interface DisplaySinkConfig {
  readonly advertisedBaseUrl: string;
  readonly bindAddress: string;
  readonly boundary: {
    readonly allowedOrigins: readonly string[];
    readonly maxBodyBytes: number;
    readonly rateLimitMaxRequests: number;
    readonly rateLimitWindowMs: number;
    readonly replayWindowMs: number;
  };
  readonly credentials?: {
    readonly password: string;
    readonly username: string;
  };
  readonly deployed: boolean;
  readonly deviceName: string;
  readonly port: number;
  readonly thingId: string;
  readonly tls?: {
    readonly certificatePath: string;
    readonly keyPath: string;
  };
}

export const configEnvironment = {
  advertisedBaseUrl: "PI_DISPLAY_ADVERTISED_BASE_URL",
  bindAddress: "PI_DISPLAY_BIND_ADDRESS",
  corsAllowedOrigins: "PI_DISPLAY_CORS_ALLOWED_ORIGINS",
  deployed: "PI_DISPLAY_DEPLOYED",
  deviceName: "PI_DISPLAY_DEVICE_NAME",
  maxBodyBytes: "PI_DISPLAY_MAX_BODY_BYTES",
  password: "PI_DISPLAY_PASSWORD",
  port: "PI_DISPLAY_PORT",
  rateLimitMaxRequests: "PI_DISPLAY_RATE_LIMIT_MAX_REQUESTS",
  rateLimitWindowMs: "PI_DISPLAY_RATE_LIMIT_WINDOW_MS",
  replayWindowMs: "PI_DISPLAY_REPLAY_WINDOW_MS",
  thingId: "PI_DISPLAY_THING_ID",
  tlsCertificatePath: "PI_DISPLAY_TLS_CERT_PATH",
  tlsKeyPath: "PI_DISPLAY_TLS_KEY_PATH",
  username: "PI_DISPLAY_USERNAME",
} as const;

export class ConfigurationError extends Error {
  constructor(readonly diagnostics: readonly string[]) {
    super(`Invalid display sink configuration:\n- ${diagnostics.join("\n- ")}`);
    this.name = "ConfigurationError";
  }
}