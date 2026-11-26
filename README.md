# SpaceKit · Приложение для заявок

Состояние на 26.11.2026: сервер (API, база, правила доступа, вход по телефону и паролю, отгрузки, чат, чтение и запись МоегоСклада) и интерфейс, подключённый к нему, собраны и покрыты тестами. Тестовый стенд в Яндекс Облаке запускается одной кнопкой в GitHub Actions: [deploy/stand/README.md](deploy/stand/README.md).

## Где что лежит

| Что | Где |
|---|---|
| Сервер | `server/` — Node.js 22, TypeScript, Fastify 5, PostgreSQL 16. Запуск и API в [`server/README.md`](server/README.md) |
| Интерфейс | `server/web/` — раздаётся сервером на `/`. Посмотреть без базы: `cd server && npm run dev:memory` |
| Демо | https://claude.ai/artifact/NbgyK2wRRT5gv3oKQAxqK4 — работает в браузере без сервера, вход за любую роль. Файл `demo/index.html`, собирается `node server/web-demo/build-demo.mjs` |
| Контекст для Claude Code | [`CLAUDE.md`](CLAUDE.md) — бизнес-правила, что сделано и что дальше |
| Спецификация процесса | https://claude.ai/artifact/TbiJszgLDJnN1Z3cH5ejCT (частично устарела) |

## Быстрый старт

```bash
cd server
npm install
npm test            # 77 тестов на PostgreSQL в памяти (PGlite)
npm run typecheck
```

## Секреты

Значения только в переменных окружения сервера или в GitHub → Settings → Secrets and variables → Actions. В коде и в репозитории их нет и быть не должно.

| Имя | Что это |
|---|---|
| `MS_TOKEN` | токен API МоегоСклада (отдельный, сначала только на чтение) |
| `AUTH_PEPPER` | секрет для хэшей кодов сброса пароля |
| `YC_SA_KEY`, `YC_FOLDER_ID`, `STAND_SECRET`, `STAND_ADMIN_PHONE`, `STAND_ADMIN_PASSWORD`, `STAND_MS_TOKEN` | стенд в Яндекс Облаке, подробно в [deploy/stand/README.md](deploy/stand/README.md) |

Файлы `*.local.csv` и `*.local.sh` (клиенты по менеджерам, телефоны) хранятся только локально и в git не попадают.

## Что дальше

1. Сверить названия клиентов с контрагентами МоегоСклада и поправить подсказки «менеджер → клиент».
2. МойСклад, запись: заказ покупателя при подтверждении, отгрузка одной кнопкой.
4. Платных звонков и SMS нет: вход по паролю, уведомления в приложении (push — после стенда).
5. Тестовый стенд: сценарий готов, нужны секреты и запуск ([deploy/stand/README.md](deploy/stand/README.md)).
