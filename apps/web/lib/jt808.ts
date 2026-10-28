// JT/T 808 frame construction for vehicle control (the "kill switch").
//
// WHY THIS EXISTS
// Traccar's built-in jt808 engineStop/engineResume emit message 0x8105
// ("terminal control") with the vendor bytes 0xF0/0xF1. The MV930G/930G
// trackers in this fleet silently ignore that message — verified on the live
// server: the frame goes out and the device never replies.
//
// The devices DO implement the standard JT/T 808 message 0x8500 ("vehicle
// control"), whose one-byte body sets bit0: 1 = cut the oil/electricity
// circuit, 0 = restore it. Verified live: sending 0x8500 produced a 0x0001
// terminal general response with result 00 (success).
//
// So we build the 0x8500 frame ourselves and hand the raw bytes to Traccar as a
// `custom` command, which passes them through untouched.

/** Message id for JT/T 808 "vehicle control". */
const MSG_VEHICLE_CONTROL = 0x8500;

/** Frame delimiter / escape bytes. */
const FLAG = 0x7e;
const ESCAPE = 0x7d;

/**
 * Escape a frame's payload per JT/T 808: the delimiter 0x7e becomes 0x7d 0x02
 * and the escape byte 0x7d becomes 0x7d 0x01. Applied to everything between the
 * leading and trailing 0x7e (header, body and checksum).
 */
function escapePayload(bytes: number[]): number[] {
  const out: number[] = [];
  for (const b of bytes) {
    if (b === FLAG) out.push(ESCAPE, 0x02);
    else if (b === ESCAPE) out.push(ESCAPE, 0x01);
    else out.push(b);
  }
  return out;
}

/** JT/T 808 checksum: XOR of every byte from the message id through the body. */
function checksum(bytes: number[]): number {
  return bytes.reduce((acc, b) => acc ^ b, 0) & 0xff;
}

/**
 * BCD-encode a numeric terminal id into 6 bytes (12 digits), left-padded with
 * zeros — e.g. "019210015362" -> [0x01,0x92,0x10,0x01,0x53,0x62].
 * Returns null when the id is not purely numeric or is longer than 12 digits,
 * since such a device cannot be addressed by this protocol.
 */
export function bcdTerminalId(uniqueId: string): number[] | null {
  const digits = uniqueId.trim();
  if (!/^\d{1,12}$/.test(digits)) return null;
  const padded = digits.padStart(12, "0");
  const bytes: number[] = [];
  // BCD keeps each decimal digit in its own nibble, so "92" becomes 0x92.
  for (let i = 0; i < 12; i += 2) {
    const tens = padded.charCodeAt(i) - 48;
    const ones = padded.charCodeAt(i + 1) - 48;
    bytes.push((tens << 4) | ones);
  }
  return bytes;
}

/**
 * The three relay actions the MV930G exposes. The values mirror the vendor's
 * documented SMS command `RELAY,A#` (A = 0 resume, 1 cut immediately, 2 cut
 * safely), which is the same control surface as the 0x8500 body byte.
 *
 * "Safe" is the important one for a rental fleet: the tracker holds the cut
 * until the vehicle is already stopped — per the manual, speed below 20 km/h
 * with a GPS fix, or stationary when there is no fix — so it can never
 * immobilise a car at speed.
 */
export const VEHICLE_CONTROL = {
  resume: 0x00,
  cut: 0x01,
  cutSafe: 0x02,
} as const;

export type VehicleControlMode = keyof typeof VEHICLE_CONTROL;

export function isVehicleControlMode(v: unknown): v is VehicleControlMode {
  return typeof v === "string" && v in VEHICLE_CONTROL;
}

/**
 * Build a complete, escaped 0x8500 vehicle-control frame as a lowercase hex
 * string ready for Traccar's `custom` command.
 *
 * @param uniqueId Traccar device uniqueId (the tracker's 12-digit id)
 * @param mode     resume / cut / cutSafe
 * @param serial   message serial number (wraps at 16 bits)
 */
export function buildVehicleControlFrame(
  uniqueId: string,
  mode: VehicleControlMode,
  serial = 1,
): string | null {
  const terminal = bcdTerminalId(uniqueId);
  if (!terminal) return null;

  const body = [VEHICLE_CONTROL[mode]];
  // Body properties: bits 0-9 are the body length; no encryption, no packeting.
  const properties = body.length & 0x03ff;
  const seq = serial & 0xffff;

  const header = [
    (MSG_VEHICLE_CONTROL >> 8) & 0xff,
    MSG_VEHICLE_CONTROL & 0xff,
    (properties >> 8) & 0xff,
    properties & 0xff,
    ...terminal,
    (seq >> 8) & 0xff,
    seq & 0xff,
  ];

  const payload = [...header, ...body];
  const framed = [...payload, checksum(payload)];

  const bytes = [FLAG, ...escapePayload(framed), FLAG];
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Protocols whose Traccar-native engineStop/engineResume we trust. Anything
 * reported as jt808 (a.k.a. huabao) needs the hand-built 0x8500 frame above.
 */
export function needsRawVehicleControl(protocol: string | undefined | null): boolean {
  if (!protocol) return false;
  const p = protocol.toLowerCase();
  return p === "jt808" || p === "huabao";
}
