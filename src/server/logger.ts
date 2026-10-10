import 'server-only';

/**
 * Minimal structured logger. JSON lines in production (for log collectors), readable lines in
 * development. Swap the implementation (e.g. pino) here without touching call sites.
 * Never log personal data (phone numbers, emails) — log ids instead.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';
type Context = Record<string, unknown>;

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function write(level: Level, message: string, context: Context = {}): void {
  const fields = Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, serialize(value)]),
  );
  const sink = level === 'debug' ? console.log : console[level];
  if (process.env.NODE_ENV === 'production') {
    sink(JSON.stringify({ level, time: new Date().toISOString(), message, ...fields }));
  } else {
    sink(`[${level}] ${message}`, Object.keys(fields).length > 0 ? fields : '');
  }
}

export const logger = {
  debug: (message: string, context?: Context) => write('debug', message, context),
  info: (message: string, context?: Context) => write('info', message, context),
  warn: (message: string, context?: Context) => write('warn', message, context),
  error: (message: string, context?: Context) => write('error', message, context),
};
