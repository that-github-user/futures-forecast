/**
 * Tests for subscribeMarkup() — the live markup SSE client. Pins the wire
 * contract: opens /terminal/v1/markup/stream with withCredentials (so the
 * HttpOnly session cookie rides), routes the named events, tolerates
 * malformed frames, and is a no-op without a configured terminal URL.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const TERMINAL_URL = "https://terminal.test";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  opts: EventSourceInit | undefined;
  listeners: Record<string, ((e: { data: string }) => void)[]> = {};
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string, opts?: EventSourceInit) {
    this.url = url;
    this.opts = opts;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (e: { data: string }) => void) {
    (this.listeners[type] ||= []).push(cb);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: string) {
    for (const cb of this.listeners[type] || []) cb({ data });
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  FakeEventSource.instances = [];
});

async function load(url = TERMINAL_URL) {
  vi.resetModules();
  vi.stubEnv("VITE_TERMINAL_API_URL", url);
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
  return import("./terminalClient");
}

describe("subscribeMarkup", () => {
  it("opens the stream withCredentials and routes state/alert/spot events", async () => {
    const { subscribeMarkup } = await load();
    const states: unknown[] = [];
    const alerts: { side?: string }[] = [];
    const spots: [string, number][] = [];
    let opened = false;

    const stop = subscribeMarkup({
      onState: (s) => states.push(s),
      onAlert: (a) => alerts.push(a),
      onSpot: (ts, price) => spots.push([ts, price]),
      onOpen: () => {
        opened = true;
      },
    });

    const es = FakeEventSource.instances[0];
    expect(es.url).toBe(`${TERMINAL_URL}/terminal/v1/markup/stream`);
    expect(es.opts).toEqual({ withCredentials: true });

    es.onopen?.();
    expect(opened).toBe(true);

    es.emit("state", JSON.stringify({ band: [] }));
    es.emit("alert", JSON.stringify({ ts: "x", side: "call" }));
    es.emit("spot", JSON.stringify({ ts: "t", price: 7500 }));

    expect(states).toHaveLength(1);
    expect(alerts[0].side).toBe("call");
    expect(spots[0]).toEqual(["t", 7500]);

    stop();
    expect(es.closed).toBe(true);
  });

  it("ignores malformed JSON frames without throwing", async () => {
    const { subscribeMarkup } = await load();
    const alerts: unknown[] = [];
    subscribeMarkup({ onAlert: (a) => alerts.push(a) });
    FakeEventSource.instances[0].emit("alert", "{bad json");
    expect(alerts).toHaveLength(0);
  });

  it("is a no-op when no terminal URL is configured", async () => {
    const { subscribeMarkup } = await load("");
    const stop = subscribeMarkup({ onAlert: () => {} });
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(() => stop()).not.toThrow();
  });
});
