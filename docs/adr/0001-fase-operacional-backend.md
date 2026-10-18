# ADR 0001 · Início da fase operacional: backend do MOOV

- **Status:** aceito (fase 1 implementada, **sem deploy e sem dados reais**)
- **Data:** 18/10/2026
- **Decisão de produto:** fundadora, issue [#4](https://github.com/joyceradis/MOOV/issues/4), opção B (produto operacional)

## Contexto
O protótipo estático guarda registros só no navegador: não há autoria, integridade, controle de acesso nem visão compartilhada entre gestão, regulação e ponta. Um uso operacional exige trilha confiável, para fins jurídicos e de prestação de contas do contrato.

## Decisão
Backend próprio em `server/`:

| Tema | Escolha | Motivo |
|---|---|---|
| Runtime | Node 22, **sem dependências de runtime** (`node:http`, `node:crypto`, `node:sqlite`) | Superfície de ataque e cadeia de suprimentos mínimas; roda em qualquer hospedagem |
| Banco (dev/homologação) | SQLite embutido | Zero custo, teste isolado em memória |
| Banco (produção) | **PostgreSQL gerenciado**, a escolher com a hospedagem | SQL simples para facilitar a migração; decisão de custo da fundadora |
| Regras de negócio | Reaproveita `js/metrics.js` | Servidor e painel calculam igual |
| Trilha | Tabela `events` **append-only** (triggers bloqueiam UPDATE/DELETE), única por etapa, **encadeada por SHA-256** (`prev_hash` → `hash`) | Adulteração direta no banco é detectável (`GET /api/audit/verify`) |
| Solicitações | Imutáveis; veículo vem do evento `designada` | Histórico não é reescrito |
| Usuários | Perfis `admin`, `gestor`, `regulacao`; senha com scrypt (mínimo 12 caracteres); sessão opaca de 8 h (só o hash fica no banco) | Sem senha padrão; usuários criados pela linha de comando |
| Ponta | **Link temporário por código + perfil** (motorista, enfermagem, destino): token de 256 bits, expira (12 h por padrão), revogável, enviado no cabeçalho `Authorization: Link` | Atende a "página com o código já estabelecido" sem conta para a ponta |
| HTTP | Só JSON; corpo ≤ 16 KB; `POST` exige `application/json`; CSP `default-src 'none'`, `frame-ancestors 'none'`, `no-store`, `nosniff`; limite de tentativas de login por IP; erro interno genérico | Defesa em profundidade |
| Auditoria de acesso | `access_log` append-only: logins (ok/falha), etapas, emissão/revogação de links, exportações | Rastreabilidade de quem fez o quê |

### API (fase 1)
| Método e rota | Perfil | Função |
|---|---|---|
| `POST /api/session`, `DELETE /api/session`, `GET /api/me` | qualquer | Sessão |
| `GET /api/units`, `/api/fleet`, `/api/requests`, `/api/requests/:code` | admin, gestor, regulação | Leitura e indicadores |
| `POST /api/requests` | regulação | Abre solicitação (`SOL-aammdd-Rnnnn`) e grava `solicitada` |
| `POST /api/requests/:code/designate` | regulação | Designa veículo municipal disponível |
| `POST /api/requests/:code/links`, `.../links/revoke` | regulação | Emite e revoga links da ponta |
| `GET /api/ponta`, `POST /api/ponta/events` | link | Visão logística e registro da próxima etapa do perfil |
| `GET /api/audit/verify`, `GET /api/export/audit.csv` | admin, gestor | Integridade da trilha e exportação |

## Fora desta fase (exige decisão da fundadora)
1. **Hospedagem e PostgreSQL gerenciado**: custo e contrato.
2. **Deploy e domínio próprio**, com HTTPS, HSTS e cabeçalhos no proxy.
3. **Dados reais**: base legal, RIPD/DPIA, encarregado de dados, contrato com o ente público, política de retenção.
4. **Responsáveis**: gestão de usuários, resposta a incidentes, backup e restauração testados.

## Próximas fases técnicas
- **Fase 2:** painel e páginas da ponta consumindo a API (modo demonstração estático mantido); tela de login.
- **Fase 3:** adaptador PostgreSQL, backup/restauração, observabilidade, rotação de logs e retenção.
- **Fase 4:** PWA da ponta com fila offline e reenvio idempotente.

## Consequências
- A trilha é confiável contra alteração pela aplicação e detectável contra alteração direta, mas **não** contra quem reescreve a cadeia inteira com acesso ao banco. Para isso: ancoragem periódica do `head` da cadeia fora do banco (fase 3).
- O token do link é um segredo ao portador. Mitigações: expiração curta, revogação, escopo de um código e um perfil, nunca na URL do servidor (o front lerá do fragmento `#`, fase 2).
- `node:sqlite` é experimental no Node 22. Aceitável para dev e homologação; produção usará PostgreSQL.
- Com o conjunto fictício (maio/2026) e o relógio real, as retenções em aberto aparecem enormes. É esperado em desenvolvimento.
