// Modo conectado: servidor real (painel + API na mesma origem), banco em memória com dados fictícios, Chromium.
// Fluxo completo: regulação entra, abre e designa, gera links; motorista registra pelo link; gestão vê no painel.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { openDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { createService, makeClock } from '../server/service.mjs';
import { seedDemo } from '../server/seed.mjs';

const PASSWORD = 'senha-de-teste-forte-123';
const root = fileURLToPath(new URL('../', import.meta.url));
const clockState = { ms: Date.UTC(2026, 4, 6, 12, 30) }; // 06/05/2026 09:30 em America/Sao_Paulo
let server;
let base;
let browser;

before(async () => {
  const db = openDatabase(':memory:');
  seedDemo(db);
  const service = createService(db, makeClock({ now: () => clockState.ms }));
  service.createUser('gestora', PASSWORD, 'gestor');
  service.createUser('regulador', PASSWORD, 'regulacao');
  server = createServer(createApp(service, { staticRoot: root }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve));
});

async function newContext() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const external = [];
  await context.route(url => !url.href.startsWith(base), route => {
    external.push(route.request().url());
    return route.abort();
  });
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return { context, external };
}

async function open(context, path) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(base + path);
  return { page, errors };
}

async function login(page, username) {
  await page.waitForSelector('#loginForm');
  await page.fill('#loginUser', username);
  await page.fill('#loginPassword', PASSWORD);
  await page.click('#loginForm button[type="submit"]');
}

test('servidor entrega só os arquivos do site, com CSP; nada de código do servidor, banco ou caminho relativo', async () => {
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(home.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(`${base}/js/api.js`)).status, 200);
  assert.equal((await fetch(`${base}/vendor/leaflet-1.9.4/leaflet.css`)).status, 200);
  for (const path of ['/server/main.mjs', '/package.json', '/moov-dev.sqlite', '/.git/config', '/%2e%2e/package.json',
    '/js/..%2fserver/main.mjs', '/docs/arquitetura.md', '/pages/', '/README.md']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(`${base}/api/dashboard`)).status, 401);
});

test('regulação: login por perfil, abre solicitação, designa veículo e gera links da ponta', async () => {
  const { context, external } = await newContext();
  const { page, errors } = await open(context, '/pages/regulacao.html');

  // Perfil sem acesso à regulação é recusado na própria tela de login.
  await login(page, 'gestora');
  await page.waitForSelector('.login-error:not(:empty)');
  assert.match(await page.textContent('.login-error'), /Gestão não tem acesso/);
  assert.equal(await page.locator('.form-shell').isVisible(), false);

  await login(page, 'regulador');
  await page.waitForSelector('#pendingList li[data-code="SOL-260506-P03-006"]');
  assert.match(await page.textContent('.demo-notice'), /Conectado ao servidor MOOV/);
  assert.match(await page.textContent('.user-bar'), /regulador · Regulação/);
  assert.match(await page.textContent('#availableSummary'), /PMV-05/);

  await page.selectOption('#originField', 'PASP');
  await page.selectOption('#destinationField', 'HEVV');
  await page.fill('#regulationField', 'reg-0506-1300');
  await page.click('#newRequest button[type="submit"]');
  await page.waitForSelector('#createResult.show');
  assert.match(await page.textContent('#createResult'), /SOL-260506-R0001 aberta/);

  const item = page.locator('#pendingList li[data-code="SOL-260506-R0001"]');
  await item.locator('select').selectOption('PMV-05');
  await item.locator('button').click();
  await page.waitForFunction(() => /PMV-05 designado para SOL-260506-R0001/.test(document.querySelector('#assignResult').textContent));
  await page.click('#assignResult .front-links button');
  await page.waitForSelector('#assignResult .link-list li[data-profile="motorista"] a');
  const href = await page.getAttribute('#assignResult .link-list li[data-profile="motorista"] a', 'href');
  assert.match(href, new RegExp(`^${base}/pages/motorista\\.html#link=[A-Za-z0-9_-]{43}$`));
  assert.equal(await page.locator('#assignResult .link-list li').count(), 3);
  // A sessão fica na aba (sessionStorage), não em localStorage.
  assert.equal(await page.evaluate(() => localStorage.length), 0);

  // ---------- motorista abre o link ----------
  const driver = (await open(context, href.slice(base.length))).page;
  await driver.waitForSelector('#requestView:not([hidden])');
  assert.equal(await driver.evaluate(() => window.location.hash), '', 'token sai da barra de endereço');
  assert.equal(await driver.textContent('#sumCode'), 'SOL-260506-R0001');
  assert.equal(await driver.textContent('#sumVehicle'), 'PMV-05');
  assert.equal(await driver.textContent('#nextStage'), 'Chegada à origem');
  clockState.ms += 6 * 60000;
  await driver.check('#confirmVehicle');
  await driver.click('#stageForm button[type="submit"]');
  await driver.waitForSelector('#success.show');
  assert.match(await driver.textContent('#success'), /Chegada à origem" registrada às 09:36 e gravada no servidor/);
  // Próxima etapa é da equipe: a página do motorista bloqueia.
  await driver.waitForSelector('#blockedMessage:not([hidden])');
  assert.match(await driver.textContent('#blockedMessage'), /Embarque/);

  // Página da equipe sem link: só a orientação, sem campo de código.
  const team = (await open(context, '/pages/enfermagem.html')).page;
  await team.waitForFunction(() => /link enviado pela regulação/.test(document.querySelector('#lookupMessage').textContent));
  assert.equal(await team.locator('#codeInput').isVisible(), false);

  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__csp), []);
  assert.deepEqual(await driver.evaluate(() => window.__csp), []);
  assert.deepEqual(external, []);
  await context.close();
});

test('painel conectado: gestão entra e vê o registro feito pela ponta; sair encerra a sessão', async () => {
  const { context } = await newContext();
  const { page, errors } = await open(context, '/index.html');
  await login(page, 'gestora');
  await page.waitForSelector('#requestTable tr[data-code="SOL-260506-R0001"]');
  const row = await page.textContent('#requestTable tr[data-code="SOL-260506-R0001"]');
  assert.match(row, /PMV-05/);
  assert.match(row, /Chegada à origem/);
  assert.match(await page.textContent('.demo-notice'), /Conectado ao servidor MOOV/);
  assert.match(await page.textContent('#localCount'), /gestora · Gestão/);
  assert.equal(await page.textContent('#clockLabel'), 'Horário do servidor');
  assert.ok(await page.locator('#exportAudit').isVisible());

  // Cronologia mostra a autoria registrada pelo servidor.
  await page.click('[data-select="SOL-260506-R0001"]');
  assert.match(await page.textContent('#timeline'), /usuario:regulador/);
  assert.match(await page.textContent('#timeline'), /link:/);
  // Gestão não emite link da ponta.
  assert.match(await page.textContent('#selectedTransfer'), /emitidos pela regulação/);

  await page.click('#resetDemo');
  await page.waitForSelector('#loginForm');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('moov-session')), null);
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__csp), []);
  await context.close();
});
