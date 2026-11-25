import { canViewRequest, isOwnerManager } from './access.js';
import type { Actor, CompanyInfo, RequestInfo, RequestStatus, Role } from './types.js';

export interface Transition {
  from: RequestStatus;
  to: RequestStatus;
  actors: readonly Role[];
  needsComment?: boolean;
}

const STAFF: readonly Role[] = ['manager', 'admin'];
const FLOOR: readonly Role[] = ['picker', 'manager', 'admin'];

/**
 * Единственное место, где описано, кто и какие статусы может менять.
 * Всё, чего здесь нет, запрещено.
 */
export const TRANSITIONS: readonly Transition[] = [
  // Менеджер берёт новую заявку в работу и отправляет заказчику на подтверждение.
  { from: 'new', to: 'work', actors: STAFF },
  { from: 'work', to: 'confirm', actors: STAFF },

  // Подтверждение: сам заказчик или менеджер (по телефону). Заказчик может попросить изменить.
  { from: 'confirm', to: 'assembly', actors: ['customer', ...STAFF] },
  { from: 'confirm', to: 'new', actors: ['customer'], needsComment: true },

  // Сборка и отгрузка (в том числе несколько частичных отгрузок подряд).
  { from: 'assembly', to: 'partial', actors: FLOOR },
  { from: 'assembly', to: 'shipped', actors: FLOOR },
  { from: 'partial', to: 'partial', actors: FLOOR },
  { from: 'partial', to: 'shipped', actors: FLOOR },

  // Отмена: заказчик — до сборки; менеджер/админ — и на сборке.
  ...(['new', 'work', 'confirm'] as const).map(
    (from): Transition => ({ from, to: 'cancelled', actors: ['customer', ...STAFF] }),
  ),
  { from: 'assembly', to: 'cancelled', actors: STAFF },
];

export type CheckResult =
  | { ok: true; transition: Transition }
  | { ok: false; code: 'forbidden' | 'invalid_transition' | 'comment_required'; reason: string };

const fail = (code: 'forbidden' | 'invalid_transition' | 'comment_required', reason: string): CheckResult => ({
  ok: false,
  code,
  reason,
});

/**
 * Можно ли этому пользователю перевести заявку в статус `to`.
 * API должен отвечать 404 на `forbidden` по чужим заявкам, чтобы не раскрывать, что они существуют.
 */
export function checkTransition(
  actor: Actor,
  request: RequestInfo,
  company: CompanyInfo,
  to: RequestStatus,
  comment?: string,
): CheckResult {
  if (!canViewRequest(actor, request, company)) {
    return fail('forbidden', 'Нет доступа к заявке');
  }

  const transition = TRANSITIONS.find((t) => t.from === request.status && t.to === to);
  if (!transition) {
    return fail('invalid_transition', `Из статуса «${request.status}» нельзя перейти в «${to}»`);
  }

  if (!transition.actors.includes(actor.role)) {
    return fail('forbidden', 'Эта роль не может выполнить это действие');
  }

  // Менеджер действует только по своим клиентам. Не распределённого клиента сначала нужно взять.
  if (actor.role === 'manager' && !isOwnerManager(actor, company)) {
    return fail('forbidden', 'Это не ваш клиент');
  }

  if (transition.needsComment && !comment?.trim()) {
    return fail('comment_required', 'Нужен комментарий');
  }

  return { ok: true, transition };
}
