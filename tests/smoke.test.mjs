import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Script, runInNewContext } from 'node:vm';
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
  assert.match(index, /Dados simulados|dados simulados|demonstração/i);
  assert.doesNotMatch(read('js/app.js'), /kpiAvg\.textContent\s*=\s*["']12 min["']/);
});

test('formulários atuais não prometem registro real', () => {
  for (const file of ['motorista', 'enfermagem', 'destino']) {
    const html = read('pages/' + file + '.html');
    assert.match(html, /Dados fictícios|dados fictícios|simula/i, file);
    assert.match(html, /Nenhum dado (é )?enviado|não são enviados|nenhuma informação é enviada/i, file);
    assert.doesNotMatch(html, /Microevento registrado\./i, file);
    assert.match(html, /event\.preventDefault\(\)/, file);
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
