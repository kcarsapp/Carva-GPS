import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE, traccarBase, traccarCookieHeader } from "@/lib/auth";
import {
  buildVehicleControlFrame,
  isVehicleControlMode,
  needsRawVehicleControl,
  type VehicleControlMode,
} from "@/lib/jt808";

// Engine cut / restore ("kill switch").
//
// Traccar's own jt808 engineStop/engineResume sends message 0x8105 with the
// vendor bytes 0xF0/0xF1, which the MV930G trackers in this fleet ignore
// outright (verified on the live server: frame sent, no reply, no effect).
// Those devices implement the standard 0x8500 "vehicle control" message
// instead — verified live, the device answers 0x0001 with result 00 (success).
//
// So for jt808/huabao devices we build the 0x8500 frame ourselves and pass it
// through Traccar as a `custom` command; every other protocol keeps using
// Traccar's native encoder, which is well tested for them.

export const dynamic = "force-dynamic";

interface Body {
  deviceId?: number;
  /** resume | cut (immediate) | cutSafe (waits until the vehicle is stopped). */
  mode?: string;
  /** Legacy shape kept working: true = cut immediately, false = resume. */
  cut?: boolean;
}

/** Look up a device's uniqueId and the protocol its last position arrived on. */
async function describeDevice(
  base: string,
  headers: Record<string, string>,
  deviceId: number,
) {
  const [deviceRes, positionRes] = await Promise.all([
    fetch(`${base}/api/devices?id=${deviceId}`, { headers, cache: "no-store" }),
    fetch(`${base}/api/positions?deviceId=${deviceId}`, { headers, cache: "no-store" }),
  ]);
  if (deviceRes.status === 401 || positionRes.status === 401) {
    return { error: "session_expired" as const, status: 401 };
  }
  if (!deviceRes.ok) {
    return { error: "device_lookup_failed" as const, status: 502 };
  }
  const devices = (await deviceRes.json()) as { id: number; uniqueId: string }[];
  const device = devices.find((d) => d.id === deviceId) ?? devices[0];
  if (!device) return { error: "device_not_found" as const, status: 404 };

  const positions = positionRes.ok
    ? ((await positionRes.json()) as { protocol?: string; attributes?: Record<string, unknown> }[])
    : [];
  return {
    device,
    protocol: positions[0]?.protocol,
    /** Traccar decodes the relay state into `blocked` — our only cut readback. */
    blocked:
      typeof positions[0]?.attributes?.blocked === "boolean"
        ? (positions[0]?.attributes?.blocked as boolean)
        : null,
  };
}

/**
 * Which relay actions this device supports, so the UI never offers a "safe cut"
 * to a tracker that would perform an immediate one instead.
 */
export async function GET(req: NextRequest) {
  const jsessionid = req.cookies.get(SESSION_COOKIE)?.value;
  if (!jsessionid) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const deviceId = Number(req.nextUrl.searchParams.get("deviceId"));
  if (!Number.isFinite(deviceId) || deviceId <= 0) {
    return NextResponse.json({ error: "deviceId required" }, { status: 400 });
  }

  const headers = {
    Cookie: traccarCookieHeader(jsessionid),
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  try {
    const info = await describeDevice(traccarBase(), headers, deviceId);
    if ("error" in info) {
      return NextResponse.json({ error: info.error }, { status: info.status });
    }
    const raw = needsRawVehicleControl(info.protocol);
    return NextResponse.json({
      protocol: info.protocol ?? null,
      blocked: info.blocked,
      // Only the hand-built 0x8500 path can express a deferred ("safe") cut.
      modes: raw ? ["resume", "cutSafe", "cut"] : ["resume", "cut"],
    });
  } catch (e) {
    return NextResponse.json(
      { error: "lookup_failed", message: (e as Error).message },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  const jsessionid = req.cookies.get(SESSION_COOKIE)?.value;
  if (!jsessionid) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const deviceId = Number(body.deviceId);
  if (!Number.isFinite(deviceId) || deviceId <= 0) {
    return NextResponse.json({ error: "deviceId required" }, { status: 400 });
  }

  // `mode` is authoritative; the older {cut:boolean} shape still works.
  const mode: VehicleControlMode = isVehicleControlMode(body.mode)
    ? body.mode
    : body.cut
      ? "cut"
      : "resume";

  const base = traccarBase();
  const headers = {
    Cookie: traccarCookieHeader(jsessionid),
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  try {
    // The device record gives us the tracker's uniqueId (its JT808 terminal id);
    // the latest position tells us which protocol it actually speaks.
    const info = await describeDevice(base, headers, deviceId);
    if ("error" in info) {
      return NextResponse.json({ error: info.error }, { status: info.status });
    }
    const { device, protocol } = info;

    // Choose the dialect this device actually understands.
    let payload: Record<string, unknown>;
    let transport: string;
    if (needsRawVehicleControl(protocol)) {
      const frame = buildVehicleControlFrame(
        device.uniqueId,
        mode,
        Date.now() & 0xffff,
      );
      if (!frame) {
        return NextResponse.json(
          { error: "unsupported_unique_id", uniqueId: device.uniqueId },
          { status: 422 },
        );
      }
      payload = { deviceId, type: "custom", attributes: { data: frame } };
      transport = "jt808-0x8500";
    } else {
      // Traccar's native encoder has no deferred cut; refuse rather than
      // silently performing an immediate one the user did not ask for.
      if (mode === "cutSafe") {
        return NextResponse.json(
          { error: "safe_cut_unsupported", protocol: protocol ?? null },
          { status: 422 },
        );
      }
      payload = {
        deviceId,
        type: mode === "cut" ? "engineStop" : "engineResume",
        attributes: {},
      };
      transport = "traccar-native";
    }

    const sent = await fetch(`${base}/api/commands/send`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const text = await sent.text();

    if (!sent.ok) {
      return NextResponse.json(
        { error: "command_rejected", status: sent.status, detail: text.slice(0, 300) },
        { status: sent.status },
      );
    }

    // 200 = delivered to the device now, 202 = queued until it reconnects.
    return NextResponse.json({
      ok: true,
      mode,
      transport,
      queued: sent.status === 202,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "send_failed", message: (e as Error).message },
      { status: 502 },
    );
  }
}
