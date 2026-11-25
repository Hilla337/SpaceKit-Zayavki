import { buildApp } from './app.js';
import { config } from './config.js';
import { createPgDb } from './db.js';
import { ConsoleSender } from './sender.js';
import { ConsoleSmsSender, startSmsWorker } from './sms.js';

if (config.codeProvider !== 'console') {
  throw new Error(`Неизвестный CODE_PROVIDER «${config.codeProvider}». Сервис звонков ещё не подключён.`);
}
if (config.isProduction) {
  // Печатать коды входа в лог в боевой среде нельзя. Пока сервис звонков не подключён, production не запускаем.
  throw new Error('В production нужен настоящий отправитель кодов (сервис звонков). Для проверки используй NODE_ENV=staging.');
}

const db = createPgDb(config.databaseUrl);
const app = buildApp({ db, sender: new ConsoleSender(), pepper: config.authPepper, logger: true, trustProxy: config.trustProxyHops });

if (config.smsProvider !== 'console') {
  throw new Error(`Неизвестный SMS_PROVIDER «${config.smsProvider}». Провайдер SMS ещё не подключён.`);
}
const stopSms = startSmsWorker(db, new ConsoleSmsSender(), { onError: (err) => app.log.error({ err }, 'ошибка отправки SMS') });
app.addHook('onClose', async () => stopSms());

await app.listen({ port: config.port, host: '0.0.0.0' });
