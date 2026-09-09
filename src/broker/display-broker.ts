import { BrokerError, asBrokerError } from "./errors";
import type {
  PublicSessionMetadata,
  RequestResult,
  SessionSnapshot,
  TerminalReason,
} from "./session-state";
import type {
  ReceiverAdapter,
  ReceiverEvent,
  ReceiverRequest,
} from "../receivers/receiver-adapter";

export interface BrokerScheduler {
  clearTimeout(handle: unknown): void;
  setTimeout(callback: () => void, delayMs: number): unknown;
}

export interface BrokerOptions {
  readonly approvalTtlMs?: number;
  readonly cleanupTimeoutMs?: number;
  readonly scheduler?: BrokerScheduler;
}

export type BrokerEvent =
  | { readonly session: PublicSessionMetadata; readonly type: "sessionRequested" }
  | { readonly session: PublicSessionMetadata; readonly type: "sessionStarted" }
  | {
      readonly reason: TerminalReason;
      readonly sessionId: string;
      readonly type: "sessionEnded";
    }
  | {
      readonly code: string;
      readonly message: string;
      readonly sessionId: string;
      readonly type: "sessionError";
    };

export type BrokerListener = (
  snapshot: SessionSnapshot,
  event?: BrokerEvent,
) => Promise<void> | void;

const defaultScheduler: BrokerScheduler = {
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
};

interface OwnedSession {
  readonly id: string;
  readonly protocol: string;
  readonly requestedAt: string;
  readonly senderName?: string;
}

export class SessionBroker {
  private readonly approvalTtlMs: number;
  private readonly cleanupTimeoutMs: number;
  private readonly listeners = new Set<BrokerListener>();
  private readonly scheduler: BrokerScheduler;
  private approvalTimer: unknown;
  private cleanupTimer: unknown;
  private operation = Promise.resolve();
  private session: OwnedSession | undefined;
  private shuttingDown = false;
  private started = false;
  private state: SessionSnapshot["status"] = "idle";
  private volume = 100;

  constructor(
    private readonly receiver: ReceiverAdapter,
    options: BrokerOptions = {},
  ) {
    this.approvalTtlMs = options.approvalTtlMs ?? 30_000;
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? 5_000;
    this.scheduler = options.scheduler ?? defaultScheduler;
  }

  get supportedProtocols(): readonly string[] {
    return [...this.receiver.supportedProtocols];
  }

  snapshot(): SessionSnapshot {
    return {
      activeSession:
        this.session === undefined || this.state === "idle"
          ? null
          : { ...this.session, state: this.state },
      status: this.state,
      volume: this.volume,
    };
  }

  subscribe(listener: BrokerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    try {
      await this.receiver.start((event) => {
        void this.enqueue(() => this.handleReceiverEvent(event));
      });
    } catch (error) {
      this.started = false;
      throw asBrokerError(error, "start");
    }
  }

  receiveRequest(request: ReceiverRequest): Promise<RequestResult> {
    return this.enqueue(() => this.handleRequest(request));
  }

  approve(sessionId: string): Promise<void> {
    return this.enqueue(async () => {
      if (
        this.session?.id === sessionId &&
        (this.state === "connecting" || this.state === "playing")
      ) {
        return;
      }
      this.assertCurrent(sessionId, "pendingApproval");
      this.clearApprovalTimer();
      this.state = "connecting";
      await this.publish();
      try {
        await this.withTimeout(() => this.receiver.approve(sessionId));
      } catch (error) {
        await this.failCurrent(sessionId, asBrokerError(error, "approve"));
        throw asBrokerError(error, "approve");
      }
    });
  }

  reject(sessionId: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.isTerminalDuplicate(sessionId)) {
        return;
      }
      this.assertCurrent(sessionId, "pendingApproval");
      await this.beginCleanup("rejected", () => this.receiver.reject(sessionId));
    });
  }

  stop(sessionId: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.isTerminalDuplicate(sessionId)) {
        return;
      }
      this.assertCurrent(sessionId);
      await this.beginCleanup("stopped", () => this.receiver.stop(sessionId));
    });
  }

  setVolume(volume: number): Promise<void> {
    return this.enqueue(async () => {
      if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
        throw new BrokerError("invalid-input", "Volume must be an integer from 0 to 100");
      }
      try {
        await this.withTimeout(() => this.receiver.setVolume(volume));
      } catch (error) {
        throw asBrokerError(error, "set volume");
      }
      this.volume = volume;
      await this.publish();
    });
  }

  shutdown(): Promise<void> {
    return this.enqueue(async () => {
      if (this.shuttingDown) {
        return;
      }
      this.shuttingDown = true;
      this.clearApprovalTimer();
      this.clearCleanupTimer();
      const sessionId = this.session?.id;
      if (sessionId !== undefined) {
        this.state = "stopping";
        await this.publish();
        try {
          await this.withTimeout(() => this.receiver.stop(sessionId));
        } catch {
          // Adapter shutdown still runs and the public state must settle to idle.
        }
      }
      try {
        await this.withTimeout(() => this.receiver.shutdown());
      } finally {
        if (sessionId !== undefined) {
          await this.finishSession("shutdown");
        }
      }
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async handleRequest(request: ReceiverRequest): Promise<RequestResult> {
    if (this.shuttingDown) {
      throw new BrokerError("shutting-down", "Display sink is shutting down");
    }
    if (this.session !== undefined) {
      if (this.session.id === request.sessionId) {
        return { accepted: true, sessionId: request.sessionId };
      }
      return {
        accepted: false,
        activeSessionId: this.session.id,
        reason: "busy",
      };
    }

    this.session = {
      id: request.sessionId,
      protocol: request.protocol,
      requestedAt: request.requestedAt,
      ...(request.senderName === undefined ? {} : { senderName: request.senderName }),
    };
    this.state = "pendingApproval";
    const session = this.snapshot().activeSession;
    if (session === null) {
      throw new Error("Accepted session did not produce public metadata");
    }
    await this.publish({ session, type: "sessionRequested" });
    this.approvalTimer = this.scheduler.setTimeout(() => {
      void this.enqueue(() => this.expireApproval(request.sessionId));
    }, this.approvalTtlMs);
    return { accepted: true, sessionId: request.sessionId };
  }

  private async handleReceiverEvent(event: ReceiverEvent): Promise<void> {
    if (event.type === "request") {
      await this.handleRequest(event.request);
      return;
    }
    if (this.session?.id !== event.sessionId) {
      return;
    }

    switch (event.type) {
      case "connected":
        return;
      case "playing": {
        if (this.state !== "connecting") {
          return;
        }
        this.state = "playing";
        const session = this.snapshot().activeSession;
        if (session !== null) {
          await this.publish({ session, type: "sessionStarted" });
        }
        return;
      }
      case "failure":
        await this.failCurrent(
          event.sessionId,
          new BrokerError("adapter-failure", "Receiver session failed"),
          event.code,
        );
        return;
      case "disconnected":
        await this.finishSession("receiverDisconnected");
    }
  }

  private async expireApproval(sessionId: string): Promise<void> {
    if (this.session?.id !== sessionId || this.state !== "pendingApproval") {
      return;
    }
    await this.beginCleanup("approvalExpired", () => this.receiver.reject(sessionId));
  }

  private async beginCleanup(
    reason: TerminalReason,
    cleanup: () => Promise<void>,
  ): Promise<void> {
    const sessionId = this.session?.id;
    if (sessionId === undefined) {
      return;
    }
    this.clearApprovalTimer();
    this.state = "stopping";
    await this.publish();
    try {
      await this.withTimeout(cleanup);
    } catch (error) {
      await this.failCurrent(sessionId, asBrokerError(error, "clean up"));
      return;
    }
    await this.finishSession(reason);
  }

  private async failCurrent(
    sessionId: string,
    error: BrokerError,
    publicCode: string = error.code,
  ): Promise<void> {
    if (this.session?.id !== sessionId) {
      return;
    }
    this.clearApprovalTimer();
    this.state = "error";
    await this.publish({
      code: publicCode,
      message: error.message,
      sessionId,
      type: "sessionError",
    });
    try {
      await this.withTimeout(() => this.receiver.stop(sessionId));
    } catch {
      // A failed adapter cannot prevent ownership release.
    }
    await this.finishSession("receiverFailure");
  }

  private async finishSession(reason: TerminalReason): Promise<void> {
    const sessionId = this.session?.id;
    if (sessionId === undefined) {
      return;
    }
    this.clearApprovalTimer();
    this.clearCleanupTimer();
    this.session = undefined;
    this.state = "idle";
    await this.publish({ reason, sessionId, type: "sessionEnded" });
  }

  private assertCurrent(
    sessionId: string,
    requiredState?: SessionSnapshot["status"],
  ): void {
    if (this.shuttingDown) {
      throw new BrokerError("shutting-down", "Display sink is shutting down");
    }
    if (this.session?.id !== sessionId) {
      throw new BrokerError("session-not-found", "Session is not current");
    }
    if (requiredState !== undefined && this.state !== requiredState) {
      throw new BrokerError("invalid-transition", `Session is ${this.state}`);
    }
  }

  private isTerminalDuplicate(sessionId: string): boolean {
    return this.session === undefined ||
      (this.session.id === sessionId && this.state === "stopping");
  }

  private async publish(event?: BrokerEvent): Promise<void> {
    const snapshot = this.snapshot();
    await Promise.all([...this.listeners].map((listener) => listener(snapshot, event)));
  }

  private withTimeout(operation: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      this.cleanupTimer = this.scheduler.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new BrokerError("adapter-failure", "Receiver cleanup timed out"));
        }
      }, this.cleanupTimeoutMs);
      void operation().then(
        () => {
          if (!settled) {
            settled = true;
            this.clearCleanupTimer();
            resolve();
          }
        },
        (error: unknown) => {
          if (!settled) {
            settled = true;
            this.clearCleanupTimer();
            reject(error instanceof Error ? error : new Error("Receiver operation failed"));
          }
        },
      );
    });
  }

  private clearApprovalTimer(): void {
    if (this.approvalTimer !== undefined) {
      this.scheduler.clearTimeout(this.approvalTimer);
      this.approvalTimer = undefined;
    }
  }

  private clearCleanupTimer(): void {
    if (this.cleanupTimer !== undefined) {
      this.scheduler.clearTimeout(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}