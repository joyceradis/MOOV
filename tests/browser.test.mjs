// Testes de comportamento em navegador real (Chromium via Playwright).
// Toda requisição para fora do servidor local é registrada e bloqueada (tiles do mapa inclusive).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

let server;
let baseUrl;
let browser;

before(async () => {
  server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = join(root, path.endsWith('/') ? path + 'index.html' : path);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve));
});

async function newContext({ viewport, blockLeaflet = false } = {}) {
  const context = await browser.newContext({ viewport: viewport || { width: 1366, height: 900 }, acceptDownloads: true });
  const external = [];
  await context.route(url => !url.href.startsWith(baseUrl), route => {
    external.push(route.request().url());
    return route.abort();
  });
  if (blockLeaflet) {
    await context.route(url => url.href.includes('/vendor/leaflet-1.9.4/'), route => route.abort());
  }
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
  await page.goto(baseUrl + path);
  return { page, errors };
}

const nonTileRequests = list => list.filter(url => !/basemaps\.cartocdn\.com/.test(url));

async function assertText(page, selector, expected) {
  await page.waitForFunction(
    ([sel, text]) => document.querySelector(sel)?.textContent.trim() === text,
    [selector, expected],
    { timeout: 5000 }
  ).catch(async () => {
    assert.equal((await page.textContent(selector))?.trim(), expected, selector);
  });
}

test('painel: carrega sem erros nem violação de CSP; mapa esquemático com Leaflet local', async () => {
  const { context, external } = await newContext();
  const { page, errors } = await open(context, '/index.html');
  await page.waitForSelector('#map.leaflet-container');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.leaflet-pane')).position), 'absolute');
  // Marcadores esquemáticos: só solicitações com veículo e não liberadas (5 no conjunto).
  assert.equal(await page.locator('.vehicle-wrap').count(), 5);
  assert.match(await page.textContent('.map-caption'), /esquemática.*Não é GPS/s);
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__csp), []);
  assert.deepEqual(nonTileRequests(external), []);
  await context.close();
});

test('painel: indicadores da frota municipal calculados dos registros (valores conferidos à mão)', async () => {
  const { context } = await newContext();
  const { page } = await open(context, '/index.html');
  // Só as 6 solicitações municipais entram; as 2 do SAMU 192 são contadas à parte.
  await assertText(page, '#kpiTotal', '6');
  await assertText(page, '#kpiTotalDetail', 'frota municipal · 2 com alerta · +2 SAMU 192 fora dos indicadores');
  await assertText(page, '#kpiResponse', '14 min'); // (6+16+20+12)/4 = 13,5 → 14
  await assertText(page, '#kpiResponseDetail', 'solicitação → chegada à origem · n=4');
  await assertText(page, '#kpiTotalTime', '58 min'); // (65+51)/2
  await assertText(page, '#kpiRetention', '1 h 51 min'); // 69+19+23
  await assertText(page, '#kpiKm', '27 km'); // 13+14
  await assertText(page, '#kpiKmDetail', '2 de 3 trajetos com km completo');
  await assertText(page, '#kpiComplete', '97%'); // 36/37

  await page.selectOption('#flowType', 'samu');
  await assertText(page, '#kpiTotal', '0');
  await assertText(page, '#kpiRetention', '—');
  assert.equal(await page.locator('#requestTable tbody tr').count(), 2);
  await page.selectOption('#flowType', 'municipal');
  await assertText(page, '#kpiTotal', '6');
  assert.equal(await page.locator('#requestTable tbody tr').count(), 6);
  await page.selectOption('#destinationFilter', 'HUCAM');
  await assertText(page, '#kpiTotal', '2');
  await page.selectOption('#stageFilter', 'liberado');
  await assertText(page, '#kpiTotal', '1');
  await page.selectOption('#vehicleFilter', 'PMV-05');
  await assertText(page, '#kpiTotal', '0');
  await assertText(page, '#kpiResponse', '—');
  await assertText(page, '#timelineCode', 'Sem seleção');
  await page.click('#resetFilters');
  await assertText(page, '#kpiTotal', '6');
  await context.close();
});

test('painel: seleção por código mostra cronologia, lacunas e links da ponta (só frota municipal)', async () => {
  const { context } = await newContext();
  const { page } = await open(context, '/index.html');
  await page.click('[data-select="SOL-260506-P03-004"]');
  await assertText(page, '#timelineCode', 'SOL-260506-P03-004');
  assert.equal(await page.locator('#timeline li.done').count(), 8);
  assert.match(await page.textContent('#timeline li.gap'), /Chegada ao destino: km não informado/);
  assert.equal(await page.getAttribute('[data-select="SOL-260506-P03-004"]', 'aria-pressed'), 'true');
  const href = await page.getAttribute('#selectedTransfer a[href*="motorista"]', 'href');
  assert.equal(href, './pages/motorista.html?codigo=SOL-260506-P03-004');

  await page.click('[data-select="SAMU-192-260506-003"]');
  await assertText(page, '#timelineCode', 'SAMU-192-260506-003');
  assert.equal(await page.locator('#selectedTransfer .front-links').count(), 0);
  assert.equal(await page.locator('#timeline li.gap, #timeline li.pending').count(), 0);
  assert.equal(await page.locator('#requestTable tr[data-code="SAMU-192-260506-003"].has-alert').count(), 0);
  assert.match(await page.textContent('#selectedTransfer'), /fora da frota municipal/);
  await context.close();
});

test('fluxo completo: motorista e destino registram pelo código; painel em outra aba atualiza', async () => {
  const { context, external } = await newContext();
  const { page: dash } = await open(context, '/index.html');
  await assertText(dash, '#localCount', 'Nenhum registro local.');

  const code = 'SOL-260506-P01-001';
  const { page: driver, errors } = await open(context, `/pages/motorista.html?codigo=${code}`);
  await assertText(driver, '#sumCode', code);
  await assertText(driver, '#nextStage', 'Chegada ao destino');
  assert.ok(await driver.locator('#kmField').isVisible());

  // Km menor que o da saída é recusado e nada é gravado.
  await driver.fill('#kmField', '45000');
  await driver.check('#confirmVehicle');
  await driver.click('#stageForm button[type="submit"]');
  await driver.waitForSelector('#success.show.error');
  assert.match(await driver.textContent('#success'), /Km menor que o registrado anteriormente \(45021\)/);
  assert.equal(await driver.evaluate(() => localStorage.getItem('moov-demo-events-v1')), null);

  // Envio por Enter, com tentativa de injeção de HTML na observação.
  const url = driver.url();
  await driver.fill('#kmField', '45035');
  await driver.selectOption('#routeCondition', 'Trânsito intenso');
  await driver.fill('#noteField', '<img src=x onerror="window.__xss=1">');
  await driver.locator('#kmField').press('Enter');
  await driver.waitForSelector('#success.show:not(.error)');
  assert.match(await driver.textContent('#success'), /registrada às 09:30 .*apenas neste navegador/);
  assert.equal(driver.url(), url);
  // Próxima etapa é do destino: motorista fica bloqueado.
  await driver.waitForSelector('#blockedMessage:not([hidden])');
  assert.match(await driver.textContent('#blockedMessage'), /Recebido no destino — registro pelo perfil Destino/);

  // Painel (outra aba) recebe o evento storage e recalcula.
  await assertText(dash, '#localCount', '1 registro(s) local(is) neste navegador.');
  await assertText(dash, '#kpiKm', '41 km'); // 27 + 14
  await dash.click(`[data-select="${code}"]`);
  const last = dash.locator('#timeline li.done').last();
  assert.match(await last.textContent(), /Chegada ao destino.*registro local.*km 45035/s);
  assert.match(await last.locator('em').textContent(), /Trajeto: Trânsito intenso · Veículo designado confirmado: sim · Obs: <img src=x onerror="window.__xss=1">/);
  assert.equal(await dash.locator('#timeline img').count(), 0);
  assert.equal(await dash.evaluate(() => window.__xss), undefined);

  // Destino registra o recebimento; equipe não tem etapa pendente.
  const { page: dest } = await open(context, `/pages/destino.html?codigo=${code}`);
  await assertText(dest, '#nextStage', 'Recebido no destino');
  await dest.fill('#sectorField', 'Pronto-socorro');
  await dest.check('#receivedCheck');
  await dest.click('#stageForm button[type="submit"]');
  await dest.waitForSelector('#success.show:not(.error)');
  const { page: team } = await open(context, `/pages/enfermagem.html?codigo=${code}`);
  assert.match(await team.textContent('#blockedMessage'), /Veículo liberado — registro pelo perfil Motorista/);
  await assertText(dash, '#localCount', '2 registro(s) local(is) neste navegador.');

  // Apagar registros locais volta ao conjunto fictício.
  await dash.click('#resetDemo');
  await assertText(dash, '#localCount', 'Nenhum registro local.');
  await assertText(dash, '#kpiKm', '27 km');

  await dash.waitForTimeout(300);
  assert.deepEqual(nonTileRequests(external), []);
  assert.deepEqual(errors, []);
  assert.deepEqual(await driver.evaluate(() => window.__csp), []);
  await context.close();
});

test('páginas da ponta: sem código pedem o código; código inexistente e SAMU são tratados', async () => {
  const { context } = await newContext();
  const { page } = await open(context, '/pages/motorista.html');
  assert.ok(await page.locator('#codeLookup').isVisible());
  assert.equal(await page.locator('#requestView').isVisible(), false);
  await page.fill('#codeInput', 'sol-260506-p02-002');
  await page.click('#codeLookup button[type="submit"]');
  await page.waitForURL(/codigo=SOL-260506-P02-002/);
  await assertText(page, '#sumCode', 'SOL-260506-P02-002');
  assert.match(await page.textContent('#blockedMessage'), /registro pelo perfil Destino/);

  await page.goto(`${baseUrl}/pages/destino.html?codigo=NAO-EXISTE-1`);
  assert.match(await page.textContent('#lookupMessage'), /NAO-EXISTE-1 não encontrado/);
  await page.goto(`${baseUrl}/pages/destino.html?codigo=%3Cscript%3E`);
  assert.match(await page.textContent('#lookupMessage'), /Código inválido no link/);
  await page.goto(`${baseUrl}/pages/destino.html`);
  assert.match(await page.textContent('#lookupMessage'), /Abra esta página pelo link/);
  await page.goto(`${baseUrl}/pages/motorista.html?codigo=SAMU-192-260506-007`);
  assert.match(await page.textContent('#blockedMessage'), /SAMU 192/);
  assert.equal(await page.locator('#stageForm').isVisible(), false);
  await context.close();
});

test('formulário inválido não registra', async () => {
  const { context } = await newContext();
  const { page } = await open(context, '/pages/enfermagem.html?codigo=SOL-260506-P02-005');
  // Próxima etapa é do motorista (chegada à origem): equipe bloqueada.
  assert.ok(await page.locator('#blockedMessage').isVisible());
  await page.goto(`${baseUrl}/pages/motorista.html?codigo=SOL-260506-P02-005`);
  await assertText(page, '#nextStage', 'Chegada à origem');
  assert.equal(await page.locator('#kmField').isVisible(), false);
  await page.click('#stageForm button[type="submit"]'); // checkbox obrigatório desmarcado
  assert.equal(await page.locator('#success.show').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await context.close();
});

test('localStorage envenenado (mesma origem) não derruba painel nem páginas da ponta', async () => {
  const { context } = await newContext();
  await context.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    const code = 'SOL-260506-P01-001';
    localStorage.setItem('moov-demo-events-v1', JSON.stringify([
      { code, key: 'constructor', at: '2026-05-06T09:00' },
      { code, key: '__proto__', at: '2026-05-06T09:00' },
      { code, key: 'chegada_destino', at: '2026-05-06T<img src=x>' },
      { code, key: 'chegada_destino', at: '2026-05-06T09:01', km: 'abc' }
    ]));
    localStorage.setItem('moov-demo-clock-v1', '-1e300');
  });
  const { page, errors } = await open(context, '/index.html');
  await assertText(page, '#kpiTotal', '6');
  await assertText(page, '#localCount', 'Nenhum registro local.');
  await assertText(page, '#demoClock', '06/05 09:30');
  await page.click('[data-select="SOL-260506-P01-001"]');
  assert.equal(await page.locator('#timeline li.done').count(), 5);
  assert.equal(await page.locator('#timeline img').count(), 0);
  const { page: driver } = await open(context, '/pages/motorista.html?codigo=SOL-260506-P01-001');
  await assertText(driver, '#nextStage', 'Chegada ao destino');
  assert.deepEqual(errors, []);
  await context.close();
});

test('exportação CSV da trilha de auditoria e do resumo', async () => {
  const { context } = await newContext();
  const { page } = await open(context, '/index.html');
  await page.selectOption('#flowType', 'municipal');
  const [audit] = await Promise.all([page.waitForEvent('download'), page.click('#exportAudit')]);
  assert.match(audit.suggestedFilename(), /^moov-trilha-auditoria-DEMO-.*\.csv$/);
  const auditText = (await readFile(await audit.path(), 'utf8')).replace(/^﻿/, '');
  const lines = auditText.trim().split('\r\n');
  assert.equal(lines[0], 'codigo;regulacao;fluxo;veiculo;origem;destino;etapa;horario;perfil;km;fonte;observacao');
  assert.equal(lines.length - 1, 5 + 6 + 8 + 8 + 2 + 1); // eventos das 6 solicitações municipais
  assert.ok(lines.every(l => !l.includes('SAMU-192')));

  const [summary] = await Promise.all([page.waitForEvent('download'), page.click('#exportSummary')]);
  const rows = (await readFile(await summary.path(), 'utf8')).trim().split('\r\n');
  assert.equal(rows.length, 7);
  assert.match(rows.find(r => r.startsWith('SOL-260506-P03-004')), /Chegada ao destino: km não informado/);
  await context.close();
});

test('sem Leaflet: aviso e painel funcional, com seleção pela tabela', async () => {
  const { context } = await newContext({ blockLeaflet: true });
  const { page, errors } = await open(context, '/index.html');
  await page.waitForSelector('.map-error-banner');
  await assertText(page, '#kpiTotal', '6');
  await page.click('[data-select="SOL-260506-P02-002"]');
  await assertText(page, '#timelineCode', 'SOL-260506-P02-002');
  assert.deepEqual(errors, []);
  await context.close();
});

test('teclado: link de salto e seleção de código pela tabela', async () => {
  const { context } = await newContext();
  const { page } = await open(context, '/index.html');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
  await page.locator('[data-select="SOL-260506-P01-003"]').focus();
  await page.keyboard.press('Enter');
  await assertText(page, '#timelineCode', 'SOL-260506-P01-003');
  await context.close();
});

test('layout móvel: sem rolagem horizontal no painel e nas páginas da ponta', async () => {
  for (const path of ['/index.html', '/pages/motorista.html?codigo=SOL-260506-P01-001', '/pages/enfermagem.html', '/pages/destino.html?codigo=SOL-260506-P02-002']) {
    const { context } = await newContext({ viewport: { width: 375, height: 812 } });
    const { page } = await open(context, path);
    await page.waitForLoadState('load');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${path}: overflow horizontal de ${overflow}px`);
    await context.close();
  }
});
