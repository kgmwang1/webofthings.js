import { describe, expect, it, vi } from "vitest";

import {
  ShutdownController,
  startWithRollback,
} from "../../../src/runtime/shutdown";

describe("ShutdownController", () => {
  it("runs cleanup once in reverse registration order", async () => {
    const order: string[] = [];
    const shutdown = new ShutdownController();
    await shutdown.register("first", () => order.push("first"));
    await shutdown.register("second", () => order.push("second"));

    const firstRequest = shutdown.shutdown();
    const secondRequest = shutdown.shutdown();

    expect(secondRequest).toBe(firstRequest);
    await expect(firstRequest).resolves.toBeUndefined();
    expect(order).toEqual(["second", "first"]);
  });

  it("attempts every cleanup and reports failures", async () => {
    const successfulCleanup = vi.fn();
    const shutdown = new ShutdownController();
    await shutdown.register("successful resource", successfulCleanup);
    await shutdown.register("broken resource", () => {
      throw new Error("stop failed");
    });

    await expect(shutdown.shutdown()).rejects.toThrow("Runtime shutdown failed");
    expect(successfulCleanup).toHaveBeenCalledOnce();
  });
});

describe("startWithRollback", () => {
  it("rolls back initialized resources when later startup fails", async () => {
    const order: string[] = [];
    const shutdown = new ShutdownController();

    await expect(
      startWithRollback(
        [
          {
            name: "first",
            start: () =>
              Promise.resolve(() => {
                order.push("first");
              }),
          },
          {
            name: "second",
            start: () =>
              Promise.resolve(() => {
                order.push("second");
              }),
          },
          {
            name: "failed",
            start: () => Promise.reject(new Error("startup failed")),
          },
        ],
        shutdown,
      ),
    ).rejects.toThrow("startup failed");

    expect(order).toEqual(["second", "first"]);
  });
});