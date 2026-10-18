// Camada HTTP do MOOV operacional: sem dependências, só JSON, cabeçalhos de segurança em toda resposta.
import { DomainError } from './service.mjs';

const BODY_LIMIT = 16 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY'
};

function send(res, status, body, headers = {}) {
  const isText = typeof body === 'string';
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    ...headers
  });
  res.end(isText ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      reject(new DomainError(415, 'Envie application/json.'));
      return;
    }
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        // Responde 413 e descarta o restante do corpo, sem guardar em memória.
        if (!tooLarge) reject(new DomainError(413, 'Requisição grande demais.'));
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('objeto esperado');
        resolve(value);
      } catch {
        reject(new DomainError(400, 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

// Authorization: "Bearer <sessão>" (usuários) ou "Link <token>" (ponta). Tokens nunca vão na URL.
function credential(req, scheme) {
  const match = /^(\w+)\s+([A-Za-z0-9_-]{20,200})$/.exec(req.headers.authorization || '');
  return match && match[1] === scheme ? match[2] : null;
}

export function createApp(service, { trustProxy = false } = {}) {
  const failures = new Map();

  const clientIp = req => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';

  function limited(ip) {
    const now = Date.now();
    const recent = (failures.get(ip) || []).filter(t => now - t < LOGIN_WINDOW_MS);
    failures.set(ip, recent);
    return recent.length >= LOGIN_MAX_FAILURES;
  }

  function requireUser(req, roles) {
    const user = service.authenticate(credential(req, 'Bearer'));
    if (!user) throw new DomainError(401, 'Sessão inválida ou expirada.');
    if (roles && !roles.includes(user.role)) throw new DomainError(403, 'Perfil sem permissão para esta ação.');
    return user;
  }

  const READ = ['admin', 'gestor', 'regulacao'];
  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true })],

    ['POST', /^\/api\/session$/, async req => {
      const ip = clientIp(req);
      if (limited(ip)) throw new DomainError(429, 'Muitas tentativas. Aguarde 15 minutos.');
      const body = await readJson(req);
      try {
        return service.login(body.username, body.password);
      } catch (error) {
        failures.get(ip).push(Date.now());
        throw error;
      }
    }],
    ['DELETE', /^\/api\/session$/, req => {
      requireUser(req);
      service.logout(credential(req, 'Bearer'));
      return { ok: true };
    }],
    ['GET', /^\/api\/me$/, req => {
      const { username, role } = requireUser(req);
      return { username, role };
    }],

    ['GET', /^\/api\/units$/, req => (requireUser(req, READ), service.units())],
    ['GET', /^\/api\/fleet$/, req => (requireUser(req, READ), service.fleetSummary())],
    ['GET', /^\/api\/requests$/, req => (requireUser(req, READ), service.summaries().map(x => x.summary))],
    ['GET', /^\/api\/requests\/([A-Z0-9-]{5,40})$/, (req, [code]) => (requireUser(req, READ), service.getRequest(code))],

    ['POST', /^\/api\/requests$/, async req => {
      const user = requireUser(req, ['regulacao']);
      return { code: service.createRequest(user, await readJson(req)) };
    }],
    ['POST', /^\/api\/requests\/([A-Z0-9-]{5,40})\/designate$/, async (req, [code]) => {
      const user = requireUser(req, ['regulacao']);
      return service.designate(user, code, (await readJson(req)).vehicleId);
    }],
    ['POST', /^\/api\/requests\/([A-Z0-9-]{5,40})\/links$/, async (req, [code]) => {
      const user = requireUser(req, ['regulacao']);
      return service.issueLink(user, code, (await readJson(req)).profile);
    }],
    ['POST', /^\/api\/requests\/([A-Z0-9-]{5,40})\/links\/revoke$/, (req, [code]) => {
      const user = requireUser(req, ['regulacao']);
      return { revoked: service.revokeLinks(user, code) };
    }],

    ['GET', /^\/api\/audit\/verify$/, req => (requireUser(req, ['admin', 'gestor']), service.verifyChain())],
    ['GET', /^\/api\/export\/audit\.csv$/, req => {
      const user = requireUser(req, ['admin', 'gestor']);
      service.log(user.actor, 'exportacao.trilha');
      const lines = [['codigo', 'regulacao', 'fluxo', 'veiculo', 'etapa', 'horario', 'perfil', 'autor', 'km', 'observacao']];
      for (const { request } of service.summaries()) {
        for (const e of request.events) {
          lines.push([request.code, request.regulationCode, request.flowType, request.vehicleId || '', service.stageLabel(e.key),
            e.at, e.profile, e.actor, Number.isFinite(e.km) ? e.km : '', e.note || '']);
        }
      }
      return { csv: '﻿' + service.toCsv(lines) };
    }],

    ['GET', /^\/api\/ponta$/, req => service.frontView(credential(req, 'Link'))],
    ['POST', /^\/api\/ponta\/events$/, async req => {
      const token = credential(req, 'Link');
      service.frontView(token); // valida o link antes de ler o corpo
      return service.frontRecord(token, await readJson(req));
    }]
  ];

  return async function handler(req, res) {
    const path = new URL(req.url, 'http://localhost').pathname;
    const route = routes.find(([method, pattern]) => method === req.method && pattern.test(path));
    if (!route) {
      const known = routes.some(([, pattern]) => pattern.test(path));
      send(res, known ? 405 : 404, { error: known ? 'Método não permitido.' : 'Não encontrado.' });
      return;
    }
    try {
      const result = await route[2](req, route[1].exec(path).slice(1));
      if (result && typeof result.csv === 'string') {
        send(res, 200, result.csv, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="moov-trilha-auditoria.csv"'
        });
      } else {
        send(res, 200, result);
      }
    } catch (error) {
      if (error instanceof DomainError) {
        send(res, error.status, { error: error.message }, error.status === 413 ? { connection: 'close' } : {});
      } else {
        // Detalhe interno só no log do servidor; resposta genérica.
        console.error(error);
        send(res, 500, { error: 'Erro interno.' });
      }
    }
  };
}
