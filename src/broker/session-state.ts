export const sessionStates = [
  "idle",
  "pendingApproval",
  "connecting",
  "playing",
  "stopping",
  "error",
] as const;

export type SessionState = (typeof sessionStates)[number];
export type OwnedSessionState = Exclude<SessionState, "idle">;

export const sessionEventTypes = [
  "request",
  "approve",
  "reject",
  "connected",
  "playing",
  "stop",
  "approvalExpired",
  "failure",
  "disconnect",
  "cleanupComplete",
  "shutdown",
] as const;

export type SessionEventType = (typeof sessionEventTypes)[number];

export const terminalReasons = [
  "rejected",
  "approvalExpired",
  "stopped",
  "receiverFailure",
  "receiverDisconnected",
  "shutdown",
] as const;

export type TerminalReason = (typeof terminalReasons)[number];

export interface PublicSessionMetadata {
  readonly id: string;
  readonly protocol: string;
  readonly requestedAt: string;
  readonly senderName?: string;
  readonly state: OwnedSessionState;
}

export interface SessionSnapshot {
  readonly activeSession: PublicSessionMetadata | null;
  readonly status: SessionState;
  readonly volume: number;
}

export interface BusyResult {
  readonly accepted: false;
  readonly activeSessionId: string;
  readonly reason: "busy";
}

export interface AcceptedRequestResult {
  readonly accepted: true;
  readonly sessionId: string;
}

export type RequestResult = AcceptedRequestResult | BusyResult;

export type TransitionRejection =
  | "already-terminal"
  | "invalid-transition"
  | "no-active-session";

export type TransitionDecision =
  | { readonly accepted: true; readonly state: SessionState }
  | {
      readonly accepted: false;
      readonly reason: TransitionRejection;
      readonly state: SessionState;
    };

type TransitionTarget = SessionState | TransitionRejection;
type TransitionTable = Readonly<
  Record<SessionState, Readonly<Record<SessionEventType, TransitionTarget>>>
>;

export const sessionTransitionTable: TransitionTable = {
  idle: {
    request: "pendingApproval",
    approve: "no-active-session",
    reject: "already-terminal",
    connected: "no-active-session",
    playing: "no-active-session",
    stop: "already-terminal",
    approvalExpired: "already-terminal",
    failure: "no-active-session",
    disconnect: "already-terminal",
    cleanupComplete: "already-terminal",
    shutdown: "idle",
  },
  pendingApproval: {
    request: "invalid-transition",
    approve: "connecting",
    reject: "stopping",
    connected: "invalid-transition",
    playing: "invalid-transition",
    stop: "stopping",
    approvalExpired: "stopping",
    failure: "error",
    disconnect: "idle",
    cleanupComplete: "invalid-transition",
    shutdown: "stopping",
  },
  connecting: {
    request: "invalid-transition",
    approve: "invalid-transition",
    reject: "invalid-transition",
    connected: "connecting",
    playing: "playing",
    stop: "stopping",
    approvalExpired: "invalid-transition",
    failure: "error",
    disconnect: "idle",
    cleanupComplete: "invalid-transition",
    shutdown: "stopping",
  },
  playing: {
    request: "invalid-transition",
    approve: "invalid-transition",
    reject: "invalid-transition",
    connected: "playing",
    playing: "playing",
    stop: "stopping",
    approvalExpired: "invalid-transition",
    failure: "error",
    disconnect: "idle",
    cleanupComplete: "invalid-transition",
    shutdown: "stopping",
  },
  stopping: {
    request: "invalid-transition",
    approve: "invalid-transition",
    reject: "stopping",
    connected: "invalid-transition",
    playing: "invalid-transition",
    stop: "stopping",
    approvalExpired: "stopping",
    failure: "error",
    disconnect: "idle",
    cleanupComplete: "idle",
    shutdown: "stopping",
  },
  error: {
    request: "invalid-transition",
    approve: "invalid-transition",
    reject: "invalid-transition",
    connected: "invalid-transition",
    playing: "invalid-transition",
    stop: "stopping",
    approvalExpired: "invalid-transition",
    failure: "error",
    disconnect: "idle",
    cleanupComplete: "idle",
    shutdown: "stopping",
  },
};

export function decideTransition(
  state: SessionState,
  event: SessionEventType,
): TransitionDecision {
  const target = sessionTransitionTable[state][event];
  if (sessionStates.includes(target as SessionState)) {
    return { accepted: true, state: target as SessionState };
  }

  return { accepted: false, reason: target as TransitionRejection, state };
}