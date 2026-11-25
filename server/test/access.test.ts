import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canApproveCompany,
  canClaimCompany,
  canReassignCompany,
  canViewCompany,
  canViewRequest,
} from '../src/access.js';
import {
  admin, companyOfA, companyOfB, customer1, customer2, freeCompany, managerA, managerB, picker, req,
} from './helpers.js';

test('менеджер видит своих и нераспределённых клиентов, чужих не видит', () => {
  assert.equal(canViewCompany(managerA, companyOfA), true);
  assert.equal(canViewCompany(managerA, freeCompany), true);
  assert.equal(canViewCompany(managerA, companyOfB), false);
});

test('менеджер не видит заявки чужого клиента', () => {
  assert.equal(canViewRequest(managerA, req(companyOfA, 'new'), companyOfA), true);
  assert.equal(canViewRequest(managerA, req(companyOfB, 'new'), companyOfB), false);
});

test('заказчик видит только свою компанию', () => {
  assert.equal(canViewRequest(customer1, req(companyOfA, 'work'), companyOfA), true);
  assert.equal(canViewRequest(customer1, req(companyOfB, 'work'), companyOfB), false);
  assert.equal(canViewRequest(customer2, req(companyOfA, 'work'), companyOfA), false);
});

test('заказчик заблокированной или неодобренной компании доступа не имеет', () => {
  const blocked = { ...companyOfA, status: 'blocked' as const };
  assert.equal(canViewRequest(customer1, req(blocked, 'new'), blocked), false);
  const pendingUser = { ...customer1, status: 'pending' as const };
  assert.equal(canViewRequest(pendingUser, req(companyOfA, 'new'), companyOfA), false);
});

test('сборщик видит только заявки на сборке и частично отгруженные', () => {
  assert.equal(canViewRequest(picker, req(companyOfA, 'assembly'), companyOfA), true);
  assert.equal(canViewRequest(picker, req(companyOfA, 'partial'), companyOfA), true);
  assert.equal(canViewRequest(picker, req(companyOfA, 'work'), companyOfA), false);
  assert.equal(canViewRequest(picker, req(companyOfA, 'confirm'), companyOfA), false);
});

test('несовпадение компании в заявке и в данных компании — отказ', () => {
  assert.equal(canViewRequest(admin, req(companyOfB, 'new'), companyOfA), false);
});

test('взять можно только нераспределённого клиента, и только менеджеру', () => {
  assert.equal(canClaimCompany(managerA, freeCompany), true);
  assert.equal(canClaimCompany(managerA, companyOfB), false);
  assert.equal(canClaimCompany(customer1, freeCompany), false);
  assert.equal(canClaimCompany(admin, freeCompany), false);
});

test('переназначать клиентов может только админ', () => {
  assert.equal(canReassignCompany(admin), true);
  assert.equal(canReassignCompany(managerA), false);
  assert.equal(canReassignCompany(customer1), false);
});

test('одобрить компанию может админ или её менеджер', () => {
  assert.equal(canApproveCompany(admin, companyOfA), true);
  assert.equal(canApproveCompany(managerA, companyOfA), true);
  assert.equal(canApproveCompany(managerB, companyOfA), false);
  assert.equal(canApproveCompany(managerA, freeCompany), false);
});
