// Helpers for registering GPS devices: unique-id (IMEI) validation and the
// bulk "one device per line" parser used by the admin GPS tab.
//
// Traccar accepts any string as a uniqueId, but for real trackers it is almost
// always the 15-digit IMEI. We hard-block obvious mistakes (bad checksum,
// junk characters) and soft-warn on non-IMEI ids so unusual hardware still works.

export const DEVICE_CATEGORIES = ['car', 'truck', 'bus', 'motorcycle', 'scooter', 'asset'];

/**
 * MiCODUS models we hand out SMS setup for, mapped to the Traccar protocol
 * port each one reports on. Sources: traccar.org/devices (MV710G → jt808) and
 * Traccar forum reports (MV930G/MV66-family on 5015 huabao; MV730 decodes as
 * h02 like the MV720/MV740).
 */
export interface TrackerPreset {
  model: string;
  port: string;
  protocol: string;
}

export const TRACKER_PRESETS: TrackerPreset[] = [
  { model: 'MV710G', port: '5015', protocol: 'jt808' },
  { model: 'MV33G', port: '5015', protocol: 'jt808' },
  { model: 'MV930G', port: '5015', protocol: 'jt808' },
  { model: 'MV720', port: '5013', protocol: 'h02' },
  { model: 'MV730', port: '5013', protocol: 'h02' },
  { model: 'MV740', port: '5013', protocol: 'h02' },
  // Proven in production: Winnes TK905B-4G registers over jt808 on 5015 with
  // its ID zero-padded to 12 digits; classic 2G TK905s use watch on 5093.
  { model: 'TK905B-4G', port: '5015', protocol: 'jt808' },
  { model: 'TK905 (2G)', port: '5093', protocol: 'watch' },
];

export function presetFor(model: string | undefined): TrackerPreset | undefined {
  if (!model) return undefined;
  const m = model.trim().toLowerCase();
  return TRACKER_PRESETS.find((p) => p.model.toLowerCase() === m);
}

/** Strip the separators people paste along with an IMEI. */
export function normalizeUniqueId(raw: string): string {
  return raw.trim().replace(/[\s\-.]/g, '');
}

/** Luhn checksum (IMEIs use it, like card numbers). */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    // Double every second digit counting from the right.
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export type IdIssue =
  | { level: 'error'; key: 'admin.id.err.format' | 'admin.id.err.luhn' | 'admin.id.err.dup' }
  | { level: 'warn'; key: 'admin.id.warn.notImei' };

/**
 * Validate a device unique id against format rules and already-registered ids.
 * Returns null when the id is a clean 15-digit IMEI with a valid checksum.
 */
export function uniqueIdIssue(raw: string, existing: Set<string>): IdIssue | null {
  const id = normalizeUniqueId(raw);
  if (!/^[A-Za-z0-9]{6,25}$/.test(id)) return { level: 'error', key: 'admin.id.err.format' };
  if (existing.has(id.toLowerCase())) return { level: 'error', key: 'admin.id.err.dup' };
  if (/^\d{15}$/.test(id)) {
    return luhnValid(id) ? null : { level: 'error', key: 'admin.id.err.luhn' };
  }
  return { level: 'warn', key: 'admin.id.warn.notImei' };
}

export interface BulkRow {
  line: number; // 1-based line number in the pasted text
  name: string;
  uniqueId: string;
  category: string;
  phone?: string;
  model?: string;
  issue: IdIssue | { level: 'error'; key: 'admin.bulk.badCategory' | 'admin.bulk.badLine' } | null;
}

/**
 * Parse bulk-add text: one device per line, `Name, IMEI` plus optional extras
 * (category, SIM phone, model) in any order, separated by commas, semicolons,
 * or tabs. Duplicates are checked against both existing devices and earlier
 * lines of the same paste.
 */
export function parseBulkDevices(text: string, existing: Set<string>): BulkRow[] {
  const seen = new Set(existing);
  const rows: BulkRow[] = [];

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(/[,;\t]/).map((p) => p.trim());
    const [name, rawId] = parts;

    if (!name || !rawId) {
      rows.push({
        line: i + 1,
        name: name || line,
        uniqueId: rawId ?? '',
        category: 'car',
        issue: { level: 'error', key: 'admin.bulk.badLine' },
      });
      continue;
    }

    // Optional extra columns: category, SIM phone, and/or model — any order.
    let category = 'car';
    let phone: string | undefined;
    let model: string | undefined;
    let badCategory = false;
    for (const extra of parts.slice(2)) {
      if (!extra) continue;
      const preset = presetFor(extra);
      if (DEVICE_CATEGORIES.includes(extra.toLowerCase())) category = extra.toLowerCase();
      else if (preset) model = preset.model;
      else if (/^\+?\d[\d\s-]{5,}$/.test(extra)) phone = extra.replace(/[\s-]/g, '');
      else badCategory = true;
    }

    const uniqueId = normalizeUniqueId(rawId);
    const issue = badCategory
      ? ({ level: 'error', key: 'admin.bulk.badCategory' } as const)
      : uniqueIdIssue(uniqueId, seen);
    if (!issue || issue.level !== 'error') seen.add(uniqueId.toLowerCase());

    rows.push({ line: i + 1, name, uniqueId, category, phone, model, issue });
  }
  return rows;
}
