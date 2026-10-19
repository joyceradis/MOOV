// Regras de domínio do MOOV operacional. Reaproveita js/metrics.js (etapas, perfis e cálculos),
// para que servidor e painel usem exatamente as mesmas definições.
import '../js/metrics.js';
import { transaction } from './db.mjs';
import { DUMMY_HASH, hashPassword, newToken, sha256, verifyPassword } from './security.mjs';

const M = globalThis.MOOV_METRICS;

// Eventos do banco já são únicos por etapa; só ordena pela sequência de etapas.
const ordered = request => [...request.events].sort((a, b) => M.STAGE_INDEX[a.key] - M.STAGE_INDEX[b.key]);

export const ROLES = ['admin', 'gestor', 'regulacao'];
export const FRONT_PROFILES = ['motorista', 'enfermagem', 'destino'];
const GENESIS = '0'.repeat(64);
const SESSION_MS = 8 * 60 * 60 * 1000;
const NOTE_MAX = 300;
const REGULATION = /^[A-Z0-9-]{3,30}$/;

export class DomainError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Relógio: "agora" no fuso de operação, no formato usado pelas etapas (AAAA-MM-DDTHH:MM).
export function makeClock({ timeZone = 'America/Sao_Paulo', now = () => Date.now() } = {}) {
  const format = new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  return {
    nowMs: now,
    local: () => format.format(new Date(now())).replace(' ', 'T'),
    iso: () => new Date(now()).toISOString()
  };
}

export function createService(db, clock = makeClock(), options = {}) {
  const linkHours = options.linkHours ?? 12;

  const log = (actor, action, target = null) =>
    db.prepare('INSERT INTO access_log (at, actor, action, target) VALUES (?, ?, ?, ?)').run(clock.iso(), actor, action, target);

  // ---------- usuários e sessões ----------

  function createUser(username, password, role) {
    if (!/^[a-z0-9._-]{3,40}$/.test(username || '')) throw new DomainError(400, 'Usuário inválido.');
    if (!ROLES.includes(role)) throw new DomainError(400, 'Perfil inválido.');
    db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
      .run(username, hashPassword(password), role, clock.iso());
    log('sistema', 'usuario.criado', `${username}:${role}`);
  }

  function login(username, password) {
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(username || ''));
    const ok = verifyPassword(String(password || ''), user ? user.password_hash : DUMMY_HASH) && Boolean(user);
    if (!ok) {
      log(`login:${String(username || '').slice(0, 40)}`, 'login.falhou');
      throw new DomainError(401, 'Usuário ou senha inválidos.');
    }
    const token = newToken();
    const expiresAt = clock.nowMs() + SESSION_MS;
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(sha256(token), user.id, expiresAt, clock.nowMs());
    log(`usuario:${user.username}`, 'login.ok');
    return { token, role: user.role, username: user.username, expiresAt: new Date(expiresAt).toISOString() };
  }

  function authenticate(token) {
    if (!token) return null;
    const row = db.prepare(`SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).get(sha256(token), clock.nowMs());
    return row ? { ...row, actor: `usuario:${row.username}` } : null;
  }

  function logout(token) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }

  // ---------- leitura ----------

  const units = () => db.prepare('SELECT id, name, type, lat, lng FROM units ORDER BY id').all()
    .map(u => ({ id: u.id, name: u.name, type: u.type, coords: [u.lat, u.lng] }));
  const fleet = () => db.prepare('SELECT id, flow_type AS flowType, type, operator FROM vehicles ORDER BY id').all()
    .map(v => ({ ...v }));

  function eventsOf(code) {
    return db.prepare('SELECT seq, stage, at, profile, actor, km, vehicle_id, note FROM events WHERE code = ? ORDER BY seq').all(code)
      .map(e => ({
        key: e.stage, at: e.at, profile: e.profile, actor: e.actor, source: 'registro',
        ...(e.km === null ? {} : { km: Number(e.km) }),
        ...(e.vehicle_id ? { vehicleId: e.vehicle_id } : {}),
        ...(e.note ? { note: e.note } : {})
      }));
  }

  function requestRow(code) {
    const r = db.prepare('SELECT * FROM requests WHERE code = ?').get(code);
    if (!r) return null;
    const events = eventsOf(code);
    const designated = events.find(e => e.key === 'designada' && e.vehicleId)?.vehicleId;
    return {
      code: r.code, regulationCode: r.regulation_code, flowType: r.flow_type, originId: r.origin_id,
      destinationId: r.destination_id, vehicleId: r.vehicle_id || designated || null, events
    };
  }

  function allRequests() {
    return db.prepare('SELECT code FROM requests ORDER BY created_at, code').all().map(r => requestRow(r.code));
  }

  const config = () => ({ retentionAlertMin: options.retentionAlertMin ?? 30, unassignedAlertMin: options.unassignedAlertMin ?? 15 });

  function summaries() {
    const now = clock.local();
    return allRequests().map(r => ({ request: r, summary: M.summarize(r, ordered(r), now, config()) }));
  }

  // Tudo o que o painel precisa numa chamada: unidades, frota, parâmetros e solicitações com etapas e resumo.
  function dashboard() {
    const now = clock.local();
    return {
      now,
      config: config(),
      units: units(),
      fleet: fleet(),
      requests: allRequests().map(r => {
        const events = ordered(r);
        return { ...r, events, summary: M.summarize(r, events, now, config()) };
      })
    };
  }

  function getRequest(code) {
    const r = requestRow(code);
    if (!r) throw new DomainError(404, 'Solicitação não encontrada.');
    return { ...r, summary: M.summarize(r, ordered(r), clock.local(), config()) };
  }

  function busyVehicles(exceptCode = null) {
    const busy = new Set();
    for (const r of allRequests()) {
      if (!r.vehicleId || r.code === exceptCode) continue;
      const last = r.events.at(-1)?.key;
      if (last && last !== 'liberado') busy.add(r.vehicleId);
    }
    return busy;
  }

  function fleetSummary() {
    const rows = summaries();
    return M.fleetSummary(fleet(), rows.map(x => x.summary), rows.map(x => ordered(x.request)), clock.local());
  }

  // ---------- trilha encadeada ----------

  function canonical(e) {
    return JSON.stringify([e.code, e.stage, e.at, e.profile, e.actor, e.km ?? null, e.vehicle_id ?? null, e.note ?? null, e.recorded_at]);
  }

  // Grava uma etapa: valida sequência, encadeia o hash e insere (chamar dentro de transação).
  function appendEventTx({ code, stage, profile, actor, km = null, vehicleId = null, note = null }) {
    {
      const request = requestRow(code);
      if (!request) throw new DomainError(404, 'Solicitação não encontrada.');
      if (request.flowType !== 'municipal') throw new DomainError(409, 'Fluxo SAMU 192 não é registrado pela frota municipal.');
      const next = M.nextStage(ordered(request));
      if (!next || next.key !== stage) throw new DomainError(409, 'Etapa fora de sequência.');
      if (next.requiresKm) {
        if (!Number.isInteger(km) || km < 0 || km > 9_999_999) throw new DomainError(400, 'Informe o km do hodômetro (número inteiro).');
        const previous = request.events.filter(e => Number.isFinite(e.km)).map(e => e.km).pop();
        if (Number.isFinite(previous) && km < previous) throw new DomainError(400, `Km menor que o registrado anteriormente (${previous}).`);
      } else {
        km = null;
      }
      if (stage === 'designada') {
        const vehicle = fleet().find(v => v.id === vehicleId && v.flowType === 'municipal');
        if (!vehicle) throw new DomainError(400, 'Selecione um veículo da frota municipal.');
        if (request.vehicleId && request.vehicleId !== vehicleId) throw new DomainError(409, `Solicitação já vinculada ao veículo ${request.vehicleId}.`);
        if (busyVehicles(code).has(vehicleId)) throw new DomainError(409, `${vehicleId} está em atendimento ou retido no destino.`);
      } else {
        vehicleId = null;
      }
      const cleanNote = note ? String(note).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, NOTE_MAX) || null : null;
      const prev = db.prepare('SELECT hash FROM events ORDER BY seq DESC LIMIT 1').get()?.hash || GENESIS;
      const row = { code, stage, at: clock.local(), profile, actor, km, vehicle_id: vehicleId, note: cleanNote, recorded_at: clock.iso() };
      const hash = sha256(prev + canonical(row));
      db.prepare(`INSERT INTO events (code, stage, at, profile, actor, km, vehicle_id, note, recorded_at, prev_hash, hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(code, stage, row.at, profile, actor, km, vehicleId, cleanNote, row.recorded_at, prev, hash);
      log(actor, `etapa.${stage}`, code);
      return { code, key: stage, at: row.at, profile, ...(km === null ? {} : { km }), ...(vehicleId ? { vehicleId } : {}) };
    }
  }

  const appendEvent = input => transaction(db, () => appendEventTx(input));

  // Recalcula a cadeia inteira; aponta o primeiro evento adulterado, removido ou reordenado.
  function verifyChain() {
    let prev = GENESIS;
    const rows = db.prepare('SELECT * FROM events ORDER BY seq').all();
    for (const row of rows) {
      if (row.prev_hash !== prev || sha256(prev + canonical(row)) !== row.hash) {
        return { ok: false, count: rows.length, brokenAt: Number(row.seq) };
      }
      prev = row.hash;
    }
    return { ok: true, count: rows.length, head: prev };
  }

  // ---------- regulação ----------

  function createRequest(user, { originId, destinationId, regulationCode }) {
    const all = units();
    if (!all.some(u => u.id === originId && u.type === 'origem') || !all.some(u => u.id === destinationId && u.type === 'destino')) {
      throw new DomainError(400, 'Selecione uma unidade de origem e uma de destino.');
    }
    const regulation = String(regulationCode || '').trim().toUpperCase();
    if (regulation && !REGULATION.test(regulation)) throw new DomainError(400, 'Código de regulação inválido.');
    return transaction(db, () => {
      const at = clock.local();
      const day = `${at.slice(2, 4)}${at.slice(5, 7)}${at.slice(8, 10)}`;
      const count = db.prepare('SELECT COUNT(*) AS n FROM requests WHERE code LIKE ?').get(`SOL-${day}-R%`).n;
      const code = `SOL-${day}-R${String(Number(count) + 1).padStart(4, '0')}`;
      db.prepare(`INSERT INTO requests (code, regulation_code, flow_type, origin_id, destination_id, created_by, created_at)
        VALUES (?, ?, 'municipal', ?, ?, ?, ?)`).run(code, regulation || 'não informado', originId, destinationId, user.actor, clock.iso());
      log(user.actor, 'solicitacao.criada', code);
      appendEventTx({ code, stage: 'solicitada', profile: 'regulacao', actor: user.actor });
      return code;
    });
  }

  function designate(user, code, vehicleId) {
    return appendEvent({ code, stage: 'designada', profile: 'regulacao', actor: user.actor, vehicleId });
  }

  function issueLink(user, code, profile) {
    if (!FRONT_PROFILES.includes(profile)) throw new DomainError(400, 'Perfil da ponta inválido.');
    const request = requestRow(code);
    if (!request) throw new DomainError(404, 'Solicitação não encontrada.');
    if (request.flowType !== 'municipal') throw new DomainError(409, 'Fluxo SAMU 192 não recebe link da frota municipal.');
    const token = newToken();
    const expiresAt = clock.nowMs() + linkHours * 3600 * 1000;
    db.prepare('INSERT INTO links (token_hash, code, profile, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sha256(token), code, profile, expiresAt, user.actor, clock.nowMs());
    log(user.actor, `link.emitido.${profile}`, code);
    return { token, code, profile, expiresAt: new Date(expiresAt).toISOString() };
  }

  function revokeLinks(user, code) {
    const result = db.prepare('UPDATE links SET revoked_at = ? WHERE code = ? AND revoked_at IS NULL').run(clock.nowMs(), code);
    log(user.actor, 'link.revogado', code);
    return Number(result.changes);
  }

  // ---------- ponta (link temporário) ----------

  function resolveLink(token) {
    const link = token && db.prepare('SELECT * FROM links WHERE token_hash = ?').get(sha256(token));
    if (!link || link.revoked_at !== null || link.expires_at <= clock.nowMs()) {
      throw new DomainError(401, 'Link inválido, expirado ou revogado. Peça um novo link à regulação.');
    }
    return link;
  }

  // Visão da ponta: apenas dados logísticos da solicitação vinculada ao link.
  function frontView(token) {
    const link = resolveLink(token);
    const request = requestRow(link.code);
    const events = ordered(request);
    const next = M.nextStage(events);
    const name = id => units().find(u => u.id === id)?.name || '—';
    const last = events.at(-1);
    return {
      code: request.code,
      regulationCode: request.regulationCode,
      profile: link.profile,
      origin: name(request.originId),
      destination: name(request.destinationId),
      vehicleId: request.vehicleId,
      lastStage: last ? { key: last.key, label: M.stageLabel(last.key), at: last.at } : null,
      nextStage: next && M.PROFILE_STAGES[link.profile].includes(next.key)
        ? { key: next.key, label: next.label, requiresKm: Boolean(next.requiresKm) }
        : null,
      waitingFor: next && !M.PROFILE_STAGES[link.profile].includes(next.key) ? { label: next.label, profile: next.profile } : null,
      expiresAt: new Date(link.expires_at).toISOString()
    };
  }

  function frontRecord(token, { stage, km, note }) {
    const link = resolveLink(token);
    if (!M.PROFILE_STAGES[link.profile].includes(stage)) throw new DomainError(403, 'Etapa não permitida para este perfil.');
    const kmValue = km === undefined || km === null || km === '' ? null : Number(km);
    return appendEvent({ code: link.code, stage, profile: link.profile, actor: `link:${link.id}`, km: kmValue, note });
  }

  return {
    createUser, login, authenticate, logout, units, fleet, summaries, dashboard, getRequest, fleetSummary,
    appendEvent, verifyChain, createRequest, designate, issueLink, revokeLinks, frontView, frontRecord, busyVehicles,
    log, toCsv: M.toCsv, stageLabel: M.stageLabel, STAGES: M.STAGES
  };
}
