import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { hashPassword } from '../src/auth.js';
import type { Queryable } from '../src/db.js';

export const TEST_PASSWORD = 'секрет-123';
let ip = 0;
/** Каждый запрос — с нового адреса, чтобы тесты не упирались в лимит попыток с одного IP. */
export const nextIp = (): string => `10.${(++ip >> 16) & 255}.${(ip >> 8) & 255}.${ip & 255}`;

/** Вход по телефону: если пароля у человека ещё нет, задаёт тестовый. Возвращает токен. */
export async function loginAs(app: FastifyInstance, db: Queryable, phone: string, password = TEST_PASSWORD): Promise<string> {
  await db.query('UPDATE users SET password_hash = $2 WHERE phone = $1 AND password_hash IS NULL', [phone, await hashPassword(password)]);
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password }, headers: { 'x-forwarded-for': nextIp() } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().token as string;
}

/** Регистрация нового заказчика. Возвращает ответ целиком. */
export function register(app: FastifyInstance, phone: string, name: string, company: string, password = TEST_PASSWORD) {
  return app.inject({ method: 'POST', url: '/auth/register', payload: { phone, password, name, company }, headers: { 'x-forwarded-for': nextIp() } });
}
