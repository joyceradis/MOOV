import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const PAGES = ['index.html', 'pages/motorista.html', 'pages/enfermagem.html', 'pages/destino.html', 'pages/regulacao.html'];
const notice = html => html.match(/<p class="demo-notice" role="note">([\s\S]*?)<\/p>/);

test('dashboard carrega os módulos ativos e exibe o aviso de dados simulados', () => {
  const index = read('index.html');
  for (const src of ['vendor/leaflet-1.9.4/leaflet.js', 'js/data.js', 'js/metrics.js', 'js/store.js', 'js/app.js']) {
    assert.ok(index.includes(`src="./${src}"`), src);
  }
  const n = notice(index);
  assert.ok(n, 'index.html deve conter <p class="demo-notice" role="note">');
  assert.match(n[1], /Dados simulados/);
  assert.match(n[1], /não representa ambulâncias, pacientes ou eventos em tempo real/);
});

test('páginas da ponta declaram simulação e armazenamento apenas local', () => {
  for (const file of ['motorista', 'enfermagem', 'destino', 'regulacao']) {
    const html = read(`pages/${file}.html`);
    const n = notice(html);
    assert.ok(n, `${file}: aviso .demo-notice`);
    assert.match(n[1], /Simulação com dados fictícios/, file);
    assert.match(n[1], /apenas neste navegador; nenhum dado é enviado a servidor/, file);
    assert.match(html, new RegExp(`data-profile="${file}"`), file);
    assert.doesNotMatch(html, /\b(CPF|CNS|CID|diagn[oó]stico)\b[^<]*<\/label>/i, `${file}: campo de dado de paciente`);
  }
});

test('HTML: sem script inline, sem atributo style, sem escape literal e com CSP restritiva', () => {
  for (const file of PAGES) {
    const html = read(file);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${file}: script inline`);
    assert.doesNotMatch(html, /\sstyle="/, `${file}: atributo style`);
    assert.doesNotMatch(html, /\son[a-z]+="/, `${file}: handler inline`);
    assert.doesNotMatch(html, /\\n/, `${file}: \\n literal`);
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
    for (const directive of ["script-src 'self'", "connect-src 'none'", "form-action 'none'", "object-src 'none'", "base-uri 'none'"]) {
      assert.ok(csp.includes(directive), `${file}: CSP sem ${directive}`);
    }
    assert.doesNotMatch(html, /https?:\/\/(unpkg|cdnjs|fonts\.googleapis)/, `${file}: dependência de CDN`);
  }
});

test('links e recursos locais do HTML existem', () => {
  for (const file of PAGES) {
    const html = read(file);
    for (const [, ref] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^(https?:|#|data:|mailto:)/.test(ref)) continue;
      const normalized = new URL(ref.split(/[?#]/)[0], new URL(file, root));
      assert.ok(existsSync(normalized), `${file} → ${ref}`);
    }
  }
});

test('Leaflet versionado é idêntico ao pacote oficial 1.9.4', () => {
  const sha = path => createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex');
  for (const file of ['leaflet.js', 'leaflet.css']) {
    assert.equal(sha(`vendor/leaflet-1.9.4/${file}`), sha(`node_modules/leaflet/dist/${file}`), file);
  }
  assert.ok(existsSync(new URL('vendor/leaflet-1.9.4/LICENSE', root)));
});

test('módulos históricos não referenciados foram removidos e não há JS órfão', () => {
  const referenced = PAGES.map(read).join('\n');
  for (const file of readdirSync(new URL('js/', root))) {
    assert.ok(referenced.includes(`js/${file}`), `js/${file} não é carregado por nenhuma página`);
  }
});
