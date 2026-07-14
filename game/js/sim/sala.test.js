'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Sala, CAP_SALA, PERIODO_SNAPSHOT } = require('./sala');
const P = require('../../../server/protocolo');

function socketFake() {
  const mensajes = [];
  return {
    readyState: 1,
    mensajes,
    send(raw) { mensajes.push(JSON.parse(raw)); },
  };
}

test('el aforo compartido y el protocolo usan 50 jugadores', () => {
  assert.equal(CAP_SALA, 50);
  assert.equal(P.CAP_SALA, 50);
});

test('la simulación acumula posiciones y publica solo la última a 10 Hz', () => {
  assert.equal(PERIODO_SNAPSHOT, 100);
  const sala = new Sala('level-0', 1, 'prueba-snapshot', 'test');
  const ws1 = socketFake();
  const ws2 = socketFake();
  const jug = { id: 1, ws: ws1, x: 10, y: 10, rot: 0, canal: null };
  const otro = { id: 2, ws: ws2, x: 12, y: 10, rot: 0, canal: null };
  sala.jugadores.set(jug.id, jug);
  sala.jugadores.set(otro.id, otro);

  sala._movidosExtra = [jug];
  sala.tick(1000);
  assert.equal(ws1.mensajes.filter((m) => m.t === 'pos').length, 1);

  ws1.mensajes.length = 0;
  ws2.mensajes.length = 0;
  jug.x = 11;
  sala._movidosExtra = [jug];
  sala.tick(1050);
  assert.equal(ws1.mensajes.filter((m) => m.t === 'pos').length, 0);

  jug.x = 12;
  sala._movidosExtra = [jug];
  sala.tick(1100);
  const snapshots = ws1.mensajes.filter((m) => m.t === 'pos');
  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0].j, [[1, 12, 10, 0]]);
});
