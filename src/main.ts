import { loadConfig } from "./config/config";
import { startServientRuntime } from "./runtime/servient";
import {
  installTerminationHandlers,
  ShutdownController,
} from "./runtime/shutdown";
import { exposeDisplaySink } from "./things/expose-display-sink";

export async function run(): Promise<void> {
  const shutdown = new ShutdownController();
  const termination = installTerminationHandlers(shutdown);

  try {
    const config = loadConfig();
    const runtime = await startServientRuntime(config, shutdown);
    await exposeDisplaySink(runtime, config);
    console.log("Runtime started");

    const result = await termination.completion;
    if (result.error !== undefined) {
      throw result.error instanceof Error
        ? result.error
        : new Error("Runtime shutdown failed", { cause: result.error });
    }

    console.log(`Runtime stopped after ${result.signal}`);
  } catch (error) {
    try {
      await shutdown.shutdown();
    } catch (shutdownError) {
      throw new AggregateError(
        [error, shutdownError],
        "Runtime failed and could not shut down cleanly",
        { cause: error },
      );
    }

    throw error;
  } finally {
    termination.dispose();
  }
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}