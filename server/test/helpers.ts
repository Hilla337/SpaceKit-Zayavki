import type { Actor, CompanyInfo, RequestInfo, RequestStatus } from '../src/types.js';

export const admin: Actor = { id: 1, role: 'admin', status: 'approved', companyId: null };
export const managerA: Actor = { id: 10, role: 'manager', status: 'approved', companyId: null };
export const managerB: Actor = { id: 11, role: 'manager', status: 'approved', companyId: null };
export const picker: Actor = { id: 20, role: 'picker', status: 'approved', companyId: null };
export const customer1: Actor = { id: 30, role: 'customer', status: 'approved', companyId: 100 };
export const customer2: Actor = { id: 31, role: 'customer', status: 'approved', companyId: 200 };

/** Компания 100 ведёт менеджер A. */
export const companyOfA: CompanyInfo = { id: 100, status: 'approved', managerId: 10 };
/** Компания 200 ведёт менеджер B. */
export const companyOfB: CompanyInfo = { id: 200, status: 'approved', managerId: 11 };
/** Компания 300 пока никому не назначена. */
export const freeCompany: CompanyInfo = { id: 300, status: 'approved', managerId: null };

export const req = (company: CompanyInfo, status: RequestStatus): RequestInfo => ({
  id: 1,
  companyId: company.id,
  status,
});
