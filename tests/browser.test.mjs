// Testes de comportamento em navegador real (Chromium via Playwright).
// Toda requisição externa é interceptada: Leaflet é servido a partir de node_modules
// (o navegador ainda valida o SRI declarado) e tiles/CDNs desconhecidos são bloqueados.
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
  '.json': 'application/json',
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

const LEAFLET = {
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js': ['node_modules/leaflet/dist/leaflet.js', 'text/javascript'],
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css': ['node_modules/leaflet/dist/leaflet.css', 'text/css']
};

// Abre uma página registrando toda requisição que sai do servidor local.
async function openPage(path, { leaflet = true, viewport } = {}) {
  const context = await browser.newContext({ viewport: viewport || { width: 1366, height: 900 } });
  const page = await context.newPage();
  const external = [];
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.route(url => !url.href.startsWith(baseUrl), async route => {
    const url = route.request().url();
    external.push(url);
    const local = leaflet && LEAFLET[url];
    if (local) {
      await route.fulfill({
        body: await readFile(join(root, local[0])),
        contentType: local[1],
        headers: { 'access-control-allow-origin': '*' }
      });
    } else {
      await route.abort();
    }
  });

  await page.goto(baseUrl + path);
  return { page, context, external, errors };
}

test('dashboard: mapa inicializa com Leaflet íntegro (SRI) e sem erros de script', async () => {
  const { page, context, errors } = await openPage('/index.html');
  await page.waitForSelector('#map.leaflet-container');
  await page.waitForSelector('.vehicle-wrap');
  assert.equal(await page.locator('.vehicle-wrap').count(), 3);
  // leaflet.css só é aplicado se o SRI conferir; sem ele os panes ficam estáticos e os marcadores saem do mapa.
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.leaflet-pane')).position), 'absolute');
  const mapBox = await page.locator('#map').boundingBox();
  for (const box of await Promise.all((await page.locator('.leaflet-marker-icon').all()).map(m => m.boundingBox()))) {
    assert.ok(box.y >= mapBox.y && box.y + box.height <= mapBox.y + mapBox.height, 'marcador fora da área do mapa');
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('dashboard: KPI de tempo médio permanece indisponível e demais KPIs seguem os filtros', async () => {
  const { page, context } = await openPage('/index.html');
  await page.waitForSelector('.vehicle-wrap');

  const data = await page.evaluate(() => MOOV_DATA.transfers);
  const expected = list => {
    const events = list.flatMap(t => t.microevents);
    const done = events.filter(e => e.state === 'done').length;
    return {
      total: String(list.length),
      alerts: String(list.filter(t => t.alert).length),
      complete: `${events.length ? Math.round((done / events.length) * 100) : 0}%`
    };
  };

  const cases = [
    ['all', 'all'],
    ['municipal', 'all'],
    ['samu', 'all'],
    ['all', 'aguardando'],
    ['samu', 'aguardando'] // combinação sem resultados
  ];

  for (const [flow, status] of cases) {
    await page.selectOption('#flowType', flow);
    await page.selectOption('#statusFilter', status);
    const list = data.filter(t => (flow === 'all' || t.flowType === flow) && (status === 'all' || t.status === status));
    const want = expected(list);
    const label = `${flow}/${status}`;
    assert.equal(await page.textContent('#kpiAvg'), '—', label);
    assert.equal(await page.textContent('#kpiTotal'), want.total, label);
    assert.equal(await page.textContent('#kpiAlerts'), want.alerts, label);
    assert.equal(await page.textContent('#kpiComplete'), want.complete, label);
    assert.equal(await page.locator('.vehicle-wrap').count(), list.length, label);
  }

  // Sem resultados, a seleção e a linha do tempo são limpas.
  assert.equal(await page.textContent('#timelineCode'), 'Sem seleção');
  await page.click('#resetFilters');
  assert.equal(await page.textContent('#kpiTotal'), String(data.length));
  await context.close();
});

test('dashboard: seleção pelo mapa atualiza cartão e linha do tempo', async () => {
  const { page, context } = await openPage('/index.html');
  await page.waitForSelector('.vehicle-wrap');
  const target = await page.evaluate(() => MOOV_DATA.transfers[1]);
  await page.locator('.leaflet-marker-icon', { has: page.locator('.vehicle-label', { hasText: target.vehicleLabel }) }).click();
  await assertText(page, '#selectedTransfer h3', target.id);
  await assertText(page, '#timelineCode', target.requestCode);
  assert.equal(await page.locator('#timeline .timeline-step').count(), target.microevents.length);
  await context.close();
});

test('dashboard: sem Leaflet, exibe aviso e mantém KPIs, linha do tempo e gargalos', async () => {
  const { page, context, errors } = await openPage('/index.html', { leaflet: false });
  await page.waitForSelector('.map-error-banner');
  await assertText(page, '#kpiTotal', '3');
  assert.equal(await page.textContent('#kpiAvg'), '—');
  assert.ok((await page.locator('#bottleneckList .bottleneck-item').count()) > 0);
  assert.ok((await page.locator('#timeline .timeline-step').count()) > 0);
  await page.selectOption('#flowType', 'samu');
  assert.equal(await page.textContent('#kpiTotal'), '1');
  assert.deepEqual(errors, []);
  await context.close();
});

const FORMS = {
  motorista: async page => {
    await page.selectOption('form select >> nth=0', { index: 1 });
    await page.fill('form input[inputmode="numeric"]', '45021');
    await page.selectOption('form select >> nth=1', { index: 1 });
    await page.check('form input[type="checkbox"] >> nth=0');
    return page.locator('form input[inputmode="numeric"]');
  },
  enfermagem: async page => {
    await page.selectOption('form select >> nth=0', { index: 1 });
    await page.selectOption('form select >> nth=1', { index: 1 });
    await page.check('form input[type="checkbox"] >> nth=0');
    await page.check('form input[type="checkbox"] >> nth=1');
    return page.locator('form input[type="checkbox"] >> nth=1');
  },
  destino: async page => {
    await page.selectOption('form select >> nth=0', { index: 1 });
    await page.check('form input[type="checkbox"] >> nth=0');
    return page.locator('form input:not([type])');
  }
};

for (const [name, fill] of Object.entries(FORMS)) {
  for (const mode of ['clique', 'Enter']) {
    test(`formulário ${name}: envio por ${mode} é simulado, sem navegação, rede ou persistência`, async () => {
      const { page, context, external, errors } = await openPage(`/pages/${name}.html`);
      const url = page.url();
      const notice = page.locator('.demo-notice');
      assert.ok(await notice.isVisible());
      assert.match(await notice.textContent(), /Nenhum dado é enviado ou armazenado/);
      assert.equal(await page.locator('#success').isVisible(), false);

      const field = await fill(page);
      let navigated = false;
      page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) navigated = true;
      });

      if (mode === 'Enter') {
        await field.focus();
        await page.keyboard.press('Enter');
      } else {
        await page.click('form button[type="submit"]');
      }

      await page.waitForSelector('#success.show');
      assert.match(await page.textContent('#success'), /Nenhum dado é enviado ou armazenado/);
      // Dá tempo para requisições adiadas (setTimeout/sendBeacon) aparecerem antes de checar a rede.
      await page.waitForTimeout(300);
      assert.equal(navigated, false);
      assert.equal(page.url(), url);
      assert.deepEqual(external, []);
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      assert.deepEqual(errors, []);
      await context.close();
    });
  }
}

test('formulário inválido não exibe confirmação', async () => {
  const { page, context } = await openPage('/pages/motorista.html');
  await page.click('form button[type="submit"]');
  assert.equal(await page.locator('#success.show').count(), 0);
  await context.close();
});

test('layout móvel: sem rolagem horizontal no painel e nos formulários', async () => {
  for (const path of ['/index.html', '/pages/motorista.html', '/pages/enfermagem.html', '/pages/destino.html']) {
    const { page, context } = await openPage(path, { viewport: { width: 375, height: 812 } });
    await page.waitForLoadState('load');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${path}: overflow horizontal de ${overflow}px`);
    await context.close();
  }
});

async function assertText(page, selector, expected) {
  await page.waitForFunction(
    ([sel, text]) => document.querySelector(sel)?.textContent.trim() === text,
    [selector, expected],
    { timeout: 5000 }
  );
}
