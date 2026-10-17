# Segurança · MOOV

## Estado atual

O MOOV é **apenas um protótipo estático**. Não fornece identificação de usuários, segregação por perfil, tokens temporários, controle de acesso, armazenamento de eventos, logs auditáveis ou integração com serviços públicos de saúde.

Nenhuma versão é homologada para uso clínico, assistencial ou operacional. Não use o protótipo com dados de pacientes, documentos assistenciais, identificadores pessoais, localizações reais de ambulâncias ou informações sigilosas.

## Reportar vulnerabilidades

Não publique em issues públicas dados pessoais, tokens, credenciais, capturas com informações reais nem passos exploráveis sensíveis. Use o recurso privado **Report a vulnerability** da aba Security do repositório, **se ele estiver habilitado**. Caso não exista, solicite à mantenedora um canal privado sem enviar detalhes sensíveis pela issue pública.

Não há prazo de resposta garantido nem programa de recompensas.

## Dependências e limitações

O mapa depende de bibliotecas externas (Leaflet) e tiles de terceiros (CARTO/OSM). Disponibilidade e integridade devem ser validadas antes de qualquer demonstração pública. A página não é um mecanismo de localização real.

Requisitos de autenticação, autorização, retenção, auditoria, resposta a incidentes, integração e adequação à LGPD **são trabalho futuro, não controles já existentes**. Ver [ROADMAP.md](ROADMAP.md).
