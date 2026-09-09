import type { DisplaySinkConfig } from "../config/schema";
import type { ServientRuntime } from "../runtime/servient";
import displaySinkTd from "./display-sink.td.json";

export interface DisplaySinkThing {
  readonly thing: WoT.ExposedThing;
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
  td: WoT.ExposedThingInit = createDisplaySinkTd(config),
): Promise<DisplaySinkThing> {
  const thing = await runtime.wot.produce(td);

  thing.setPropertyReadHandler("status", () => Promise.resolve("idle"));
  thing.setPropertyReadHandler("activeSession", () => Promise.resolve(null));
  thing.setPropertyReadHandler("supportedProtocols", () => Promise.resolve([]));
  thing.setPropertyReadHandler("deviceName", () => Promise.resolve(config.deviceName));
  thing.setPropertyReadHandler("volume", () => Promise.resolve(100));

  try {
    await thing.expose();
    await runtime.shutdown.register("PiDisplaySink", () => thing.destroy());
  } catch (error) {
    await thing.destroy();
    throw error;
  }

  return { thing };
}