function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана переменная окружения ${name}`);
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  isProduction,
  port: Number(process.env.PORT ?? 8080),
  /** Строка подключения к PostgreSQL. Читается при первом обращении. */
  get databaseUrl(): string {
    return required('DATABASE_URL');
  },
  /** Секрет для хэширования кодов сброса пароля. В боевой среде обязателен. */
  get authPepper(): string {
    if (isProduction) return required('AUTH_PEPPER');
    return process.env.AUTH_PEPPER ?? 'dev-only-pepper';
  },
  /** Число прокси перед сервером. Нужно, чтобы лимиты по IP считались по реальному адресу клиента, а не балансировщика. */
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 1),
  /** Ссылка на приложение, её добавляем в конец SMS (необязательно). */
  appUrl: process.env.APP_URL,
  /** SMS платные, поэтому в боевой среде по умолчанию выключены ('none'): уведомления остаются в приложении. */
  smsProvider: process.env.SMS_PROVIDER ?? (isProduction ? 'none' : 'console'),
  /** Запись в МойСклад включается явно: MS_WRITE=1. Токен MS_TOKEN, юрлицо и склад по ID. */
  msWrite: process.env.MS_WRITE === '1',
  msOrganizationId: process.env.MS_ORGANIZATION_ID ?? '',
  msStoreId: process.env.MS_STORE_ID ?? '',
  msOrderState: process.env.MS_ORDER_STATE ?? 'Готов к сборке',
  /** Каталог из МойСклад (только чтение) раз в N часов, если задан MS_TOKEN. 0 — выключено. */
  msSyncHours: Number(process.env.MS_SYNC_HOURS ?? 0),
  /** Остатки из МойСклад раз в N минут (вместе с каталогом, если задан MS_TOKEN и MS_SYNC_HOURS). */
  msStockMinutes: Number(process.env.MS_STOCK_MINUTES ?? 15),
  /** Создавать ли отгрузки в МойСклад из приложения (при MS_WRITE=1). На стенде 0. */
  msDemands: process.env.MS_DEMANDS !== '0',
  /** Подписать МойСклад на события (отгрузки, статусы заказов): нужен MS_TOKEN и APP_URL. */
  msWebhooks: process.env.MS_WEBHOOKS === '1',
};
