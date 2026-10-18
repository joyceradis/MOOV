# Arquitetura MOOV

## Objeto

Apoio à governança de frotas de ambulâncias contratadas: rastreabilidade de **solicitações** (código), **etapas** (horário, perfil, km) e **uso do recurso** (tempo em serviço, retenção no destino, km). O objeto determina o método: o MOOV mede registros de etapas, não posição do veículo nem condição clínica.

## Implementado (protótipo estático)

| Camada | Arquivo | Papel |
| --- | --- | --- |
| Dados | `js/data.js` | Conjunto fictício: unidades, frota, solicitações com eventos, `referenceTime`, `config` |
| Cálculo | `js/metrics.js` | Funções puras: etapas, tempos, retenção, lastro, durações, frota, CSV |
| Registro | `js/store.js` | `localStorage` do navegador; valida sequência, perfil e km; relógio da demonstração |
| Gestão | `index.html` + `js/app.js` | Indicadores, tabela por código, cronologia, gargalos, frota, mapa esquemático, exportação |
| Ponta | `pages/*.html` + `js/registro.js` | Página aberta por `?codigo=`; registra só a próxima etapa permitida ao perfil |

### Etapas

`solicitada → designada → chegada_origem → embarque → saida_origem (km) → chegada_destino (km) → recebido → liberado`

| Perfil | Etapas que registra |
| --- | --- |
| Origem/Regulação | solicitada, designada (vêm do conjunto; sem página nesta versão) |
| Motorista | chegada_origem, saida_origem, chegada_destino, liberado |
| Equipe | embarque |
| Destino | recebido |

### Definições

- **Tempo de resposta:** solicitada → chegada_origem.
- **Tempo até recebimento:** solicitada → recebido (somente concluídas entram na média).
- **Retenção no destino:** chegada_destino → liberado; em aberto, até o relógio da demonstração.
- **Lastro documental:** cada etapa alcançada exige as anteriores registradas e km em saída/chegada. Lacunas são exibidas, nunca inferidas.
- **Alertas:** retenção ≥ `config.retentionAlertMin`; sem veículo ≥ `config.unassignedAlertMin`. Parâmetros de gestão do contrato.
- **SAMU 192:** exibido e identificado, fora dos indicadores de frota municipal e sem registro pelas páginas da ponta. Etapas do SAMU não registradas no MOOV não geram lacuna, pendência, retenção nem alerta.

### Limites metodológicos

- Minutos e km **não** são convertidos em valores financeiros: depende das regras de cada contrato.
- Registros locais não têm autoria verificada, integridade criptográfica nem sincronização.
- Posição no mapa é esquemática.

## Segurança no protótipo

- CSP restritiva por `<meta>` (`script-src 'self'`, `connect-src 'none'`, `form-action 'none'`), sem script inline nem CDN.
- Saída sempre escapada (`escapeHtml`/`textContent`); observações limitadas e exibidas como texto.
- Páginas da ponta não exibem nem pedem nome, CPF, CNS, diagnóstico, CID ou prontuário.

## Necessário para uso operacional (não implementado)

Servidor com API e banco; autenticação e autorização por perfil; links da ponta com token efêmero vinculado ao código; trilha de eventos imutável (append-only, assinada); sincronização offline (PWA) com resolução de conflitos; retenção e LGPD (base legal, minimização, DPIA); observabilidade; homologação com gestores e equipes. Decisão de produto: [issue #4](https://github.com/joyceradis/MOOV/issues/4).
