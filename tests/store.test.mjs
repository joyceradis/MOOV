// Testes diretos de js/store.js: validações de registro e relógio da demonstração.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const sources = ['js/data.js', 'js/metrics.js', 'js/store.js'].map(file => [file, readFileSync(new URL(file, root), 'utf8')]);

// Contexto novo por teste, com localStorage em memória e relógio controlável.
function setup({ failWrites = false } = {}) {
  const items = new Map();
  const clock = { now: Date.UTC(2026, 9, 18, 12, 0) };
  const localStorage = {
    getItem: key => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => {
      if (failWrites) throw new Error('QuotaExceededError');
      items.set(key, String(value));
    },
    removeItem: key => items.delete(key)
  };
  const DateShim = class extends Date {
    static now() { return clock.now; }
  };
  const context = createContext({ localStorage, Date: DateShim });
  for (const [file, source] of sources) runInContext(source, context, { filename: file });
  const S = runInContext('MOOV_STORE', context);
  const DATA = runInContext('MOOV_DATA', context);
  const plain = value => JSON.parse(JSON.stringify(value));
  const record = input => plain(S.recordEvent(DATA, input));
  return { S, DATA, items, clock, record, plain };
}

const P01 = 'SOL-260506-P01-001'; // próxima etapa: chegada_destino (motorista, km ≥ 45021)

test('registra a próxima etapa válida e grava km, perfil e horário do relógio da demonstração', () => {
  const { record, S, plain } = setup();
  const result = record({ code: P01, key: 'chegada_destino', profile: 'motorista', km: '45035', note: 'Obs: ok' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.event, { code: P01, key: 'chegada_destino', at: '2026-05-06T09:30', profile: 'motorista', km: 45035, note: 'Obs: ok' });
  assert.equal(plain(S.loadEvents()).length, 1);
});

test('recusa código inexistente e fluxo SAMU 192', () => {
  const { record, items } = setup();
  assert.match(record({ code: 'NAO-EXISTE', key: 'recebido', profile: 'destino' }).error, /não encontrado/);
  assert.match(record({ code: 'SAMU-192-260506-007', key: 'saida_origem', profile: 'motorista', km: '1' }).error, /SAMU 192/);
  assert.equal(items.size, 0);
});

test('recusa etapa de outro perfil e etapa fora de sequência (aba desatualizada)', () => {
  const { record, items } = setup();
  assert.match(record({ code: P01, key: 'chegada_destino', profile: 'destino', km: '45035' }).error, /não permitida para este perfil/);
  assert.match(record({ code: P01, key: 'liberado', profile: 'motorista' }).error, /fora de sequência/);
  assert.match(record({ code: 'SOL-260506-P02-002', key: 'liberado', profile: 'motorista' }).error, /fora de sequência/);
  assert.equal(items.size, 0);
});

test('km obrigatório deve ser inteiro, não negativo e não menor que o anterior', () => {
  const { record, items } = setup();
  for (const km of ['', '1.5', '-1', 'abc', undefined]) {
    assert.match(record({ code: P01, key: 'chegada_destino', profile: 'motorista', km }).error, /hodômetro/, String(km));
  }
  assert.match(record({ code: P01, key: 'chegada_destino', profile: 'motorista', km: '45020' }).error, /menor que o registrado anteriormente \(45021\)/);
  assert.equal(items.size, 0);
  assert.equal(record({ code: P01, key: 'chegada_destino', profile: 'motorista', km: '45021' }).ok, true); // igual é aceito
});

test('falha de gravação no armazenamento é informada e nada é considerado registrado', () => {
  const { record } = setup({ failWrites: true });
  const result = record({ code: P01, key: 'chegada_destino', profile: 'motorista', km: '45035' });
  assert.equal(result.ok, false);
  assert.match(result.error, /bloqueou o armazenamento/);
});

test('relógio da demonstração avança em tempo real após o primeiro registro e ignora valores inválidos', () => {
  const { record, S, DATA, clock, items } = setup();
  assert.equal(S.demoNow(DATA), '2026-05-06T09:30');
  record({ code: P01, key: 'chegada_destino', profile: 'motorista', km: '45035' });
  clock.now += 17 * 60000;
  assert.equal(S.demoNow(DATA), '2026-05-06T09:47');
  const next = record({ code: P01, key: 'recebido', profile: 'destino' });
  assert.equal(next.event.at, '2026-05-06T09:47');
  for (const bad of ['-1e300', '0', String(clock.now + 60000), '"x"']) {
    items.set('moov-demo-clock-v1', bad);
    assert.equal(S.demoNow(DATA), '2026-05-06T09:30', bad);
  }
});

test('observação é truncada no limite e registros malformados são descartados na leitura', () => {
  const { record, S, items, plain } = setup();
  const result = record({ code: P01, key: 'chegada_destino', profile: 'motorista', km: '45035', note: 'x'.repeat(S.MAX_NOTE + 50) });
  assert.equal(result.event.note.length, S.MAX_NOTE);
  items.set('moov-demo-events-v1', JSON.stringify([
    { code: P01, key: 'constructor', at: '2026-05-06T09:00' },
    { code: P01, key: 'recebido', at: 123 },
    { code: P01, key: 'recebido', at: '2026-05-06T09:40', km: 1.5 },
    { code: P01, key: 'recebido', at: '2026-05-06T09:40', note: 'y'.repeat(S.MAX_NOTE + 1) },
    { code: P01, key: 'recebido', at: '2026-05-06T09:40' }
  ]));
  assert.deepEqual(plain(S.loadEvents()), [{ code: P01, key: 'recebido', at: '2026-05-06T09:40' }]);
});

test('resetDemo apaga registros e relógio', () => {
  const { record, S, items } = setup();
  record({ code: P01, key: 'chegada_destino', profile: 'motorista', km: '45035' });
  S.resetDemo();
  assert.equal(items.size, 0);
});
