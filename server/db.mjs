// Banco do MOOV operacional. SQLite embutido (node:sqlite) para desenvolvimento e testes;
// o SQL é deliberadamente simples para migrar a PostgreSQL quando a hospedagem for escolhida.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('origem', 'destino', 'ocorrencia')),
  lat REAL NOT NULL,
  lng REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  flow_type TEXT NOT NULL CHECK (flow_type IN ('municipal', 'samu')),
  type TEXT NOT NULL,
  operator TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'gestor', 'regulacao')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Solicitação: imutável após criada. Veículo vem do evento "designada".
CREATE TABLE IF NOT EXISTS requests (
  code TEXT PRIMARY KEY,
  regulation_code TEXT NOT NULL,
  flow_type TEXT NOT NULL CHECK (flow_type IN ('municipal', 'samu')),
  origin_id TEXT NOT NULL REFERENCES units(id),
  destination_id TEXT NOT NULL REFERENCES units(id),
  vehicle_id TEXT REFERENCES vehicles(id),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Trilha de etapas: append-only, uma etapa por solicitação, encadeada por hash.
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL REFERENCES requests(code),
  stage TEXT NOT NULL,
  at TEXT NOT NULL,
  profile TEXT NOT NULL,
  actor TEXT NOT NULL,
  km INTEGER,
  vehicle_id TEXT REFERENCES vehicles(id),
  note TEXT,
  recorded_at TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  UNIQUE (code, stage)
);

-- Links temporários da ponta: valem para um código e um perfil, expiram e podem ser revogados.
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL REFERENCES requests(code),
  profile TEXT NOT NULL CHECK (profile IN ('motorista', 'enfermagem', 'destino')),
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Registro de acessos e ações administrativas (append-only).
CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT
);

CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'trilha de eventos é append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'trilha de eventos é append-only'); END;
CREATE TRIGGER IF NOT EXISTS requests_no_update BEFORE UPDATE ON requests
BEGIN SELECT RAISE(ABORT, 'solicitação é imutável'); END;
CREATE TRIGGER IF NOT EXISTS requests_no_delete BEFORE DELETE ON requests
BEGIN SELECT RAISE(ABORT, 'solicitação é imutável'); END;
CREATE TRIGGER IF NOT EXISTS access_log_no_update BEFORE UPDATE ON access_log
BEGIN SELECT RAISE(ABORT, 'registro de acesso é append-only'); END;
CREATE TRIGGER IF NOT EXISTS access_log_no_delete BEFORE DELETE ON access_log
BEGIN SELECT RAISE(ABORT, 'registro de acesso é append-only'); END;
`;

export function openDatabase(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

// Executa fn dentro de uma transação; desfaz tudo se lançar.
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
