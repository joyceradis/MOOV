# MOOV · Governança da frota de ambulâncias

Ferramenta de apoio à **gestão** (pública ou privada) de frotas de ambulâncias contratadas — por exemplo, a frota municipal que atende UBS, pronto-atendimentos e hospitais —, com foco em **rastreabilidade jurídica e de uso de recursos**: cada solicitação/regulação tem um código, cada etapa tem um registro com horário e responsável, e a gestão enxerga tempos, retenções, km e lacunas documentais.

**Não é rastreamento de localização.** O mapa é esquemático: a posição exibida decorre da última etapa registrada (origem, trajeto, destino), não de GPS.

> **Estado atual: dois modos, ambos com dados 100% fictícios.** Publicado como site estático (GitHub Pages), é uma **demonstração**: registros ficam apenas no `localStorage` do navegador. Rodando com o servidor (`node server/main.mjs serve`), funciona **conectado**: login, banco, trilha de auditoria e links da ponta (ver abaixo). Ainda **sem deploy**, sem integração com regulação, SAMU 192 ou prontuário. Não inserir dados reais de pacientes ou profissionais.

## O que funciona hoje

**Painel da gestão (`index.html`)**
- Indicadores da **frota municipal** calculados dos registros (SAMU 192 contado à parte): tempo médio de resposta (solicitação → chegada à origem), tempo até o recebimento, retenção do veículo no destino, km por hodômetro, lastro documental — sempre com `n`.
- Tabela por código com etapa atual, alertas, retenção e lacunas; filtros por fluxo, etapa, veículo e destino.
- Cronologia da solicitação (horário, perfil, origem do registro, intervalo entre etapas) e lacunas explícitas.
- Gargalos: transições mais lentas e retenção de veículos por destino. Uso da frota por veículo.
- Exportação CSV da trilha de auditoria e do resumo por solicitação (protegida contra injeção de fórmulas).
- Relatório para impressão/PDF com aviso de dados fictícios, recorte aplicado, relógio, indicadores, tabela, gargalos e frota.
- Separação de fluxos: frota municipal contratada × SAMU 192 (identificado, fora da frota e das páginas de registro).

**Página da regulação (`pages/regulacao.html`)**
- Abre solicitação com código novo e designa veículo. Só aparece veículo municipal sem atendimento em aberto: ambulância retida no destino não fica disponível, e assim o efeito da retenção sobre a frota aparece no fluxo.

**Páginas da ponta (`pages/*.html?codigo=<código>`)**
- Motorista (chegada à origem, saída com km, chegada com km, liberação), equipe (embarque) e destino (recebimento).
- Abrem pelo código já estabelecido; exibem só dados logísticos; aceitam **apenas a próxima etapa** do fluxo e do perfil; validam km.
- O painel aberto em outra aba atualiza ao registrar.

Parâmetros de alerta (retenção, tempo sem veículo) ficam em `MOOV_DATA.config` e são **parâmetros de gestão**, não regras clínicas.

## Modo conectado ao servidor (fases 1 e 2, sem deploy)

Decisão de iniciar a fase operacional em [#4](https://github.com/joyceradis/MOOV/issues/4); arquitetura em [docs/adr/0001](docs/adr/0001-fase-operacional-backend.md).

```bash
export MOOV_DB=moov-dev.sqlite           # banco local (SQLite); nunca dados reais nesta fase
node server/main.mjs seed-demo           # carga do conjunto fictício
MOOV_NEW_PASSWORD='uma-senha-longa-123' node server/main.mjs create-user ana gestor
MOOV_NEW_PASSWORD='outra-senha-longa-456' node server/main.mjs create-user rita regulacao
node server/main.mjs serve               # painel + API em http://127.0.0.1:8787
```

O servidor entrega o painel, as páginas e a API na mesma origem. As páginas detectam o servidor (`GET /api/health`) e passam a usá-lo:

- **Painel e regulação** pedem login (sessão por perfil `admin`, `gestor`, `regulacao`, guardada só na aba). Os dados vêm de `GET /api/dashboard` e são atualizados a cada 30 s.
- **Regulação** abre a solicitação, designa o veículo e gera os **links da ponta** (motorista, equipe, destino), com botão de copiar. O painel também gera links quando o usuário é da regulação.
- **Ponta** abre pelo link (`pages/motorista.html#link=…`). O token fica no fragmento `#`, é removido da barra de endereço e nunca vai à URL do servidor.
- Cada registro entra na trilha append-only encadeada por hash (`GET /api/audit/verify`), com autoria. A exportação da trilha vem do servidor e fica no log de acesso.

Sem o servidor (GitHub Pages, `python3 -m http.server`), tudo segue como **demonstração** com dados fictícios e registro só no navegador. Testes: `tests/server.test.mjs` (API) e `tests/live.test.mjs` (Chromium contra o servidor real).

## Executar

```bash
python3 -m http.server 8080   # http://localhost:8080
```

Sem build. Leaflet 1.9.4 é versionado em `vendor/`. Vêm da internet apenas os tiles do mapa (OpenStreetMap, sem chave de API) e os **trajetos pelas ruas** entre as unidades (roteador OSRM, `js/routes.js`): o pedido leva só as coordenadas da origem e do destino, nunca código, veículo ou dado de paciente, e cada trajeto fica guardado no navegador. Sem rede, o painel funciona sem o fundo do mapa e sem linhas de rota (nunca desenha reta entre as unidades).

## Testes

```bash
npm ci
npx playwright install chromium   # uma vez
npm run check && npm test
```

- `tests/metrics.test.mjs` — cálculos, com valores conferidos à mão sobre o conjunto fictício.
- `tests/store.test.mjs` — validações do registro local (perfil, sequência, SAMU, km, falha de gravação, relógio).
- `tests/smoke.test.mjs` — avisos, CSP, ausência de script inline/CDN, integridade do Leaflet versionado, links.
- `tests/browser.test.mjs` — Chromium real: painel, filtros, fluxo ponta → painel, XSS, exportação, modo sem mapa, teclado, layout móvel. Toda requisição externa é bloqueada e verificada.

A CI (`.github/workflows/static-audit.yml`) roda os três em cada PR. CI verde não substitui homologação com usuários reais.

## Estrutura

```text
index.html               painel da gestão
pages/                   regulação e páginas da ponta (motorista, enfermagem, destino)
js/data.js               conjunto fictício (unidades, frota, solicitações, parâmetros)
js/metrics.js            cálculos puros (tempos, retenção, lastro, frota, CSV)
js/store.js              registro local da demonstração + relógio da demonstração
js/app.js                painel
js/registro.js           páginas da ponta
js/regulacao.js          página da regulação
css/styles.css           estilos
vendor/leaflet-1.9.4/    Leaflet (BSD-2-Clause)
docs/arquitetura.md      arquitetura e limites
ROADMAP.md / SECURITY.md
```

## Licença

Código sob [GPL-3.0](LICENSE). Nomes de instituições no conjunto fictício não indicam vínculo, homologação ou autorização.
