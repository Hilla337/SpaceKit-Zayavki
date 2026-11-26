export type Role = 'customer' | 'manager' | 'picker' | 'admin';
export type AccountStatus = 'pending' | 'approved' | 'blocked';
export type RequestStatus =
  | 'new'
  | 'work'
  | 'confirm'
  | 'assembly'
  | 'partial'
  | 'shipped'
  | 'cancelled';

/** Кто совершает действие. */
export interface Actor {
  id: number;
  role: Role;
  status: AccountStatus;
  companyId: number | null;
}

/** Компания; managerId — менеджер, который ведёт клиента (null — клиент не распределён). */
export interface CompanyInfo {
  id: number;
  status: AccountStatus;
  managerId: number | null;
}

export interface RequestInfo {
  id: number;
  companyId: number;
  status: RequestStatus;
}
