import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTransition, TRANSITIONS } from '../src/statuses.js';
import {
  admin, companyOfA, companyOfB, customer1, customer2, freeCompany, managerA, managerB, picker, req,
} from './helpers.js';

const code = (r: ReturnType<typeof checkTransition>) => (r.ok ? 'ok' : r.code);

test('менеджер берёт заявку своего клиента в работу', () => {
  assert.equal(code(checkTransition(managerA, req(companyOfA, 'new'), companyOfA, 'work')), 'ok');
});

test('менеджер не может менять заявки чужого клиента', () => {
  assert.equal(code(checkTransition(managerB, req(companyOfA, 'new'), companyOfA, 'work')), 'forbidden');
});

test('нераспределённого клиента сначала нужно взять', () => {
  assert.equal(code(checkTransition(managerA, req(freeCompany, 'new'), freeCompany, 'work')), 'forbidden');
});

test('админ может менять любые заявки', () => {
  assert.equal(code(checkTransition(admin, req(companyOfA, 'new'), companyOfA, 'work')), 'ok');
  assert.equal(code(checkTransition(admin, req(freeCompany, 'new'), freeCompany, 'work')), 'ok');
});

test('заказчик подтверждает только свою заявку и только из «На подтверждении»', () => {
  assert.equal(code(checkTransition(customer1, req(companyOfA, 'confirm'), companyOfA, 'assembly')), 'ok');
  assert.equal(code(checkTransition(customer2, req(companyOfA, 'confirm'), companyOfA, 'assembly')), 'forbidden');
  assert.equal(code(checkTransition(customer1, req(companyOfA, 'work'), companyOfA, 'assembly')), 'invalid_transition');
});

test('заказчик не может брать в работу и отправлять на подтверждение', () => {
  assert.equal(code(checkTransition(customer1, req(companyOfA, 'new'), companyOfA, 'work')), 'forbidden');
  assert.equal(code(checkTransition(customer1, req(companyOfA, 'work'), companyOfA, 'confirm')), 'forbidden');
});

test('просьба изменить заявку требует комментарий', () => {
  const r = req(companyOfA, 'confirm');
  assert.equal(code(checkTransition(customer1, r, companyOfA, 'new')), 'comment_required');
  assert.equal(code(checkTransition(customer1, r, companyOfA, 'new', '   ')), 'comment_required');
  assert.equal(code(checkTransition(customer1, r, companyOfA, 'new', 'Добавьте клей')), 'ok');
});

test('менеджер подтверждает по телефону вместо заказчика', () => {
  assert.equal(code(checkTransition(managerA, req(companyOfA, 'confirm'), companyOfA, 'assembly')), 'ok');
});

test('отмена: заказчик до сборки, на сборке только менеджер или админ', () => {
  assert.equal(code(checkTransition(customer1, req(companyOfA, 'confirm'), companyOfA, 'cancelled')), 'ok');
  assert.equal(code(checkTransition(customer1, req(companyOfA, 'assembly'), companyOfA, 'cancelled')), 'forbidden');
  assert.equal(code(checkTransition(managerA, req(companyOfA, 'assembly'), companyOfA, 'cancelled')), 'ok');
  assert.equal(code(checkTransition(managerA, req(companyOfA, 'partial'), companyOfA, 'cancelled')), 'invalid_transition');
});

test('сборщик отгружает, в том числе частично и несколько раз', () => {
  assert.equal(code(checkTransition(picker, req(companyOfA, 'assembly'), companyOfA, 'partial')), 'ok');
  assert.equal(code(checkTransition(picker, req(companyOfA, 'partial'), companyOfA, 'partial')), 'ok');
  assert.equal(code(checkTransition(picker, req(companyOfA, 'partial'), companyOfA, 'shipped')), 'ok');
  assert.equal(code(checkTransition(picker, req(companyOfA, 'assembly'), companyOfA, 'shipped')), 'ok');
});

test('сборщик не может отменять и не видит заявки вне сборки', () => {
  assert.equal(code(checkTransition(picker, req(companyOfA, 'assembly'), companyOfA, 'cancelled')), 'forbidden');
  assert.equal(code(checkTransition(picker, req(companyOfA, 'work'), companyOfA, 'confirm')), 'forbidden');
});

test('из «Отгружена» и «Отменена» выхода нет', () => {
  for (const from of ['shipped', 'cancelled'] as const) {
    assert.equal(TRANSITIONS.some((t) => t.from === from), false);
    assert.equal(code(checkTransition(admin, req(companyOfA, from), companyOfA, 'new')), 'invalid_transition');
  }
});

test('нельзя перепрыгнуть через статусы', () => {
  assert.equal(code(checkTransition(admin, req(companyOfA, 'new'), companyOfA, 'assembly')), 'invalid_transition');
  assert.equal(code(checkTransition(admin, req(companyOfA, 'new'), companyOfA, 'shipped')), 'invalid_transition');
});
