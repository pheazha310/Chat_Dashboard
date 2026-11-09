import WebSocket from "ws";

export interface Frame {
  type: string;
  payload: Record<string, any>;
}

/** A tiny test client: records every frame and lets a test await one by type. */
export class TestClient {
  readonly frames: Frame[] = [];
  closed: { code: number; reason: string } | null = null;
  private readonly ws: WebSocket;
  private readonly opened: Promise<void>;
  private cursor = 0;

  constructor(url: string, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(url, { headers });
    this.ws.on("message", (data) => this.frames.push(JSON.parse(data.toString()) as Frame));
    this.ws.on("close", (code, reason) => (this.closed = { code, reason: reason.toString() }));
    this.opened = new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
      this.ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
  }

  ready() {
    return this.opened;
  }

  send(type: string, payload: unknown = {}) {
    this.ws.send(JSON.stringify({ type, payload }));
  }

  sendRaw(data: string | Buffer) {
    this.ws.send(data);
  }

  /** Waits for a frame of this type received after the last `mark()`; resolves immediately if one is already there. */
  async waitFor(type: string, match: (payload: Frame["payload"]) => boolean = () => true, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.frames.slice(this.cursor).find((f) => f.type === type && match(f.payload));
      if (found) return found.payload;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for "${type}"; got [${this.frames.slice(this.cursor).map((f) => f.type)}]`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** Asserts nothing of this type arrives for a short while. */
  async expectNone(type: string, ms = 250) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    const unexpected = this.frames.slice(this.cursor).filter((f) => f.type === type);
    if (unexpected.length > 0) throw new Error(`unexpected "${type}": ${JSON.stringify(unexpected[0]?.payload)}`);
  }

  all(type: string) {
    return this.frames
      .slice(this.cursor)
      .filter((f) => f.type === type)
      .map((f) => f.payload);
  }

  /** Forget everything received so far. */
  mark() {
    this.cursor = this.frames.length;
  }

  async waitClosed(timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (!this.closed) {
      if (Date.now() > deadline) throw new Error("socket did not close");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return this.closed;
  }

  close() {
    this.ws.close();
  }
}
