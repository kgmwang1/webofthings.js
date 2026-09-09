export interface ReceiverRequest {
  readonly protocol: string;
  readonly requestedAt: string;
  readonly senderName?: string;
  readonly sessionId: string;
}

export type ReceiverFailureCode =
  | "connection-failed"
  | "playback-failed"
  | "receiver-failure";

export type ReceiverEvent =
  | { readonly request: ReceiverRequest; readonly type: "request" }
  | { readonly sessionId: string; readonly type: "connected" }
  | { readonly sessionId: string; readonly type: "playing" }
  | {
      readonly code: ReceiverFailureCode;
      readonly message: string;
      readonly sessionId: string;
      readonly type: "failure";
    }
  | { readonly sessionId: string; readonly type: "disconnected" };

export type ReceiverEventListener = (event: ReceiverEvent) => void;

export interface ReceiverAdapter {
  readonly supportedProtocols: readonly string[];
  approve(sessionId: string): Promise<void>;
  reject(sessionId: string): Promise<void>;
  setVolume(volume: number): Promise<void>;
  start(listener: ReceiverEventListener): Promise<void>;
  stop(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
}