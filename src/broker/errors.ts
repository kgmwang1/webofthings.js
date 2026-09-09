export type BrokerErrorCode =
  | "adapter-failure"
  | "invalid-input"
  | "invalid-transition"
  | "session-not-found"
  | "shutting-down";

export interface BrokerErrorMapping {
  readonly actionMessage: string;
  readonly status: 400 | 404 | 409 | 503;
}

export const brokerErrorMappings: Readonly<Record<BrokerErrorCode, BrokerErrorMapping>> = {
  "adapter-failure": { actionMessage: "Receiver operation failed", status: 503 },
  "invalid-input": { actionMessage: "Invalid action input", status: 400 },
  "invalid-transition": { actionMessage: "Action is not valid in the current state", status: 409 },
  "session-not-found": { actionMessage: "Session is not current", status: 404 },
  "shutting-down": { actionMessage: "Display sink is shutting down", status: 503 },
};

export class BrokerError extends Error {
  constructor(
    readonly code: BrokerErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BrokerError";
  }
}

export function asBrokerError(error: unknown, operation: string): BrokerError {
  if (error instanceof BrokerError) {
    return error;
  }

  return new BrokerError(
    "adapter-failure",
    `Receiver could not ${operation}`,
    { cause: error },
  );
}

export function toActionError(error: unknown): Error {
  if (error instanceof BrokerError) {
    return new Error(brokerErrorMappings[error.code].actionMessage, { cause: error });
  }
  return new Error("Display sink action failed", { cause: error });
}