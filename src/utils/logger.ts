import { env } from '../config/env';

const levels = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;

function write(level: 'debug' | 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}): void {
  if (levels[level] < levels[env.LOG_LEVEL]) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
}

export const logger = {
  debug: (msg: string, f?: Record<string, unknown>) => write('debug', msg, f),
  info: (msg: string, f?: Record<string, unknown>) => write('info', msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => write('warn', msg, f),
  error: (msg: string, f?: Record<string, unknown>) => write('error', msg, f),
};
