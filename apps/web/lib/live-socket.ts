"use client";

import type { TraccarDevice, TraccarPosition } from "@carva/shared";

// Traccar's live push, as a connection that looks after itself.
//
// This module knows nothing about vehicles. It owns ONE WebSocket: it opens it,
// reopens it when the network or the server drops it, parses frames, and tells
// the caller whether the stream is currently trustworthy. Interpreting the
// frames belongs to the data layer (see `lib/live-data.ts`).
//
// Why a raw socket and not a Next route: a route handler cannot proxy an HTTP
// upgrade, so nginx serves `/traccar-socket` straight from Traccar's
// /api/socket, and the handshake authenticates with the httpOnly JSESSIONID
// cookie scoped to that path (see `socketCookieOptions` in `lib/auth.ts`).

/** One frame from Traccar's socket. Every key is optional and often absent. */
export interface TraccarFrame {
  devices?: TraccarDevice[];
  positions?: TraccarPosition[];
  events?: Array<Record<string, unknown>>;
}

/**
 * - `connecting` — trying; the caller should keep whatever fallback it has.
 * - `open` — frames are arriving; live.
 * - `closed` — dropped, a retry is already scheduled.
 * - `unavailable` — never managed to connect; stop waiting for it.
 */
export type SocketState = "connecting" | "open" | "closed" | "unavailable";

export interface SocketHandlers {
  onFrame: (frame: TraccarFrame) => void;
  onState: (state: SocketState) => void;
}

export interface SocketHandle {
  close: () => void;
}

/** The nginx location that proxies to Traccar's /api/socket. */
const SOCKET_PATH = "/traccar-socket";

/** Reconnect delays, in order; the last one repeats. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/**
 * How many failures to accept before declaring the socket unavailable — but
 * only while it has NEVER opened. A handshake that fails this many times in a
 * row is a deployment that cannot carry a socket at all (no nginx location,
 * no cookie), not bad luck, and retrying forever would just burn requests
 * while polling is already serving the page perfectly well.
 *
 * Once it HAS opened, retries never give up: a socket that worked and then
 * stopped is a lost network or a restarted server, both of which come back.
 */
const MAX_COLD_ATTEMPTS = 5;

/**
 * How long to wait for the handshake before giving up on an attempt.
 *
 * This is not belt-and-braces, it is the common failure. A server with no
 * upgrade handler in front of this path — the Next dev server, an nginx vhost
 * missing the `location`, a captive portal — accepts the TCP connection and
 * then simply never answers. The browser leaves the socket in CONNECTING with
 * no `error` and no `close`, so without a timer here nothing ever fires, the
 * caller is told "connecting" forever, and the fallback is never announced.
 */
const HANDSHAKE_MS = 10_000;

function socketUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}${SOCKET_PATH}`;
}

/** Open a self-healing connection to Traccar's live stream. */
export function openFleetSocket(handlers: SocketHandlers): SocketHandle {
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let guard: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let everOpen = false;
  let stopped = false;

  function clearTimer() {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function clearGuard() {
    if (guard != null) {
      clearTimeout(guard);
      guard = null;
    }
  }

  function detach(socket: WebSocket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  }

  function retry() {
    if (stopped) return;
    if (!everOpen && failures >= MAX_COLD_ATTEMPTS) {
      handlers.onState("unavailable");
      return;
    }
    const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
    failures += 1;
    clearTimer();
    timer = setTimeout(connect, wait);
  }

  function connect() {
    if (stopped) return;
    timer = null;
    // "Connecting" is only true of the FIRST attempt. Once an attempt has
    // failed, the caller's fallback is what is actually serving the page, and
    // saying "connecting" through every later retry would misreport that for
    // the best part of a minute. Staying `closed` keeps the claim honest.
    if (!everOpen && failures === 0) handlers.onState("connecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(socketUrl());
    } catch {
      retry();
      return;
    }
    ws = socket;

    // Every way this attempt can end funnels through here exactly once, so a
    // silent handshake, an error and a close all produce the same recovery.
    let ended = false;
    /** Tear this attempt down, once. True if it was already torn down. */
    function retire(): boolean {
      if (ended) return true;
      ended = true;
      clearGuard();
      detach(socket);
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      if (ws === socket) ws = null;
      return false;
    }

    function fail() {
      if (retire()) return;
      if (stopped) return;
      handlers.onState("closed");
      retry();
    }

    guard = setTimeout(fail, HANDSHAKE_MS);

    socket.onopen = () => {
      if (ended) return;
      clearGuard();
      if (stopped) {
        retire();
        return;
      }
      everOpen = true;
      failures = 0; // a good connection earns a fresh set of retries
      handlers.onState("open");
    };

    socket.onmessage = (event) => {
      if (ended || stopped || typeof event.data !== "string") return;
      let frame: TraccarFrame;
      try {
        frame = JSON.parse(event.data) as TraccarFrame;
      } catch {
        return; // one malformed frame must not take down the stream
      }
      if (frame && typeof frame === "object") handlers.onFrame(frame);
    };

    // Spec says `onerror` is always followed by `onclose`; `fail` is idempotent
    // either way, so both can simply point at it.
    socket.onerror = fail;
    socket.onclose = fail;
  }

  // Traccar closes idle sockets, and phones suspend them on lock. Coming back
  // to the tab is the moment the user expects fresh dots, so reconnect then
  // instead of sitting out the remaining backoff.
  function onVisible() {
    if (stopped || document.visibilityState !== "visible") return;
    if (ws != null) return; // already connected or connecting
    if (!everOpen && failures >= MAX_COLD_ATTEMPTS) return;
    failures = 0;
    clearTimer();
    connect();
  }

  document.addEventListener("visibilitychange", onVisible);
  connect();

  return {
    close() {
      stopped = true;
      clearTimer();
      clearGuard();
      document.removeEventListener("visibilitychange", onVisible);
      const socket = ws;
      ws = null;
      if (socket) {
        // Drop the handlers first: a close we asked for must not schedule a retry.
        detach(socket);
        try {
          socket.close();
        } catch {
          /* already closing */
        }
      }
    },
  };
}
