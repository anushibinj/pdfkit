import { describe, expect, it, vi } from "vitest";
import { retryableOnce } from "./retryable-once";

describe("retryableOnce", () => {
  it("calls the factory once and shares the result", async () => {
    const factory = vi.fn(async () => ({ ready: true }));
    const once = retryableOnce(factory);
    const [a, b] = await Promise.all([once.get(), once.get()]);
    expect(a).toBe(b);
    await once.get();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("retries after a rejected attempt", async () => {
    const factory = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce("ok");
    const once = retryableOnce(factory);
    await expect(once.get()).rejects.toThrow("network");
    await expect(once.get()).resolves.toBe("ok");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("turns a synchronous throw into a retryable rejection", async () => {
    let calls = 0;
    const once = retryableOnce(() => {
      calls++;
      if (calls === 1) throw new Error("sync");
      return Promise.resolve(calls);
    });
    await expect(once.get()).rejects.toThrow("sync");
    await expect(once.get()).resolves.toBe(2);
  });

  it("reset forces a fresh attempt", async () => {
    let n = 0;
    const once = retryableOnce(async () => ++n);
    expect(await once.get()).toBe(1);
    once.reset();
    expect(await once.get()).toBe(2);
  });

  it("a late failure of a reset attempt does not clear the newer one", async () => {
    let rejectFirst: (e: Error) => void = () => {};
    const factory = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () => new Promise((_, reject) => (rejectFirst = reject)),
      )
      .mockResolvedValueOnce("second");
    const once = retryableOnce(factory);
    const first = once.get();
    await Promise.resolve(); // let the factory start
    once.reset();
    const second = once.get();
    rejectFirst(new Error("late"));
    await expect(first).rejects.toThrow("late");
    expect(await second).toBe("second");
    expect(once.get()).toBe(second); // still cached
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
