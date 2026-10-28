import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

import { requireAdmin } from "@/lib/require-admin";
import {
  DEFAULT_ALERT_SETTINGS,
  sanitizeAlertSettings,
  type AlertSettings,
  type MailerStatus,
} from "@/lib/alert-settings";

// Email-alert settings for the carva-mailer service (infra/automation/mailer.js).
//
//   GET  -> { settings, status }   current settings + what the mailer last did
//   PUT  -> save settings          (body: AlertSettings, sanitised here)
//   POST -> request a test email   (the mailer sends it on its next poll, ≤30 s)
//
// Administrators only: who receives fleet warnings is an account-wide choice.
// The files sit beside the mailer's own state on the server; the mailer is the
// only writer of the status file and only seeds the settings file once.

export const dynamic = "force-dynamic";

const SETTINGS_PATH =
  process.env.CARVA_ALERT_SETTINGS ?? "/var/lib/carva/alert-settings.json";
const STATUS_PATH =
  process.env.CARVA_MAILER_STATUS ?? path.join(path.dirname(SETTINGS_PATH), "mailer-status.json");

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Atomic write: a reader (the mailer) never sees half a file. */
async function writeSettings(settings: AlertSettings) {
  const tmp = `${SETTINGS_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2));
  await fs.rename(tmp, SETTINGS_PATH);
}

async function current(): Promise<AlertSettings> {
  const raw = await readJson<unknown>(SETTINGS_PATH);
  return raw ? sanitizeAlertSettings(raw) : DEFAULT_ALERT_SETTINGS;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const [settings, status] = await Promise.all([current(), readJson<MailerStatus>(STATUS_PATH)]);
  return NextResponse.json({ settings, status });
}

export async function PUT(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const prev = await current();
  const next: AlertSettings = {
    ...sanitizeAlertSettings(body),
    // A save must not cancel (or invent) a pending test request.
    testRequestedAt: prev.testRequestedAt ?? null,
    updatedAt: new Date().toISOString(),
    updatedBy: admin.email,
  };
  try {
    await writeSettings(next);
  } catch (e) {
    return NextResponse.json({ error: "write_failed", message: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ settings: next });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const prev = await current();
  if (prev.recipients.length === 0) {
    return NextResponse.json({ error: "no_recipients" }, { status: 400 });
  }
  const next: AlertSettings = { ...prev, testRequestedAt: new Date().toISOString() };
  try {
    await writeSettings(next);
  } catch (e) {
    return NextResponse.json({ error: "write_failed", message: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ settings: next });
}
