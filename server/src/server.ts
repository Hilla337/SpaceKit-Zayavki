import { buildApp } from './app.js';
import { ensureBootstrapAdmin } from './bootstrap.js';
import { config } from './config.js';
import { createPgDb } from './db.js';
import { MoySklad, MsWriter, syncCatalog, type MsProduct } from './moysklad.js';
import { startPushWorker, vapidKeys, WebPushSender } from './push.js';
import { ConsoleSmsSender, startSmsWorker } from './sms.js';

if (!['none', 'console'].includes(config.smsProvider)) {
  throw new Error(`Неизвестный SMS_PROVIDER «${config.smsProvider}». Доступны none и console.`);
}

const db = createPgDb(config.databaseUrl);
const ms = config.msWrite
  ? new MsWriter(new MoySklad(process.env.MS_TOKEN ?? ''), { organizationId: config.msOrganizationId, storeId: config.msStoreId, orderState: config.msOrderState })
  : undefined;
const app = buildApp({ db, pepper: config.authPepper, logger: true, trustProxy: config.trustProxyHops, ms });
app.log.info(ms ? 'МойСклад: запись включена' : 'МойСклад: запись выключена (MS_WRITE не равен 1)');

if (config.smsProvider === 'console') {
  const stopSms = startSmsWorker(db, new ConsoleSmsSender(), { onError: (err) => app.log.error({ err }, 'ошибка отправки SMS') });
  app.addHook('onClose', async () => stopSms());
}

// Каталог из МойСклад: только чтение, при запуске и затем раз в MS_SYNC_HOURS часов.
if (config.msSyncHours > 0 && process.env.MS_TOKEN) {
  const reader = new MoySklad(process.env.MS_TOKEN);
  const sync = async () => {
    try {
      const products = await reader.all<MsProduct>('/entity/product');
      const r = await db.tx((q) => syncCatalog(q, products));
      app.log.info(`каталог МойСклад: ${r.upserted} товаров, с кодом Петровича ${r.petrovich}`);
    } catch (err) {
      app.log.error({ err }, 'не удалось обновить каталог из МойСклад');
    }
  };
  setTimeout(sync, 5_000).unref();
  const timer = setInterval(sync, config.msSyncHours * 3600_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}

// Push-уведомления в браузер: ключи VAPID берутся из базы (создаются при первом запуске).
// Миграции к этому моменту уже применены (в контейнере migrate запускается перед сервером).
try {
  const keys = await vapidKeys(db);
  const stopPush = startPushWorker(db, new WebPushSender(keys, config.appUrl || 'mailto:push@spacekit.local'), { onError: (err) => app.log.error({ err }, 'ошибка отправки push') });
  app.addHook('onClose', async () => stopPush());
} catch (err) {
  app.log.error({ err }, 'push-уведомления не запущены');
}

const boot = await ensureBootstrapAdmin(db);
if (boot !== 'skipped') app.log.info(`первый админ из окружения: ${boot}`);

await app.listen({ port: config.port, host: '0.0.0.0' });
