// lib/logger.ts — server-side log gate (V-7).
//
// Usage: logger.warn('predict', 'JWT verification failed', { reason }) etc.
// - `debug`/`info` are silenced in production (LOG_LEVEL=warn default on prod).
// - Never pass full user objects, emails, or tokens as meta — pass codes/ids.
// - Client components should not import this; use console sparingly there
//   (remaining client logs are tracked as I-7 for Phase 3).

type Level = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

function currentLevel(): Level {
  const raw = (process.env.LOG_LEVEL ?? '').toLowerCase()
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw
  return process.env.NODE_ENV === 'production' ? 'warn' : 'debug'
}

/* eslint-disable no-console -- logger.ts is the single allowed console sink. */
function emit(level: Level, tag: string, msg: string, meta?: unknown) {
  if (ORDER[level] < ORDER[currentLevel()]) return
  const line = `[${tag}] ${msg}`
  if (level === 'error') {
    if (meta !== undefined) console.error(line, meta)
    else console.error(line)
  } else if (level === 'warn') {
    if (meta !== undefined) console.warn(line, meta)
    else console.warn(line)
  } else if (meta !== undefined) {
    console.log(line, meta)
  } else {
    console.log(line)
  }
}

export const logger = {
  debug: (tag: string, msg: string, meta?: unknown) => emit('debug', tag, msg, meta),
  info: (tag: string, msg: string, meta?: unknown) => emit('info', tag, msg, meta),
  warn: (tag: string, msg: string, meta?: unknown) => emit('warn', tag, msg, meta),
  error: (tag: string, msg: string, meta?: unknown) => emit('error', tag, msg, meta),
}
