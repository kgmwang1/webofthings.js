import { Servient } from "@node-wot/core";

import {
  type StartupStep,
  ShutdownController,
  startWithRollback,
} from "./shutdown";

export interface ServientRuntime {
  readonly servient: Servient;
  readonly shutdown: ShutdownController;
}

export async function startServientRuntime(
  shutdown = new ShutdownController(),
): Promise<ServientRuntime> {
  const servient = new Servient();
  const steps: readonly StartupStep[] = [
    {
      name: "Servient",
      start: async () => {
        await servient.start();
        return () => servient.shutdown();
      },
    },
  ];

  await startWithRollback(steps, shutdown);

  return { servient, shutdown };
}