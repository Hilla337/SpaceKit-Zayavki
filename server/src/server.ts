import { buildApp } from './app.js';
import { config } from './config.js';
import { createPgDb } from './db.js';
import { MoySklad, MsWriter } from './moysklad.js';
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

await app.listen({ port: config.port, host: '0.0.0.0' });
