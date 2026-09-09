export type Cleanup = () => Promise<void> | void;

export interface StartupStep {
  readonly name: string;
  readonly start: () => Promise<Cleanup>;
}

interface CleanupTask {
  readonly name: string;
  readonly cleanup: Cleanup;
}

export class ShutdownController {
  private readonly tasks: CleanupTask[] = [];
  private shutdownPromise: Promise<void> | undefined;

  async register(name: string, cleanup: Cleanup): Promise<void> {
    if (this.shutdownPromise !== undefined) {
      await cleanup();
      return;
    }

    this.tasks.push({ name, cleanup });
  }

  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.runCleanup();
    return this.shutdownPromise;
  }

  private async runCleanup(): Promise<void> {
    const failures: Error[] = [];

    for (const task of this.tasks.reverse()) {
      try {
        await task.cleanup();
      } catch (error) {
        failures.push(
          new Error(`Failed to stop ${task.name}`, { cause: error }),
        );
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, "Runtime shutdown failed");
    }
  }
}

export async function startWithRollback(
  steps: readonly StartupStep[],
  shutdown: ShutdownController,
): Promise<void> {
  try {
    for (const step of steps) {
      const cleanup = await step.start();
      await shutdown.register(step.name, cleanup);
    }
  } catch (startupError) {
    try {
      await shutdown.shutdown();
    } catch (shutdownError) {
      throw new AggregateError(
        [startupError, shutdownError],
        "Runtime startup and rollback failed",
        { cause: startupError },
      );
    }

    throw startupError;
  }
}

export interface TerminationResult {
  readonly error?: unknown;
  readonly signal: NodeJS.Signals;
}

export interface TerminationHandlers {
  readonly completion: Promise<TerminationResult>;
  readonly dispose: () => void;
}

export function installTerminationHandlers(
  shutdown: ShutdownController,
): TerminationHandlers {
  const signals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  let resolveCompletion: (result: TerminationResult) => void;
  const completion = new Promise<TerminationResult>((resolve) => {
    resolveCompletion = resolve;
  });

  const handlers = new Map<NodeJS.Signals, () => void>();

  for (const signal of signals) {
    const handleSignal = (): void => {
      void shutdown.shutdown().then(
        () => resolveCompletion({ signal }),
        (error: unknown) => resolveCompletion({ error, signal }),
      );
    };
    handlers.set(signal, handleSignal);
    process.on(signal, handleSignal);
  }

  return {
    completion,
    dispose: () => {
      for (const signal of signals) {
        const handler = handlers.get(signal);
        if (handler !== undefined) {
          process.off(signal, handler);
        }
      }
    },
  };
}