// Testes do backend operacional: HTTP real em porta efêmera, banco em memória, dados fictícios.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { openDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { createService, makeClock } from '../server/service.mjs';
import { seedDemo } from '../server/seed.mjs';

const PASSWORD = 'senha-de-teste-forte-123';
const clockState = { ms: Date.UTC(2026, 4, 6, 12, 30) }; // 06/05/2026 09:30 em America/Sao_Paulo
let server;
let base;
let db;
let service;

before(async () => {
  db = openDatabase(':memory:');
  seedDemo(db);
  service = createService(db, makeClock({ now: () => clockState.ms }), { linkHours: 12 });
  service.createUser('gestora', PASSWORD, 'gestor');
  service.createUser('regulador', PASSWORD, 'regulacao');
  service.createUser('admin', PASSWORD, 'admin');
  server = createServer(createApp(service));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise(resolve => server.close(resolve)));

async function call(method, path, { token, link, body, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (link) headers.authorization = `Link ${link}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* CSV ou texto */ }
  return { status: res.status, json, text, headers: res.headers };
}

const login = async username => (await call('POST', '/api/session', { body: { username, password: PASSWORD } })).json.token;

test('cabeçalhos de segurança em toda resposta; rota desconhecida 404', async () => {
  const res = await call('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await call('GET', '/api/nada')).status, 404);
  assert.equal((await call('PUT', '/api/health')).status, 405);
});

test('login: senha errada e usuário inexistente dão a mesma resposta; sessão dá acesso por perfil', async () => {
  const wrong = await call('POST', '/api/session', { body: { username: 'gestora', password: 'errada-errada-1' } });
  const ghost = await call('POST', '/api/session', { body: { username: 'ninguem', password: 'errada-errada-1' } });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.json, ghost.json);
  assert.equal((await call('GET', '/api/requests')).status, 401);
  const token = await login('gestora');
  assert.deepEqual((await call('GET', '/api/me', { token })).json, { username: 'gestora', role: 'gestor' });
  assert.equal((await call('GET', '/api/requests', { token })).json.length, 8);
  // Gestora lê, mas não cria solicitação.
  assert.equal((await call('POST', '/api/requests', { token, body: { originId: 'PASP', destinationId: 'HEVV' } })).status, 403);
});

test('POST exige JSON (mitiga CSRF por formulário) e limita tamanho', async () => {
  const token = await login('regulador');
  const form = await fetch(base + '/api/requests', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'originId=PASP'
  });
  assert.equal(form.status, 415);
  assert.equal((await call('POST', '/api/requests', { token, raw: JSON.stringify({ x: 'a'.repeat(20000) }), body: {} })).status, 413);
  assert.equal((await call('POST', '/api/requests', { token, raw: '[1,2]', body: {} })).status, 400);
});

test('indicadores do servidor batem com os do painel (mesmo js/metrics.js)', async () => {
  const token = await login('gestora');
  const list = (await call('GET', '/api/requests', { token })).json;
  const p02 = list.find(s => s.code === 'SOL-260506-P02-002');
  assert.equal(p02.retentionMin, 69);
  assert.match(p02.alerts.join(), /retido no destino há 69 min/);
  const samu = list.find(s => s.code === 'SAMU-192-260506-003');
  assert.equal(samu.retentionMin, null);
  assert.deepEqual(samu.alerts, []);
  const fleet = (await call('GET', '/api/fleet', { token })).json;
  assert.deepEqual(fleet.map(v => v.id), ['PMV-03', 'PMV-05', 'PMV-08', 'PMV-11']);
});

test('fluxo operacional: regulação abre, designa, emite links; ponta registra só o que lhe cabe', async () => {
  const reg = await login('regulador');
  const created = await call('POST', '/api/requests', { token: reg, body: { originId: 'PASP', destinationId: 'HEVV', regulationCode: 'reg-0506-1300' } });
  assert.equal(created.status, 200);
  const code = created.json.code;
  assert.equal(code, 'SOL-260506-R0001');

  // Veículo ocupado (retido no destino) é recusado; livre é aceito.
  assert.equal((await call('POST', `/api/requests/${code}/designate`, { token: reg, body: { vehicleId: 'PMV-03' } })).status, 409);
  assert.equal((await call('POST', `/api/requests/${code}/designate`, { token: reg, body: { vehicleId: 'USB-12' } })).status, 400);
  const designated = await call('POST', `/api/requests/${code}/designate`, { token: reg, body: { vehicleId: 'PMV-05' } });
  assert.equal(designated.json.vehicleId, 'PMV-05');

  const driverLink = (await call('POST', `/api/requests/${code}/links`, { token: reg, body: { profile: 'motorista' } })).json;
  const teamLink = (await call('POST', `/api/requests/${code}/links`, { token: reg, body: { profile: 'enfermagem' } })).json;
  assert.match(driverLink.token, /^[A-Za-z0-9_-]{43}$/);

  // Visão da ponta: só dados logísticos.
  const view = (await call('GET', '/api/ponta', { link: driverLink.token })).json;
  assert.deepEqual(Object.keys(view).sort(), ['code', 'destination', 'expiresAt', 'lastStage', 'nextStage', 'origin', 'profile', 'regulationCode', 'vehicleId', 'waitingFor']);
  assert.equal(view.nextStage.key, 'chegada_origem');
  assert.equal((await call('GET', '/api/ponta', { link: teamLink.token })).json.waitingFor.label, 'Chegada à origem');

  // Equipe não registra etapa do motorista; motorista registra.
  assert.equal((await call('POST', '/api/ponta/events', { link: teamLink.token, body: { stage: 'chegada_origem' } })).status, 403);
  clockState.ms += 7 * 60000;
  const arrived = await call('POST', '/api/ponta/events', { link: driverLink.token, body: { stage: 'chegada_origem', note: 'Obs: portaria\u0000lenta' } });
  assert.equal(arrived.status, 200);
  assert.equal(arrived.json.at, '2026-05-06T09:37');
  assert.equal((await call('POST', '/api/ponta/events', { link: driverLink.token, body: { stage: 'chegada_origem' } })).status, 409);
  assert.equal((await call('POST', '/api/ponta/events', { link: teamLink.token, body: { stage: 'embarque' } })).status, 200);
  assert.equal((await call('POST', '/api/ponta/events', { link: driverLink.token, body: { stage: 'saida_origem', km: 1.5 } })).status, 400);
  assert.equal((await call('POST', '/api/ponta/events', { link: driverLink.token, body: { stage: 'saida_origem', km: 30230 } })).status, 200);
  const backwards = await call('POST', '/api/ponta/events', { link: driverLink.token, body: { stage: 'chegada_destino', km: 30200 } });
  assert.match(backwards.json.error, /menor que o registrado anteriormente \(30230\)/);

  const detail = (await call('GET', `/api/requests/${code}`, { token: reg })).json;
  assert.deepEqual(detail.events.map(e => e.key), ['solicitada', 'designada', 'chegada_origem', 'embarque', 'saida_origem']);
  assert.equal(detail.events[2].actor.startsWith('link:'), true);
  assert.equal(detail.events[2].note, 'Obs: portaria lenta'); // caractere de controle removido
  assert.equal(detail.summary.vehicleId, 'PMV-05');
});

test('links expiram e podem ser revogados; token nunca é aceito na URL', async () => {
  const reg = await login('regulador');
  const code = 'SOL-260506-P02-002';
  const link = (await call('POST', `/api/requests/${code}/links`, { token: reg, body: { profile: 'destino' } })).json;
  assert.equal((await call('GET', '/api/ponta', { link: link.token })).status, 200);
  assert.equal((await call('GET', `/api/ponta?t=${link.token}`)).status, 401);
  assert.equal((await call('POST', `/api/requests/${code}/links/revoke`, { token: reg })).json.revoked >= 1, true);
  assert.equal((await call('GET', '/api/ponta', { link: link.token })).status, 401);

  const fresh = (await call('POST', `/api/requests/${code}/links`, { token: reg, body: { profile: 'destino' } })).json;
  clockState.ms += 13 * 3600 * 1000; // passa das 12 h
  assert.match((await call('GET', '/api/ponta', { link: fresh.token })).json.error, /expirado/);
  clockState.ms -= 13 * 3600 * 1000;
  assert.equal((await call('POST', '/api/requests/SAMU-192-260506-003/links', { token: reg, body: { profile: 'destino' } })).status, 409);
});

test('trilha append-only: UPDATE/DELETE bloqueados no banco; adulteração direta é detectada', async () => {
  const token = await login('gestora');
  const ok = (await call('GET', '/api/audit/verify', { token })).json;
  assert.equal(ok.ok, true);
  assert.ok(ok.count > 40);
  assert.throws(() => db.exec("UPDATE events SET km = 1 WHERE seq = 1"), /append-only/);
  assert.throws(() => db.exec('DELETE FROM events WHERE seq = 1'), /append-only/);
  assert.throws(() => db.exec("UPDATE requests SET regulation_code = 'X'"), /imutável/);

  // Simula quem contorna os triggers (acesso direto ao arquivo): a verificação aponta o evento.
  db.exec('DROP TRIGGER events_no_update');
  db.exec("UPDATE events SET km = 99999 WHERE seq = 5");
  const broken = (await call('GET', '/api/audit/verify', { token })).json;
  assert.deepEqual([broken.ok, broken.brokenAt], [false, 5]);
  db.exec("UPDATE events SET km = 44990 WHERE seq = 5"); // valor original de SOL-260506-P03-004 saída
  db.exec("CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'trilha de eventos é append-only'); END;");
});

test('exportação CSV só para gestão/admin, com autoria e proteção de fórmula; acesso fica registrado', async () => {
  const reg = await login('regulador');
  assert.equal((await call('GET', '/api/export/audit.csv', { token: reg })).status, 403);
  const token = await login('gestora');
  const res = await call('GET', '/api/export/audit.csv', { token });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.text.split('\r\n')[0], /codigo;regulacao;fluxo;veiculo;etapa;horario;perfil;autor;km;observacao/);
  const log = db.prepare("SELECT action FROM access_log WHERE action IN ('exportacao.trilha', 'login.falhou', 'link.revogado')").all().map(r => r.action);
  assert.ok(log.includes('exportacao.trilha') && log.includes('login.falhou') && log.includes('link.revogado'));
  assert.throws(() => db.exec('DELETE FROM access_log'), /append-only/);
});

test('logout invalida a sessão; sessão expira em 8 h', async () => {
  const token = await login('gestora');
  assert.equal((await call('DELETE', '/api/session', { token })).status, 200);
  assert.equal((await call('GET', '/api/me', { token })).status, 401);
  const other = await login('gestora');
  clockState.ms += 8 * 3600 * 1000 + 1;
  assert.equal((await call('GET', '/api/me', { token: other })).status, 401);
  clockState.ms -= 8 * 3600 * 1000 + 1;
});

test('senha fraca é recusada na criação de usuário; perfil inválido também', () => {
  assert.throws(() => service.createUser('fraca', 'curta', 'gestor'), /12 caracteres/);
  assert.throws(() => service.createUser('outro', PASSWORD, 'superuser'), /Perfil inválido/);
});

test('limite de tentativas de login por IP', async () => {
  for (let i = 0; i < 10; i += 1) {
    await call('POST', '/api/session', { body: { username: 'x', password: 'errada-errada-1' } });
  }
  assert.equal((await call('POST', '/api/session', { body: { username: 'gestora', password: PASSWORD } })).status, 429);
});
