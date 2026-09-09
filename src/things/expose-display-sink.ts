import type { DisplaySinkConfig } from "../config/schema";
import { BrokerError, toActionError } from "../broker/errors";
import type { SessionBroker } from "../broker/display-broker";
import type { ServientRuntime } from "../runtime/servient";
import displaySinkTd from "./display-sink.td.json";

export interface DisplaySinkThing {
  readonly broker: SessionBroker;
  readonly thing: WoT.ExposedThing;
}

interface SessionCommand {
  readonly sessionId: string;
}

export function parseSessionCommand(value: unknown): SessionCommand {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("sessionId" in value) ||
    typeof value.sessionId !== "string" ||
    value.sessionId.length === 0
  ) {
    throw new BrokerError(
      "invalid-input",
      "Action input must contain a non-empty sessionId",
    );
  }
  return { sessionId: value.sessionId };
}

export function parseVolume(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new BrokerError("invalid-input", "Volume must be an integer from 0 to 100");
  }
  return value;
}

export function createDisplaySinkTd(config: DisplaySinkConfig): WoT.ExposedThingInit {
  const td = structuredClone(displaySinkTd) as WoT.ExposedThingInit;
  td.id = config.thingId;
  td.title = "PiDisplaySink";

  if (config.deployed) {
    td.securityDefinitions = { basic_sc: { scheme: "basic", in: "header" } };
    td.security = "basic_sc";
  }

  return td;
}

export async function exposeDisplaySink(
  runtime: ServientRuntime,
  config: DisplaySinkConfig,
  broker: SessionBroker,
  td: WoT.ExposedThingInit = createDisplaySinkTd(config),
): Promise<DisplaySinkThing> {
  const thing = await runtime.wot.produce(td);

  thing.setPropertyReadHandler("status", () => Promise.resolve(broker.snapshot().status));
  thing.setPropertyReadHandler("activeSession", () =>
    Promise.resolve(broker.snapshot().activeSession),
  );
  thing.setPropertyReadHandler("supportedProtocols", () =>
    Promise.resolve([...broker.supportedProtocols]),
  );
  thing.setPropertyReadHandler("deviceName", () => Promise.resolve(config.deviceName));
  thing.setPropertyReadHandler("volume", () => Promise.resolve(broker.snapshot().volume));

  const sessionAction = (
    operation: (sessionId: string) => Promise<void>,
  ): WoT.ActionHandler => async (input) => {
    try {
      const { sessionId } = parseSessionCommand(await input.value());
      await operation(sessionId);
      return undefined;
    } catch (error) {
      throw toActionError(error);
    }
  };
  thing.setActionHandler("approveSession", sessionAction((id) => broker.approve(id)));
  thing.setActionHandler("rejectSession", sessionAction((id) => broker.reject(id)));
  thing.setActionHandler("stopSession", sessionAction((id) => broker.stop(id)));
  thing.setActionHandler("setVolume", async (input) => {
    try {
      await broker.setVolume(parseVolume(await input.value()));
      return undefined;
    } catch (error) {
      throw toActionError(error);
    }
  });

  const unsubscribe = broker.subscribe(async (_snapshot, event) => {
    await Promise.all([
      thing.emitPropertyChange("status"),
      thing.emitPropertyChange("activeSession"),
      thing.emitPropertyChange("volume"),
    ]);
    if (event === undefined) {
      return;
    }
    switch (event.type) {
      case "sessionRequested":
      case "sessionStarted":
        thing.emitEvent(event.type, event.session);
        return;
      case "sessionEnded":
        thing.emitEvent(event.type, {
          reason: event.reason,
          sessionId: event.sessionId,
        });
        return;
      case "sessionError":
        thing.emitEvent(event.type, {
          code: event.code,
          message: event.message,
          sessionId: event.sessionId,
        });
    }
  });

  try {
    await broker.start();
    await runtime.shutdown.register("SessionBroker", () => broker.shutdown());
    await thing.expose();
    await runtime.shutdown.register("PiDisplaySink", async () => {
      unsubscribe();
      await thing.destroy();
    });
  } catch (error) {
    unsubscribe();
    await thing.destroy();
    throw error;
  }

  return { broker, thing };
}