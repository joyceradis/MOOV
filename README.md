# MOOV · Painel demonstrativo de transições assistenciais

Protótipo **estático e demonstrativo** de visualização do fluxo de transporte entre serviços de saúde da Grande Vitória. Não é sistema operacional de ambulâncias, regulação ou prontuário.

> **Dados integralmente ilustrativos.** Veículos, trajetos, horários, ETAs, gargalos e microeventos exibidos no painel são exemplos; não há API operacional, rastreamento de frota, autenticação, transmissão de registros ou integração com PMV/SAMU 192. **Não inserir dados reais de pacientes ou profissionais.**

## O que pode ser demonstrado

- Mapa interativo com unidades, veículos SVG e rotas exemplificativas (Leaflet + OpenStreetMap/CARTO).
- Filtros por tipo de fluxo (municipal e SAMU) e por status, seleção de transferências e linha do tempo.
- Contagem de transferências e eventos concluídos **do conjunto de demonstração**.
- Microformulários de motorista, equipe assistencial e destino: **simulam confirmação local**, não enviam informações.
- Separação conceitual: frota municipal e SAMU aparecem de forma distinta, sem insinuar governança integrada.

**Limitações dos indicadores:** não existe base de eventos de produção nem estimador de tempo de resposta; métricas não observadas não devem ser apresentadas como medidas reais.

## Executar

Abra `index.html` em navegador conectado à internet. É necessário acessar CDN e tiles do mapa. O conteúdo principal usa HTML/CSS/JavaScript, sem backend nem build. Para simular um servidor estático:

```bash
python3 -m http.server 8080
# http://localhost:8080
```

## Estrutura observada

```text
index.html           painel demonstrativo (js/data.js + js/app.js)
css/styles.css       visual
js/data.js           eventos, unidades e gargalos fictícios
js/app.js            entrada do painel e controle do mapa
js/dashboard.js      implementação histórica — não incluída em index.html
js/map.js            implementação histórica — verificar antes de reaproveitar
js/ui.js             helpers da implementação histórica
js/forms.js          helper legado — formulários atuais possuem script inline
pages/
  motorista.html
  enfermagem.html
  destino.html
docs/
  arquitetura.md
ROADMAP.md           etapas e gates de decisão
SECURITY.md          segurança e reporte
.github/workflows/   verificações automáticas propostas
```

Não remover módulos históricos sem inventário de chamadas/referências. Eles não são carregados pela entrada principal atualmente.

## Validação

Ao propor alterações, rodar as verificações da CI (sintaxe JavaScript, testes de dados sintéticos e referências dos arquivos HTML). Complementar com inspeção visual manual em desktop e celular; testes estáticos não demonstram funcionamento de CDN, mapa e acessibilidade em navegador.

## Próximos passos

Consultar [ROADMAP.md](ROADMAP.md). **Primeiro consolidar a demonstração transparente**; só avaliar eventual produto operacional depois de decisão explícita, desenho institucional, segurança e LGPD. Ver [issue #4](https://github.com/joyceradis/MOOV/issues/4).

## Licença

Código sob [GPL-3.0](LICENSE). Nomes, marcas e símbolos de instituições reais não significam vínculo, homologação nem autorização operacional.
