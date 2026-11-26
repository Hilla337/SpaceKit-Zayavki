import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';

/** Приводит телефон к виду +79991234567. Возвращает null, если номер непохож на телефон. */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  else if (d.length === 10) d = '7' + d;
  if (d.length < 10 || d.length > 15) return null;
  return '+' + d;
}

/** Одноразовый код сброса пароля из 6 цифр: менеджер передаёт его клиенту сам (например, в WhatsApp). */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
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

// ---- пароли ----
const SCRYPT = { N: 16384, r: 8, p: 1, len: 32 };
function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}
/** Хэш пароля: scrypt$N$r$p$соль$хэш. Сам пароль нигде не хранится. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Для несуществующего пользователя тоже считаем хэш, чтобы по времени ответа нельзя было угадать, есть ли номер.
  const parts = (stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    await scryptAsync(password, Buffer.alloc(16));
    return false;
  }
  const key = await scryptAsync(password, Buffer.from(parts[4]!, 'base64'));
  const want = Buffer.from(parts[5]!, 'base64');
  return key.length === want.length && timingSafeEqual(key, want);
}

export const PASSWORD_MIN = 6;
/** После 10 неверных паролей подряд вход на этот номер закрыт на 15 минут. */
export const LOGIN_FAILS = 10;
export const LOCK_MS = 15 * 60_000;
/** Код сброса пароля живёт сутки, на него 5 попыток. */
export const RESET_TTL_MS = 24 * 3600_000;
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
export const MAX_ATTEMPTS = 5;
