import { readFile } from 'node:fs/promises';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { hashToken } from './auth.js';
import type { Db } from './db.js';
import { registerAuthRoutes } from './routes-auth.js';
import { registerChatRoutes } from './routes-chat.js';
import { registerCompanyRoutes } from './routes-companies.js';
import { registerRequestRoutes } from './routes-requests.js';
import { registerShipRoutes } from './routes-ship.js';
import type { MsGateway } from './moysklad.js';
import type { CodeSender } from './sender.js';
import type { Actor, Role } from './types.js';

export interface AuthedUser extends Actor {
  name: string;
  phone: string | null;
}

export interface Deps {
  db: Db;
  sender: CodeSender;
  pepper: string;
  /** Часы вынесены, чтобы в тестах проверять истечение кодов и сессий. */
  clock?: () => Date;
  logger?: boolean;
  /** Сколько прокси-серверов стоит перед приложением (балансировщик и т.п.). 0, если запросы идут напрямую. */
  trustProxy?: number;
  /** Запись в МойСклад (заказ при подтверждении, отгрузка). Если не задано, приложение работает без МойСклад. */
  ms?: MsGateway;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function buildApp(deps: Deps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false, // Доверяем только ближайшим N прокси: так подставленный клиентом X-Forwarded-For не подменяет его адрес.
    trustProxy: (_addr: string, hop: number) => hop < (deps.trustProxy ?? 0) });
  const clock = deps.clock ?? (() => new Date());

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return reply.code(401).send({ error: 'unauthorized' });

    const r = await deps.db.query<{
      id: number;
      name: string;
      phone: string | null;
      role: Role;
      status: AuthedUser['status'];
      company_id: number | null;
    }>(
      `SELECT u.id, u.name, u.phone, u.role, u.status, u.company_id
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > $2`,
      [hashToken(token), clock()],
    );
    const u = r.rows[0];
    if (!u || u.status === 'blocked') return reply.code(401).send({ error: 'unauthorized' });
    req.user = { id: u.id, name: u.name, phone: u.phone, role: u.role, status: u.status, companyId: u.company_id };
  });

  // Интерфейс: три статических файла из web/, без сборки. API и страница на одном адресе.
  const WEB = new URL('../web/', import.meta.url);
  const STATIC: Record<string, [string, string]> = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/app.css': ['app.css', 'text/css; charset=utf-8'],
    '/logo.png': ['logo.png', 'image/png'],
    '/icon-192.png': ['icon-192.png', 'image/png'],
    '/icon-512.png': ['icon-512.png', 'image/png'],
    '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
    '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  };
  for (const [path, [file, type]] of Object.entries(STATIC)) {
    app.get(path, async (_req, reply) => {
      reply.header('cache-control', 'no-cache').type(type);
      return readFile(new URL(file, WEB));
    });
  }

  app.get('/health', async () => ({ ok: true }));
  app.get('/health/db', async (_req, reply) => {
    try {
      await deps.db.query('SELECT 1');
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  registerAuthRoutes(app, deps, clock);
  registerCompanyRoutes(app, deps, clock);
  registerRequestRoutes(app, deps);
  registerShipRoutes(app, deps);
  registerChatRoutes(app, deps, clock);

  return app;
}
