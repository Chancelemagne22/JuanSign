// lib/rateLimit.ts — minimal in-memory fixed-window rate limiter (V-5).
//
// Single-instance only: state lives in module memory. Correct for the current
// thesis deployment (one Next server). For multi-instance / Vercel scale-out,
// replace with Upstash Redis (see note in checkRateLimit) — same call signature.

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

// Opportunistic cleanup so the map can't grow unbounded on attacker IPs.
let lastSweep = Date.now()
function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k)
  }
  // Hard cap: drop oldest entries if still huge (abuse flood).
  if (buckets.size > 10_000) {
    const keys = buckets.keys()
    for (let i = 0; i < buckets.size - 10_000; i++) {
      const k = keys.next().value
      if (k === undefined) break
      buckets.delete(k)
    }
  }
}

export function getClientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]?.trim() || 'unknown'
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): { allowed: boolean; remaining: number; resetAt: number } {
  sweep(now)
  const cur = buckets.get(key)
  if (!cur || cur.resetAt <= now) {
    const resetAt = now + windowMs
    buckets.set(key, { count: 1, resetAt })
    return { allowed: true, remaining: limit - 1, resetAt }
  }
  if (cur.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: cur.resetAt }
  }
  cur.count += 1
  return { allowed: true, remaining: limit - cur.count, resetAt: cur.resetAt }
}

export function rateLimitHeaders(remaining: number, resetAt: number): Record<string, string> {
  return {
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
  }
}
