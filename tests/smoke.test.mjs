import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Script, runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');

test('dataset demonstrativo possui entidades e microeventos consistentes', () => {
  const source = read('js/data.js');
  new Script(source);
  const data = runInNewContext(source + '\nMOOV_DATA;');
  assert.ok(data.units.length >= 2);
  assert.ok(data.transfers.length >= 1);
  const ids = new Set(data.transfers.map(x => x.id));
  assert.equal(ids.size, data.transfers.length);
  for (const transfer of data.transfers) {
    assert.ok(['municipal', 'samu'].includes(transfer.flowType));
    assert.ok(Array.isArray(transfer.route) && transfer.route.length >= 2);
    assert.ok(Array.isArray(transfer.microevents) && transfer.microevents.length > 0);
  }
});

test('dashboard usa a entrada ativa e deixa explícita a simulação', () => {
  const index = read('index.html');
  assert.match(index, /src="\.\/js\/data\.js"/);
  assert.match(index, /src="\.\/js\/app\.js"/);
  // O aviso precisa estar no elemento dedicado, não em qualquer outro texto da página.
  const notice = index.match(/<p class="demo-notice" role="note">([\s\S]*?)<\/p>/);
  assert.ok(notice, 'index.html deve conter <p class="demo-notice" role="note">');
  assert.match(notice[1], /Dados simulados/);
  assert.match(notice[1], /não representa ambulâncias, pacientes ou eventos em tempo real/);
});

test('HTML não contém sequências de escape literais', () => {
  for (const file of ['index.html', 'pages/motorista.html', 'pages/enfermagem.html', 'pages/destino.html']) {
    assert.doesNotMatch(read(file), /\\n/, file);
  }
});

test('formulários atuais não prometem registro real', () => {
  for (const file of ['motorista', 'enfermagem', 'destino']) {
    const html = read('pages/' + file + '.html');
    const notice = html.match(/<p class="demo-notice" role="note">([\s\S]*?)<\/p>/);
    assert.ok(notice, file + ' deve conter o aviso .demo-notice');
    assert.match(notice[1], /Simulação com dados fictícios/, file);
    assert.match(notice[1], /Nenhum dado é enviado ou armazenado/, file);
    assert.doesNotMatch(html, /Microevento registrado\./i, file);
    // O comportamento do envio (preventDefault, sem rede) é verificado em tests/browser.test.mjs.
  }
});

test('links locais principais do HTML existem', () => {
  for (const file of ['index.html', 'pages/motorista.html', 'pages/enfermagem.html', 'pages/destino.html']) {
    const html = read(file);
    for (const [, ref] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^(https?:|#|data:|mailto:)/.test(ref)) continue;
      const normalized = new URL(ref.split(/[?#]/)[0], new URL(file, root));
      assert.ok(existsSync(normalized), file + ' → ' + ref);
    }
  }
});

test('hashes SRI do Leaflet correspondem aos arquivos oficiais da versão 1.9.4', () => {
  const sri = file => 'sha256-' + createHash('sha256').update(readFileSync(new URL('node_modules/leaflet/dist/' + file, root))).digest('base64');
  const sources = read('index.html') + read('js/app.js');
  for (const file of ['leaflet.css', 'leaflet.js']) {
    assert.ok(sources.includes(sri(file)), file + ' deve usar integrity ' + sri(file));
  }
  assert.doesNotMatch(sources, /sha256-p4NxAoJBhIINfQYh5q47/, 'hash corrompido anterior do leaflet.css');
});
