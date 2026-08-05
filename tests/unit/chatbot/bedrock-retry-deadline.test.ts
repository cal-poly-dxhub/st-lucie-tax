import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the mock send so each test can program its behavior. The client is
// constructed at module load, so the mock must be in place before import.
// `vi.hoisted` ensures `send` exists when the (hoisted) vi.mock factory runs.
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@aws-sdk/client-bedrock-runtime", () => {
  class ConverseCommand {
    constructor(public input: unknown) {}
  }
  class BedrockRuntimeClient {
    send = send;
  }
  return { BedrockRuntimeClient, ConverseCommand };
});
// debug-log is imported at module load; stub it so no real I/O happens.
vi.mock("../../../services/chatbot/src/conversation/debug-log.js", () => ({
  appendLog: vi.fn(),
}));

import {
  sendWithRetry,
  BedrockDeadlineError,
} from "../../../services/chatbot/src/conversation/bedrock-client.js";
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

function throttle(): Error {
  const e = new Error("Too many tokens, please wait before trying again.");
  e.name = "ThrottlingException";
  return e;
}

// The mock ConverseCommand ignores input; cast to satisfy the real type.
const cmd = () => new ConverseCommand({} as never);

describe("sendWithRetry — deadline bounding", () => {
  beforeEach(() => {
    send.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the response immediately on success (no retry)", async () => {
    send.mockResolvedValueOnce({ ok: true });
    const p = sendWithRetry(cmd());
    await expect(p).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stops retrying once the deadline has passed and throws BedrockDeadlineError", async () => {
    send.mockRejectedValue(throttle());
    // Deadline already in the past: the first send fails, and the loop must not
    // schedule any backoff sleep — it fails fast with the typed deadline error.
    const p = sendWithRetry(cmd(), undefined, Date.now() - 1);
    await expect(p).rejects.toBeInstanceOf(BedrockDeadlineError);
    // Exactly one attempt: no retry was scheduled past the deadline.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never schedules a sleep that would run past the deadline", async () => {
    send.mockRejectedValue(throttle());
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    // A tiny 5ms budget: at most one short sleep may be scheduled, and no sleep
    // may exceed the remaining budget.
    const deadline = Date.now() + 5;
    const p = sendWithRetry(cmd(), undefined, deadline).catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await p).toBeInstanceOf(BedrockDeadlineError);
    for (const call of setTimeoutSpy.mock.calls) {
      const delay = (call[1] as number) ?? 0;
      expect(delay).toBeLessThanOrEqual(5);
    }
    setTimeoutSpy.mockRestore();
  });

  it("rethrows a non-retryable error immediately without wrapping", async () => {
    const bad = new Error("bad input");
    bad.name = "ValidationException";
    send.mockRejectedValueOnce(bad);
    const p = sendWithRetry(cmd());
    await expect(p).rejects.toBe(bad);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry ModelTimeoutException (can't win under the gateway ceiling)", async () => {
    const timeout = new Error("model timed out");
    timeout.name = "ModelTimeoutException";
    send.mockRejectedValueOnce(timeout);
    const p = sendWithRetry(cmd());
    await expect(p).rejects.toBe(timeout);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries a throttle within budget, then succeeds", async () => {
    send.mockRejectedValueOnce(throttle()).mockResolvedValueOnce({ ok: true });
    // Generous deadline so the single backoff fits.
    const p = sendWithRetry(cmd(), undefined, Date.now() + 20_000);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
