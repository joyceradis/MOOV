#!/usr/bin/env node
// Entrada do servidor MOOV operacional.
//   node server/main.mjs serve                 → painel + API em MOOV_PORT (padrão 8787), banco em MOOV_DB
//   node server/main.mjs seed-demo             → carga do conjunto fictício (banco vazio)
//   MOOV_NEW_PASSWORD=... node server/main.mjs create-user <usuario> <admin|gestor|regulacao>
// Não há usuário nem senha padrão. Não aponte MOOV_DB para dados reais sem a aprovação prevista na issue #4.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.mjs';
import { createApp } from './app.mjs';
import { createService, makeClock } from './service.mjs';
import { seedDemo } from './seed.mjs';

const [command = 'serve', ...args] = process.argv.slice(2);
const dbPath = process.env.MOOV_DB || 'moov-dev.sqlite';

function run() {
  const db = openDatabase(dbPath);
  const service = createService(db, makeClock({ timeZone: process.env.MOOV_TZ || 'America/Sao_Paulo' }), {
    linkHours: Number(process.env.MOOV_LINK_HOURS || 12)
  });

  if (command === 'seed-demo') {
    seedDemo(db);
    console.log(`Conjunto fictício carregado em ${dbPath}.`);
  } else if (command === 'create-user') {
    const [username, role] = args;
    service.createUser(username, process.env.MOOV_NEW_PASSWORD, role);
    console.log(`Usuário ${username} (${role}) criado.`);
  } else if (command === 'serve') {
    const port = Number(process.env.MOOV_PORT || 8787);
    const host = process.env.MOOV_HOST || '127.0.0.1';
    const staticRoot = fileURLToPath(new URL('../', import.meta.url));
    createServer(createApp(service, { trustProxy: process.env.MOOV_TRUST_PROXY === '1', staticRoot }))
      .listen(port, host, () => console.log(`MOOV em http://${host}:${port} (painel e API; banco: ${dbPath})`));
  } else {
    console.error('Comandos: serve | seed-demo | create-user <usuario> <perfil>');
    process.exitCode = 1;
  }
}

try {
  run();
} catch (error) {
  console.error(`Erro: ${error.message}`);
  process.exitCode = 1;
}
