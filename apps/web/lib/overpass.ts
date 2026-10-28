// Server-only: run an Overpass (OpenStreetMap) query.
//
// The public Overpass servers are often overloaded — the first Kurdistan
// import answered 502/504 for minutes at a time. So every query alternates
// between two public instances with a short pause, and gives up only after a
// bounded number of tries. OVERPASS_URL replaces the first instance.

const ENDPOINTS = [
  process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const USER_AGENT = "CarvaFleet/1.0 (https://gps.carvarent.com; fleet@carvarent.com)";

/**
 * The `elements` of an Overpass JSON answer. Throws after `tries` failures.
 * Defaults keep the worst case (2 × 25 s + pause) under nginx's 60 s proxy
 * timeout, so the page gets a clean error instead of a gateway timeout.
 */
export async function queryOverpass(ql: string, tries = 2, timeoutMs = 25_000): Promise<unknown[]> {
  let last = "no attempt";
  for (let attempt = 0; attempt < tries; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        body: new URLSearchParams({ data: ql }),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const data = (await res.json()) as { elements?: unknown };
        return Array.isArray(data.elements) ? data.elements : [];
      }
      last = `overpass_${res.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
    if (attempt < tries - 1) await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(last);
}
