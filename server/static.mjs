// Arquivos do painel e das páginas da ponta, servidos na mesma origem da API.
// Só o que o navegador precisa: index.html, css/, js/, pages/, vendor/. Nada de server/, banco ou docs.
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const ALLOWED_DIRS = ['css', 'js', 'pages', 'vendor'];

// Mesma política das páginas, com connect-src restrito à própria origem (a API).
export const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; " +
  "img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; form-action 'none'; " +
  "base-uri 'none'; object-src 'none'; frame-ancestors 'none'";

const HEADERS = {
  'cache-control': 'no-cache',
  'content-security-policy': PAGE_CSP,
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY'
};

// Caminho da URL → arquivo permitido dentro de root, ou null.
export function resolveStatic(root, pathname) {
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (path.includes('\0')) return null;
  const relative = normalize(path === '/' ? '/index.html' : path).replace(/^[/\\]+/, '');
  if (relative.split(/[/\\]/).some(part => part === '..' || part.startsWith('.'))) return null;
  const [first] = relative.split(/[/\\]/);
  if (relative !== 'index.html' && !ALLOWED_DIRS.includes(first)) return null;
  if (!TYPES[extname(relative)]) return null;
  const file = join(root, relative);
  return file.startsWith(root.endsWith(sep) ? root : root + sep) ? file : null;
}

export async function serveStatic(root, req, res, pathname) {
  const file = resolveStatic(root, pathname);
  if (file) {
    try {
      if ((await stat(file)).isFile()) {
        const body = await readFile(file);
        res.writeHead(200, { ...HEADERS, 'content-type': TYPES[extname(file)] });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
    } catch {
      // Arquivo inexistente: cai no 404 abaixo.
    }
  }
  res.writeHead(404, { ...HEADERS, 'content-type': 'text/plain; charset=utf-8' });
  res.end('Não encontrado.');
}
