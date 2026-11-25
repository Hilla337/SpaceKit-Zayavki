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
  /** Секрет для хэширования кодов входа. В боевой среде обязателен. */
  get authPepper(): string {
    if (isProduction) return required('AUTH_PEPPER');
    return process.env.AUTH_PEPPER ?? 'dev-only-pepper';
  },
  /** Как отправлять коды: пока доступен только console (печать в лог), только вне production. */
  /** Число прокси перед сервером. Нужно, чтобы лимиты по IP считались по реальному адресу клиента, а не балансировщика. */
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 1),
  /** Ссылка на приложение, её добавляем в конец SMS (необязательно). */
  appUrl: process.env.APP_URL,
  smsProvider: process.env.SMS_PROVIDER ?? 'console',
  codeProvider: process.env.CODE_PROVIDER ?? 'console',
};
