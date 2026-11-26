import type { Actor, CompanyInfo, RequestInfo } from './types.js';

const isApproved = (a: Actor): boolean => a.status === 'approved';

/** Менеджер, который ведёт эту компанию. */
export function isOwnerManager(actor: Actor, company: CompanyInfo): boolean {
  return actor.role === 'manager' && isApproved(actor) && company.managerId === actor.id;
}

/**
 * Кто видит компанию:
 *  - админ — все;
 *  - менеджер — своих клиентов и ещё не распределённых (чтобы можно было взять клиента);
 *  - заказчик — только свою компанию и только если она одобрена.
 */
export function canViewCompany(actor: Actor, company: CompanyInfo): boolean {
  if (!isApproved(actor)) return false;
  switch (actor.role) {
    case 'admin':
      return true;
    case 'manager':
      return company.managerId === actor.id || company.managerId === null;
    case 'customer':
      return actor.companyId === company.id && company.status === 'approved';
    default:
      return false;
  }
}

/** Кто видит заявку. Сборщик — только заявки на сборке и частично отгруженные. */
export function canViewRequest(actor: Actor, request: RequestInfo, company: CompanyInfo): boolean {
  if (request.companyId !== company.id) return false;
  if (actor.role === 'picker') {
    return isApproved(actor) && (request.status === 'assembly' || request.status === 'partial');
  }
  return canViewCompany(actor, company);
}

/** Менеджер может «взять» клиента, которого пока никто не ведёт. */
export function canClaimCompany(actor: Actor, company: CompanyInfo): boolean {
  return actor.role === 'manager' && isApproved(actor) && company.managerId === null;
}

/** Переназначать клиентов между менеджерами может только админ. */
export function canReassignCompany(actor: Actor): boolean {
  return actor.role === 'admin' && isApproved(actor);
}

/** Одобрить компанию (и её первых пользователей) может админ или менеджер, который её ведёт. */
export function canApproveCompany(actor: Actor, company: CompanyInfo): boolean {
  if (!isApproved(actor)) return false;
  return actor.role === 'admin' || isOwnerManager(actor, company);
}
