import { buildApp } from './app.js';
import { ensureBootstrapAdmin } from './bootstrap.js';
import { config } from './config.js';
import { createPgDb } from './db.js';
import { MoySklad, MsReader, MsWriter, syncCatalog, syncStock, type MsProduct, type MsStockRow } from './moysklad.js';
import { webhookSecret } from './ms-webhook.js';
import { startPushWorker, vapidKeys, WebPushSender } from './push.js';
import { ConsoleSmsSender, startSmsWorker } from './sms.js';

if (!['none', 'console'].includes(config.smsProvider)) {
  throw new Error(`Неизвестный SMS_PROVIDER «${config.smsProvider}». Доступны none и console.`);
}

const db = createPgDb(config.databaseUrl);
const ms = config.msWrite
  ? new MsWriter(new MoySklad(process.env.MS_TOKEN ?? ''), { organizationId: config.msOrganizationId, storeId: config.msStoreId, orderState: config.msOrderState })
  : undefined;
const msEvents = process.env.MS_TOKEN && config.msWebhooks ? new MsReader(new MoySklad(process.env.MS_TOKEN)) : undefined;
const app = buildApp({ db, pepper: config.authPepper, logger: true, trustProxy: config.trustProxyHops, ms, msDemands: config.msDemands, msEvents });
app.log.info(ms ? 'МойСклад: запись включена' : 'МойСклад: запись выключена (MS_WRITE не равен 1)');

if (config.smsProvider === 'console') {
  const stopSms = startSmsWorker(db, new ConsoleSmsSender(), { onError: (err) => app.log.error({ err }, 'ошибка отправки SMS') });
  app.addHook('onClose', async () => stopSms());
}

// Каталог и остатки из МойСклад: только чтение. Каталог — при запуске и раз в MS_SYNC_HOURS часов, остатки — раз в MS_STOCK_MINUTES минут.
if (config.msSyncHours > 0 && process.env.MS_TOKEN) {
  const reader = new MoySklad(process.env.MS_TOKEN);
  const syncAll = async () => {
    try {
      const products = await reader.all<MsProduct>('/entity/product');
      const r = await db.tx((q) => syncCatalog(q, products));
      app.log.info(`каталог МойСклад: ${r.upserted} товаров, с кодом Петровича ${r.petrovich}`);
    } catch (err) {
      app.log.error({ err }, 'не удалось обновить каталог из МойСклад');
    }
    await stock();
  };
  const stock = async () => {
    try {
      const store = config.msStoreId ? `&filter=store=https://api.moysklad.ru/api/remap/1.2/entity/store/${config.msStoreId}` : '';
      const rows = await reader.all<MsStockRow>('/report/stock/all', store);
      const r = await db.tx((q) => syncStock(q, rows));
      app.log.info(`остатки МойСклад: ${r.updated} товаров в наличии`);
    } catch (err) {
      app.log.error({ err }, 'не удалось обновить остатки из МойСклад');
    }
  };
  setTimeout(syncAll, 5_000).unref();
  const t1 = setInterval(syncAll, config.msSyncHours * 3600_000);
  const t2 = config.msStockMinutes > 0 ? setInterval(stock, config.msStockMinutes * 60_000) : undefined;
  t1.unref(); t2?.unref();
  app.addHook('onClose', async () => { clearInterval(t1); if (t2) clearInterval(t2); });
}

// Обратная связь из МойСклад: подписываем его на события по адресу приложения (повторно не дублирует).
if (msEvents && config.appUrl) {
  const url = `${config.appUrl.replace(/\/$/, '')}/ms/webhook/${webhookSecret(config.authPepper)}`;
  new MsReader(new MoySklad(process.env.MS_TOKEN!)).ensureWebhooks(url)
    .then((r) => app.log.info(`вебхуки МойСклад: создано ${r.created}, уже были ${r.existing}`))
    .catch((err) => app.log.error({ err }, 'не удалось подписать МойСклад на события (нужен токен администратора МойСклад)'));
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
