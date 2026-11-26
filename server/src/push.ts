import webpush from 'web-push';
import type { Db, Queryable } from './db.js';

/** Одна подписка устройства на push (то, что отдаёт браузер). */
export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}
/** Отправка одного push. Должна бросить ошибку со statusCode 404/410, если подписка больше не действует. */
export interface PushSender {
  send(sub: PushSub, msg: PushMessage): Promise<void>;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** Ключи VAPID: создаются один раз и хранятся в базе, так что новых секретов для стенда не нужно. */
export async function vapidKeys(q: Queryable): Promise<VapidKeys> {
  const rows = (await q.query<{ key: string; value: string }>(`SELECT key, value FROM app_settings WHERE key IN ('vapid_public', 'vapid_private')`)).rows;
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  if (get('vapid_public') && get('vapid_private')) return { publicKey: get('vapid_public')!, privateKey: get('vapid_private')! };
  const k = webpush.generateVAPIDKeys();
  // Два экземпляра сервера могли создать ключи одновременно: остаются те, что записались первыми.
  await q.query(`INSERT INTO app_settings (key, value) VALUES ('vapid_public', $1), ('vapid_private', $2) ON CONFLICT (key) DO NOTHING`, [k.publicKey, k.privateKey]);
  return vapidKeys(q);
}

/** Настоящая отправка через push-службы браузеров (Google, Mozilla, Apple). */
export class WebPushSender implements PushSender {
  constructor(private readonly keys: VapidKeys, private readonly subject: string) {}
  async send(sub: PushSub, msg: PushMessage): Promise<void> {
    await webpush.sendNotification(sub, JSON.stringify(msg), {
      vapidDetails: { subject: this.subject, publicKey: this.keys.publicKey, privateKey: this.keys.privateKey },
      TTL: 24 * 3600,
      urgency: 'high',
      topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined,
    });
  }
}

export interface PushResult {
  notifications: number;
  sent: number;
  removed: number;
  failed: number;
}

/**
 * Отправляет push по новым уведомлениям (pushed_at пустой). Берёт только закоммиченные строки
 * и «занимает» их через SKIP LOCKED, поэтому безопасно и с несколькими экземплярами сервера.
 * Уведомления старше 10 минут не шлём: на телефон должно приходить свежее.
 */
export async function processPushes(db: Db, sender: PushSender, now: Date = new Date()): Promise<PushResult> {
  const res: PushResult = { notifications: 0, sent: 0, removed: 0, failed: 0 };
  const batch = await db.tx(async (q) =>
    (
      await q.query<{ id: number; user_id: number; request_id: number | null; text: string; read_at: Date | null; created_at: Date }>(
        `UPDATE notifications SET pushed_at = $1
         WHERE id IN (SELECT id FROM notifications WHERE pushed_at IS NULL ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED)
         RETURNING id, user_id, request_id, text, read_at, created_at`,
        [now],
      )
    ).rows,
  );
  for (const n of batch) {
    if (n.read_at || now.getTime() - new Date(n.created_at).getTime() > 10 * 60_000) continue;
    const subs = (await db.query<{ id: number; endpoint: string; p256dh: string; auth: string }>('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [n.user_id])).rows;
    if (subs.length === 0) continue;
    res.notifications++;
    const msg: PushMessage = {
      title: 'SpaceKit',
      body: n.text,
      url: n.request_id ? `/#/r/${n.request_id}` : '/',
      tag: n.request_id ? `req-${n.request_id}` : `note-${n.id}`,
    };
    for (const s of subs) {
      try {
        await sender.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, msg);
        res.sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        // Устройство отписалось или подписка устарела — убираем её, чтобы больше не слать.
        if (code === 404 || code === 410) {
          await db.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
          res.removed++;
        } else res.failed++;
      }
    }
  }
  return res;
}

/** Фоновая отправка push раз в несколько секунд. Возвращает функцию остановки. */
export function startPushWorker(db: Db, sender: PushSender, opts: { intervalMs?: number; onError?: (err: unknown) => void } = {}): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await processPushes(db, sender);
    } catch (err) {
      opts.onError?.(err);
    } finally {
      running = false;
    }
  }, opts.intervalMs ?? 3000);
  timer.unref();
  return () => clearInterval(timer);
}
