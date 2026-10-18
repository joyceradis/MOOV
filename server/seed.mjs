// Carga do conjunto FICTÍCIO (js/data.js) num banco vazio, para desenvolvimento e homologação.
// Grava as etapas pela própria trilha encadeada (com horários do conjunto), sem atalhos no banco.
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { transaction } from './db.mjs';
import { sha256 } from './security.mjs';

export function loadDemoData() {
  const context = createContext({});
  runInContext(readFileSync(new URL('../js/data.js', import.meta.url), 'utf8') + '\nglobalThis.__data = MOOV_DATA;', context);
  return JSON.parse(JSON.stringify(context.__data));
}

export function seedDemo(db) {
  const data = loadDemoData();
  if (db.prepare('SELECT COUNT(*) AS n FROM requests').get().n > 0) {
    throw new Error('Banco já possui solicitações; a carga fictícia só roda em banco vazio.');
  }
  transaction(db, () => {
    for (const u of data.units) {
      db.prepare('INSERT INTO units (id, name, type, lat, lng) VALUES (?, ?, ?, ?, ?)').run(u.id, u.name, u.type, u.coords[0], u.coords[1]);
    }
    for (const v of data.fleet) {
      db.prepare('INSERT INTO vehicles (id, flow_type, type, operator) VALUES (?, ?, ?, ?)').run(v.id, v.flowType, v.type, v.operator);
    }
    let prev = '0'.repeat(64);
    for (const r of data.requests) {
      db.prepare(`INSERT INTO requests (code, regulation_code, flow_type, origin_id, destination_id, vehicle_id, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'carga-ficticia', ?)`)
        .run(r.code, r.regulationCode, r.flowType, r.originId, r.destinationId, r.vehicleId, r.events[0]?.at || data.referenceTime);
      for (const e of r.events) {
        const row = {
          code: r.code, stage: e.key, at: e.at, profile: 'carga-ficticia', actor: 'carga-ficticia',
          km: Number.isFinite(e.km) ? e.km : null, vehicle_id: null, note: null, recorded_at: `${e.at}:00.000Z`
        };
        const hash = sha256(prev + JSON.stringify([row.code, row.stage, row.at, row.profile, row.actor, row.km, row.vehicle_id, row.note, row.recorded_at]));
        db.prepare(`INSERT INTO events (code, stage, at, profile, actor, km, vehicle_id, note, recorded_at, prev_hash, hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(row.code, row.stage, row.at, row.profile, row.actor, row.km, null, null, row.recorded_at, prev, hash);
        prev = hash;
      }
    }
  });
  return data;
}
