import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Приводит телефон к виду +79991234567. Возвращает null, если номер непохож на телефон. */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  else if (d.length === 10) d = '7' + d;
  if (d.length < 10 || d.length > 15) return null;
  return '+' + d;
}

/** Код из 4 цифр, как в демо (последние цифры входящего звонка). */
export function generateCode(): string {
  return String(randomInt(0, 10000)).padStart(4, '0');
}

export function hashCode(pepper: string, phone: string, code: string): string {
  return createHmac('sha256', pepper).update(`${phone}:${code}`).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const CODE_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
export const MAX_ATTEMPTS = 5;
/** Не больше трёх кодов на номер за десять минут: каждый звонок стоит денег. */
export const CODES_PER_WINDOW = 3;
export const CODES_WINDOW_MS = 10 * 60_000;
