import { describe, expect, it, vi } from "vitest";
import { listenForHandoff } from "./embed";

const LOS = "https://los-dev.delightech.asia";

/** A fake window + parent: `send` delivers a message event the way a browser would. */
function setup(options: { exchange?: (token: string) => Promise<unknown> } = {}) {
  const parent = { postMessage: vi.fn() };
  const stranger = { postMessage: vi.fn() };
  let handler: ((event: MessageEvent) => void) | undefined;
  const target = {
    addEventListener: vi.fn((_: "message", fn: (event: MessageEvent) => void) => (handler = fn)),
    removeEventListener: vi.fn(),
  };
  const exchange = vi.fn(options.exchange ?? (async () => undefined));
  const stop = listenForHandoff({ parentOrigin: LOS, parent, target, exchange });
  const send = (message: { origin?: string; source?: unknown; data: unknown }) =>
    handler?.({ origin: LOS, source: parent, ...message } as MessageEvent);
  return { parent, stranger, target, exchange, stop, send };
}
const token = { type: "HANDOFF_TOKEN", token: "a.b.c" };

describe("listenForHandoff", () => {
  it("asks LOS Web for a token at its exact origin, never '*'", () => {
    const { parent } = setup();
    expect(parent.postMessage).toHaveBeenCalledWith({ type: "TOKEN_REQUEST" }, LOS);
  });

  it("exchanges a token that comes from the LOS Web origin and the parent window", () => {
    const { exchange, send } = setup();
    send({ data: token });
    expect(exchange).toHaveBeenCalledWith("a.b.c");
  });

  it("ignores a message from another origin, another window, or with the wrong shape", () => {
    const { exchange, send, stranger } = setup();
    send({ origin: "https://evil.example", data: token });
    send({ origin: `${LOS}.evil.example`, data: token });
    send({ source: stranger, data: token });
    send({ data: { type: "OTHER", token: "a.b.c" } });
    send({ data: { type: "HANDOFF_TOKEN", token: "" } });
    send({ data: { type: "HANDOFF_TOKEN", token: 42 } });
    send({ data: { type: "HANDOFF_TOKEN", token: "x".repeat(5000) } });
    send({ data: "HANDOFF_TOKEN" });
    send({ data: null });
    expect(exchange).not.toHaveBeenCalled();
  });

  it("does not exchange a second token while one is being exchanged", async () => {
    let finish: () => void = () => {};
    const { exchange, send } = setup({ exchange: () => new Promise((resolve) => (finish = () => resolve(undefined))) });
    send({ data: token });
    send({ data: { ...token, token: "d.e.f" } });
    expect(exchange).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    send({ data: { ...token, token: "g.h.i" } });
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it("survives a refused exchange without leaking the token", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { send } = setup({ exchange: () => Promise.reject(new Error("401")) });
    send({ data: token });
    await Promise.resolve();
    await Promise.resolve();
    expect(JSON.stringify(error.mock.calls)).not.toContain("a.b.c");
    error.mockRestore();
  });

  it("stops listening when torn down", () => {
    const { stop, target } = setup();
    stop();
    expect(target.removeEventListener).toHaveBeenCalledWith("message", expect.any(Function));
  });
});
