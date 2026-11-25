import type { Db } from './db.js';

/** Отправка SMS. Настоящего провайдера подключим вместе с кодами входа (лучше одного, чтобы был один договор). */
export interface SmsSender {
  send(phone: string, text: string): Promise<void>;
}

/** Только для разработки: печатает SMS в лог. */
export class ConsoleSmsSender implements SmsSender {
  async send(phone: string, text: string): Promise<void> {
    console.log(`[SMS] ${phone}: ${text}`);
  }
}

export const SMS_MAX_ATTEMPTS = 3;
const BATCH = 20;
/** Пока сообщение отправляется, оно «занято» этот срок: второй экземпляр сервера его не возьмёт. */
const LEASE_MS = 5 * 60_000;

export interface OutboxResult {
  sent: number;
  retry: number;
  failed: number;
}

/**
 * Берёт из очереди готовые к отправке SMS и отправляет. Безопасно запускать из нескольких экземпляров сервера сразу:
 * сообщение сначала «занимается» (SKIP LOCKED + сдвиг времени), и только потом отправляется, вне транзакции.
 */
export async function processOutbox(db: Db, sender: SmsSender, now: Date = new Date()): Promise<OutboxResult> {
  const claimed = await db.query<{ id: number; phone: string; text: string; attempts: number }>(
    `UPDATE sms_outbox SET attempts = attempts + 1, next_attempt_at = $2
     WHERE id IN (
       SELECT id FROM sms_outbox WHERE status = 'pending' AND next_attempt_at <= $1
       ORDER BY id LIMIT ${BATCH} FOR UPDATE SKIP LOCKED
     )
     RETURNING id, phone, text, attempts`,
    [now, new Date(now.getTime() + LEASE_MS)],
  );

  const result: OutboxResult = { sent: 0, retry: 0, failed: 0 };
  for (const m of claimed.rows) {
    try {
      await sender.send(m.phone, m.text);
      await db.query(`UPDATE sms_outbox SET status = 'sent', sent_at = $2, last_error = NULL WHERE id = $1`, [m.id, now]);
      result.sent++;
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      if (m.attempts >= SMS_MAX_ATTEMPTS) {
        await db.query(`UPDATE sms_outbox SET status = 'failed', last_error = $2 WHERE id = $1`, [m.id, message]);
        result.failed++;
      } else {
        // Следующая попытка через 2, затем через 4 минуты.
        await db.query('UPDATE sms_outbox SET next_attempt_at = $2, last_error = $3 WHERE id = $1', [
          m.id,
          new Date(now.getTime() + m.attempts * 2 * 60_000),
          message,
        ]);
        result.retry++;
      }
    }
  }
  return result;
}

/** Фоновая отправка: раз в несколько секунд разбирает очередь. Возвращает функцию остановки. */
export function startSmsWorker(db: Db, sender: SmsSender, opts: { intervalMs?: number; onError?: (err: unknown) => void } = {}): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await processOutbox(db, sender);
    } catch (err) {
      opts.onError?.(err);
    } finally {
      running = false;
    }
  }, opts.intervalMs ?? 5000);
  timer.unref();
  return () => clearInterval(timer);
}
