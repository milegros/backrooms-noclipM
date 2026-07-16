'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('./rules.js');

function mundo(turno, protegido = false) {
  const danos = [];
  const logs = [];
  return {
    turn: turno,
    player: {},
    equipado: (id) => protegido && id === 'mascara_gas',
    tienePasivo: () => false,
    hurt: (n, causa) => danos.push({ n, causa }),
    log: (txt, tipo) => logs.push({ txt, tipo }),
    danos,
    logs,
  };
}

test('aire_contaminado aplica un daño leve cada 48 turnos', () => {
  const regla = global.Rules.get('aire_contaminado');
  const expuesto = mundo(0);
  regla.entrar(expuesto);
  for (let i = 0; i < 47; i++) regla.turno(expuesto);
  assert.deepEqual(expuesto.danos, []);

  regla.turno(expuesto);
  assert.deepEqual(expuesto.danos, [{ n: 1, causa: 'el aire contaminado' }]);
  assert.equal(expuesto.logs.length, 1);
});

test('aire_contaminado no atraviesa una máscara de gas', () => {
  const protegido = mundo(0, true);
  const regla = global.Rules.get('aire_contaminado');
  regla.entrar(protegido);
  for (let i = 0; i < 96; i++) regla.turno(protegido);
  assert.deepEqual(protegido.danos, []);
  assert.deepEqual(protegido.logs, []);
});
