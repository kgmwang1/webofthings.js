export interface DisplaySinkConfig {
  readonly advertisedBaseUrl: string;
  readonly bindAddress: string;
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
  deployed: "PI_DISPLAY_DEPLOYED",
  deviceName: "PI_DISPLAY_DEVICE_NAME",
  password: "PI_DISPLAY_PASSWORD",
  port: "PI_DISPLAY_PORT",
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