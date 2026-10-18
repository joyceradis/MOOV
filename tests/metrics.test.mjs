// Testes dos cálculos de governança (js/metrics.js) sobre o conjunto fictício e casos sintéticos.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const context = createContext({});
for (const file of ['js/data.js', 'js/metrics.js']) {
  runInContext(readFileSync(new URL(file, root), 'utf8'), context, { filename: file });
}
const DATA = runInContext('MOOV_DATA', context);
const M = runInContext('MOOV_METRICS', context);
// Objetos criados no contexto vm têm outro realm; copia para comparação estrita.
const plain = value => JSON.parse(JSON.stringify(value));
const NOW = DATA.referenceTime;

const byCode = code => DATA.requests.find(r => r.code === code);
const summary = code => M.summarize(byCode(code), M.eventsFor(byCode(code)), NOW, DATA.config);

test('conjunto fictício: códigos únicos, referências válidas, eventos em ordem cronológica e de etapa', () => {
  assert.equal(new Set(DATA.requests.map(r => r.code)).size, DATA.requests.length);
  const units = new Set(DATA.units.map(u => u.id));
  const fleet = new Map(DATA.fleet.map(v => [v.id, v]));
  for (const r of DATA.requests) {
    assert.ok(units.has(r.originId) && units.has(r.destinationId), r.code);
    if (r.vehicleId) {
      assert.equal(fleet.get(r.vehicleId)?.flowType, r.flowType, `${r.code}: veículo de outro fluxo`);
    }
    let previous = -1;
    let previousAt = -Infinity;
    for (const e of r.events) {
      assert.ok(e.key in M.STAGE_INDEX, `${r.code}: etapa ${e.key}`);
      assert.ok(M.STAGE_INDEX[e.key] > previous, `${r.code}: etapa fora de ordem`);
      assert.ok(M.toMinutes(e.at) >= previousAt, `${r.code}: horário retrocede`);
      assert.ok(M.toMinutes(e.at) <= M.toMinutes(NOW), `${r.code}: evento após o relógio`);
      previous = M.STAGE_INDEX[e.key];
      previousAt = M.toMinutes(e.at);
    }
  }
});

test('solicitação concluída: tempos, retenção, km e lastro completos', () => {
  const s = summary('SOL-260506-P01-003');
  assert.equal(s.stage, 'liberado');
  assert.equal(s.finished, true);
  assert.equal(s.totalMin, 65); // 06:50 → 07:55
  assert.equal(s.responseMin, 20); // 06:50 → 07:10
  assert.equal(s.retentionMin, 19); // 07:41 → 08:00
  assert.equal(s.retentionOpen, false);
  assert.equal(s.km, 14);
  assert.deepEqual([s.completeness.done, s.completeness.total], [10, 10]);
  assert.deepEqual(plain(s.alerts), []);
  assert.equal(s.next, null);
});

test('retenção em aberto conta até o relógio e gera alerta pelo parâmetro de gestão', () => {
  const s = summary('SOL-260506-P02-002');
  assert.equal(s.retentionMin, 69); // 08:21 → 09:30
  assert.equal(s.retentionOpen, true);
  assert.equal(s.finished, false);
  assert.equal(s.totalMin, 108); // 07:42 → 09:30 (em curso)
  assert.equal(s.next.key, 'recebido');
  assert.match(s.alerts.join(), /retido no destino há 69 min/);
});

test('lacuna documental: km final ausente reduz o lastro e anula o km do trajeto', () => {
  const s = summary('SOL-260506-P03-004');
  assert.equal(s.km, null);
  assert.deepEqual([s.completeness.done, s.completeness.total], [9, 10]);
  assert.deepEqual(plain(s.completeness.missing), ['Chegada ao destino: km não informado']);
});

test('sem veículo designado além do parâmetro gera alerta; abaixo dele, não', () => {
  assert.match(summary('SOL-260506-P03-006').alerts.join(), /Sem veículo designado há 18 min/);
  const s = M.summarize(byCode('SOL-260506-P03-006'), M.eventsFor(byCode('SOL-260506-P03-006')), '2026-05-06T09:20', DATA.config);
  assert.deepEqual(plain(s.alerts), []);
});

test('etapa intermediária ausente aparece como lacuna (não é preenchida por inferência)', () => {
  const request = { code: 'X', events: [{ key: 'solicitada', at: '2026-05-06T08:00' }, { key: 'embarque', at: '2026-05-06T08:30' }] };
  const c = M.completeness(M.eventsFor(request));
  assert.deepEqual(plain(c.missing), ['Veículo designado: etapa sem registro', 'Chegada à origem: etapa sem registro']);
  assert.deepEqual([c.done, c.total], [2, 4]);
});

test('média ignora valores ausentes e informa n', () => {
  assert.deepEqual({ ...M.mean([10, null, 20, undefined, NaN]) }, { mean: 15, n: 2 });
  assert.deepEqual({ ...M.mean([]) }, { mean: null, n: 0 });
});

test('durações por etapa usam apenas pares registrados', () => {
  const lists = DATA.requests.map(r => M.eventsFor(r));
  const d = Object.fromEntries(M.stageDurations(lists).map(x => [x.to, x]));
  // solicitada → designada em todas as 7 com designação: 2, 8, 8, 4, 15, 2, 2
  assert.deepEqual([d.designada.mean, d.designada.n], [6, 7]);
  // chegada ao destino → recebido: 14 (P01-003), 19 (P03-004), 13 (SAMU-003)
  assert.deepEqual([d.recebido.mean, d.recebido.n], [15, 3]);
});

test('retenção por destino soma em aberto e encerradas', () => {
  const summaries = DATA.requests.map(r => M.summarize(r, M.eventsFor(r), NOW, DATA.config));
  const hucam = M.groupRetention(summaries, DATA.units).find(x => x.destinationId === 'HUCAM');
  assert.equal(hucam.totalMin, 69 + 23); // P02-002 em aberto + P03-004 (06:12 → 06:35)
  assert.equal(hucam.open, 1);
});

test('frota: apenas veículos municipais; km e minutos por veículo', () => {
  const lists = DATA.requests.map(r => M.eventsFor(r));
  const summaries = DATA.requests.map((r, i) => M.summarize(r, lists[i], NOW, DATA.config));
  const fleet = M.fleetSummary(DATA.fleet, summaries, lists, NOW);
  assert.deepEqual(plain(fleet.map(v => v.id)), ['PMV-03', 'PMV-05', 'PMV-08', 'PMV-11']);
  const pmv08 = fleet.find(v => v.id === 'PMV-08');
  assert.equal(pmv08.requests, 2);
  assert.equal(pmv08.km, null); // única viagem com chegada não tem km final
  assert.equal(pmv08.kmMissing, 1);
  assert.equal(pmv08.serviceMin, 51 + 73); // 05:44→06:35 + 08:17→09:30
  assert.equal(pmv08.current, 'SOL-260506-P01-001');
  assert.equal(fleet.find(v => v.id === 'PMV-05').current, null);
});

test('registros locais complementam o conjunto sem sobrescrever etapas existentes', () => {
  const r = byCode('SOL-260506-P01-001');
  const events = M.eventsFor(r, [
    { code: r.code, key: 'saida_origem', at: '2026-05-06T09:00', km: 1 }, // já existe: ignorado
    { code: r.code, key: 'chegada_destino', at: '2026-05-06T08:46', km: 45035 },
    { code: 'OUTRO', key: 'recebido', at: '2026-05-06T08:50' }
  ]);
  assert.deepEqual(plain(events.map(e => e.key).slice(-2)), ['saida_origem', 'chegada_destino']);
  assert.equal(events.find(e => e.key === 'saida_origem').km, 45021);
  assert.equal(events.at(-1).source, 'registro local');
  const s = M.summarize(r, events, NOW, DATA.config);
  assert.equal(s.km, 14);
  assert.equal(s.retentionMin, 44);
});

test('CSV escapa separadores e neutraliza fórmulas', () => {
  const csv = M.toCsv([['a;b', 'diz "oi"', '=HYPERLINK("x")', '-2', 'ok', null]]);
  assert.equal(csv, '"a;b";"diz ""oi""";"\'=HYPERLINK(""x"")";\'-2;ok;');
});
