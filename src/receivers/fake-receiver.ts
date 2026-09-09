import type {
  ReceiverAdapter,
  ReceiverEvent,
  ReceiverEventListener,
  ReceiverFailureCode,
  ReceiverRequest,
} from "./receiver-adapter";

type FakeOperation = "approve" | "reject" | "setVolume" | "shutdown" | "start" | "stop";

export class FakeReceiver implements ReceiverAdapter {
  readonly calls: Array<{ readonly operation: FakeOperation; readonly value?: number | string }> = [];
  readonly supportedProtocols: readonly string[];
  private readonly failures = new Map<FakeOperation, Error>();
  private listener: ReceiverEventListener | undefined;

  constructor(supportedProtocols: readonly string[] = ["fake"]) {
    this.supportedProtocols = [...supportedProtocols];
  }

  failNext(operation: FakeOperation, error = new Error(`${operation} failed`)): void {
    this.failures.set(operation, error);
  }

  request(request: ReceiverRequest): void {
    this.emit({ request, type: "request" });
  }

  connected(sessionId: string): void {
    this.emit({ sessionId, type: "connected" });
  }

  playing(sessionId: string): void {
    this.emit({ sessionId, type: "playing" });
  }

  failure(
    sessionId: string,
    code: ReceiverFailureCode = "receiver-failure",
    message = "Receiver failed",
  ): void {
    this.emit({ code, message, sessionId, type: "failure" });
  }

  disconnected(sessionId: string): void {
    this.emit({ sessionId, type: "disconnected" });
  }

  start(listener: ReceiverEventListener): Promise<void> {
    this.calls.push({ operation: "start" });
    const failure = this.takeFailure("start");
    if (failure !== undefined) return Promise.reject(failure);
    this.listener = listener;
    return Promise.resolve();
  }

  approve(sessionId: string): Promise<void> {
    this.calls.push({ operation: "approve", value: sessionId });
    return this.result("approve");
  }

  reject(sessionId: string): Promise<void> {
    this.calls.push({ operation: "reject", value: sessionId });
    return this.result("reject");
  }

  stop(sessionId: string): Promise<void> {
    this.calls.push({ operation: "stop", value: sessionId });
    return this.result("stop");
  }

  setVolume(volume: number): Promise<void> {
    this.calls.push({ operation: "setVolume", value: volume });
    return this.result("setVolume");
  }

  shutdown(): Promise<void> {
    this.calls.push({ operation: "shutdown" });
    const failure = this.takeFailure("shutdown");
    if (failure !== undefined) return Promise.reject(failure);
    this.listener = undefined;
    return Promise.resolve();
  }

  private emit(event: ReceiverEvent): void {
    if (this.listener === undefined) {
      throw new Error("Fake receiver has not started");
    }
    this.listener(event);
  }

  private result(operation: FakeOperation): Promise<void> {
    const failure = this.takeFailure(operation);
    return failure === undefined ? Promise.resolve() : Promise.reject(failure);
  }

  private takeFailure(operation: FakeOperation): Error | undefined {
    const error = this.failures.get(operation);
    if (error !== undefined) {
      this.failures.delete(operation);
    }
    return error;
  }
}