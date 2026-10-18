# Segurança · MOOV

## Estado atual

O MOOV é **um protótipo estático com dados fictícios**. Não possui identificação de usuários, controle de acesso por perfil, tokens, servidor, banco ou logs auditáveis. Registros feitos nas páginas da ponta ficam apenas no `localStorage` do próprio navegador, sem autoria verificada.

Nenhuma versão é homologada para uso operacional. Não use com dados de pacientes, documentos assistenciais, identificadores pessoais, localizações reais ou informações sigilosas.

## Controles presentes

- Content-Security-Policy por `<meta>` em todas as páginas: `script-src 'self'`, `connect-src 'none'`, `form-action 'none'`, `object-src 'none'`, `base-uri 'none'`; sem script inline.
- Leaflet 1.9.4 versionado em `vendor/` (teste garante igualdade com o pacote oficial); sem CDN de scripts nem fontes remotas.
- Único terceiro contatado: tiles de mapa CARTO/OpenStreetMap (imagens, com `referrer` desativado). Revelam ao provedor o IP e a região visualizada.
- Conteúdo dinâmico escapado; teste de navegador cobre tentativa de injeção de HTML.
- Exportação CSV neutraliza fórmulas de planilha.
- CI com Actions fixadas por SHA e `permissions: contents: read`.

## Reportar vulnerabilidades

Não publique em issues públicas dados pessoais, credenciais ou passos exploráveis sensíveis. Use **Report a vulnerability** na aba Security do repositório, se habilitado; caso contrário, peça à mantenedora um canal privado. Não há prazo de resposta garantido nem programa de recompensas.

## Trabalho futuro

Autenticação, autorização, tokens efêmeros por código, trilha imutável, retenção, resposta a incidentes e adequação à LGPD são requisitos de uma versão operacional, **não controles existentes**. Ver [docs/arquitetura.md](docs/arquitetura.md) e [ROADMAP.md](ROADMAP.md).
