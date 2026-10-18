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

test('regulação: só veículo municipal disponível pode ser designado (retido no destino conta como ocupado)', () => {
  const { record, S, DATA, plain } = setup();
  // PMV-03 retido no HUCAM, PMV-08 e PMV-11 em atendimento; PMV-05 livre.
  assert.deepEqual(plain(S.availableVehicles(DATA).map(v => v.id)), ['PMV-05']);
  const P06 = 'SOL-260506-P03-006';
  assert.match(record({ code: P06, key: 'designada', profile: 'regulacao', vehicleId: 'PMV-03' }).error, /PMV-03 está em atendimento ou retido/);
  assert.match(record({ code: P06, key: 'designada', profile: 'regulacao', vehicleId: 'USB-12' }).error, /frota municipal/);
  assert.match(record({ code: P06, key: 'designada', profile: 'regulacao' }).error, /frota municipal/);
  assert.match(record({ code: P06, key: 'designada', profile: 'motorista', vehicleId: 'PMV-05' }).error, /não permitida para este perfil/);
  const ok = record({ code: P06, key: 'designada', profile: 'regulacao', vehicleId: 'PMV-05' });
  assert.equal(ok.ok, true);
  assert.equal(ok.event.vehicleId, 'PMV-05');
  assert.equal(S.findRequest(DATA, P06).vehicleId, 'PMV-05');
  assert.deepEqual(plain(S.availableVehicles(DATA)), []);
});

test('regulação: abre solicitação local com código sequencial e valida unidades e código de regulação', () => {
  const { S, DATA, plain } = setup();
  assert.match(S.createRequest(DATA, { originId: 'HEVV', destinationId: 'HUCAM' }).error, /origem e uma de destino/);
  assert.match(S.createRequest(DATA, { originId: 'PASP', destinationId: 'HEVV', regulationCode: '<x>' }).error, /regulação inválido/);
  const first = plain(S.createRequest(DATA, { originId: 'PASP', destinationId: 'HEVV', regulationCode: 'reg-1' }));
  assert.equal(first.request.code, 'SOL-260506-L001');
  assert.equal(first.request.regulationCode, 'REG-1');
  assert.deepEqual(first.event, { code: 'SOL-260506-L001', key: 'solicitada', at: '2026-05-06T09:30', profile: 'regulacao' });
  const second = plain(S.createRequest(DATA, { originId: 'PAMAR', destinationId: 'HINF' }));
  assert.equal(second.request.code, 'SOL-260506-L002');
  assert.equal(second.request.regulationCode, 'não informado');
  const local = S.findRequest(DATA, 'SOL-260506-L001');
  assert.equal(local.flowType, 'municipal');
  assert.equal(local.vehicleId, null);
  assert.equal(S.allRequests(DATA).length, DATA.requests.length + 2);
});

test('regulação: solicitações locais malformadas são descartadas', () => {
  const { S, DATA, items } = setup();
  items.set('moov-demo-requests-v1', JSON.stringify([
    { code: 'SOL-260506-L001', regulationCode: 'X', originId: 'HEVV', destinationId: 'HUCAM' },
    { code: '<b>', regulationCode: 'X', originId: 'PASP', destinationId: 'HEVV' },
    { code: 'SOL-260506-L002', regulationCode: 'REG-1', originId: 'PASP', destinationId: 'HEVV' },
    { code: 'SOL-260506-L003', regulationCode: '<script>', originId: 'PASP', destinationId: 'HEVV' },
    { code: 'SOL-260506-L002', regulationCode: 'REG-2', originId: 'PASP', destinationId: 'HEVV' }
  ]));
  assert.deepEqual(JSON.parse(JSON.stringify(S.loadLocalRequests(DATA).map(r => r.code))), ['SOL-260506-L002']);
});

test('regulação: código nunca reaproveita número com histórico (entrada descartada ou chave apagada)', () => {
  const { S, DATA, items, plain } = setup();
  // L001 inválido (origem errada) e L002 válido: a nova deve ser L003, não L002.
  items.set('moov-demo-requests-v1', JSON.stringify([
    { code: 'SOL-260506-L001', regulationCode: 'REG-1', originId: 'HEVV', destinationId: 'HUCAM' },
    { code: 'SOL-260506-L002', regulationCode: 'REG-2', originId: 'PASP', destinationId: 'HEVV' }
  ]));
  assert.equal(plain(S.createRequest(DATA, { originId: 'PASP', destinationId: 'HEVV' })).request.code, 'SOL-260506-L003');
  // A entrada desconhecida é preservada ao regravar.
  assert.equal(JSON.parse(items.get('moov-demo-requests-v1')).length, 3);
  // Chave de solicitações apagada, eventos mantidos: não recria L00x com eventos antigos.
  items.delete('moov-demo-requests-v1');
  assert.equal(plain(S.createRequest(DATA, { originId: 'PASP', destinationId: 'HEVV' })).request.code, 'SOL-260506-L004');
});

test('regulação: designação local envenenada (SAMU, inexistente, sem veículo) é descartada', () => {
  const { S, DATA, items, plain } = setup();
  const P06 = 'SOL-260506-P03-006';
  items.set('moov-demo-events-v1', JSON.stringify([
    { code: P06, key: 'designada', at: '2026-05-06T09:20', vehicleId: 'USB-12' },
    { code: P06, key: 'designada', at: '2026-05-06T09:20', vehicleId: 'GHOST' },
    { code: P06, key: 'designada', at: '2026-05-06T09:20' },
    { code: P06, key: 'chegada_origem', at: '2026-05-06T09:25', vehicleId: 'PMV-05' }
  ]));
  assert.deepEqual(plain(S.loadEvents()), []);
  assert.equal(S.findRequest(DATA, P06).vehicleId, null);
});

test('regulação: veículo SAMU livre nunca aparece como disponível para a frota municipal', () => {
  const { S, DATA, plain } = setup();
  DATA.requests = DATA.requests.filter(r => r.flowType !== 'samu'); // libera USB-12 e USA-04
  assert.deepEqual(plain(S.availableVehicles(DATA).map(v => v.id)), ['PMV-05']);
});

test('regulação: veículo já vinculado à própria solicitação não se bloqueia', () => {
  const { record, DATA } = setup();
  DATA.requests.find(r => r.code === 'SOL-260506-P03-006').vehicleId = 'PMV-05';
  assert.equal(record({ code: 'SOL-260506-P03-006', key: 'designada', profile: 'regulacao', vehicleId: 'PMV-05' }).ok, true);
});

test('regulação: resetDemo apaga também as solicitações locais', () => {
  const { S, DATA, items } = setup();
  S.createRequest(DATA, { originId: 'PASP', destinationId: 'HEVV' });
  S.resetDemo();
  assert.equal(items.size, 0);
});

test('regulação: falha ao gravar a solicitação desfaz o evento já gravado', () => {
  const { S, DATA, items, plain } = setup();
  const original = items.set.bind(items);
  // localStorage falso: falha só ao gravar a chave de solicitações.
  const ctxStorage = { fail: true };
  items.set = (key, value) => {
    if (key === 'moov-demo-requests-v1' && ctxStorage.fail) throw new Error('quota');
    return original(key, value);
  };
  const result = plain(S.createRequest(DATA, { originId: 'PASP', destinationId: 'HEVV' }));
  assert.equal(result.ok, false);
  assert.deepEqual(plain(S.loadEvents()), []);
});

test('regulação: sequência passa de L999 para L1000, recusa números absurdos e não reaproveita código', () => {
  const { S, DATA, items, plain } = setup();
  items.set('moov-demo-requests-v1', JSON.stringify([
    { code: 'SOL-260506-L999', regulationCode: 'REG-1', originId: 'PASP', destinationId: 'HEVV' }
  ]));
  const next = plain(S.createRequest(DATA, { originId: 'PASP', destinationId: 'HEVV' }));
  assert.equal(next.request.code, 'SOL-260506-L1000');
  assert.deepEqual(plain(S.loadLocalRequests(DATA).map(r => r.code)), ['SOL-260506-L999', 'SOL-260506-L1000']);
  // Número enorme injetado no armazenamento é ignorado (não casa com o padrão) e não gera código repetido.
  items.set('moov-demo-events-v1', JSON.stringify([{ code: 'SOL-260506-L9007199254740992', key: 'solicitada', at: '2026-05-06T09:00' }]));
  assert.equal(plain(S.createRequest(DATA, { originId: 'PASP', destinationId: 'HEVV' })).request.code, 'SOL-260506-L1001');
  items.set('moov-demo-events-v1', JSON.stringify([{ code: 'SOL-260506-L999999', key: 'solicitada', at: '2026-05-06T09:00' }]));
  assert.match(S.createRequest(DATA, { originId: 'PASP', destinationId: 'HEVV' }).error, /Limite de solicitações locais/);
});

test('regulação: rollback restaura exatamente o texto anterior dos eventos', () => {
  const { S, DATA, items } = setup();
  const raw = JSON.stringify([{ code: 'X', key: 'constructor', at: 'lixo' }]); // inválido, mas preservado
  items.set('moov-demo-events-v1', raw);
  const original = items.set.bind(items);
  items.set = (key, value) => {
    if (key === 'moov-demo-requests-v1') throw new Error('quota');
    return original(key, value);
  };
  assert.equal(S.createRequest(DATA, { originId: 'PASP', destinationId: 'HEVV' }).ok, false);
  assert.equal(items.get('moov-demo-events-v1'), raw);
});
