# Delivery OS Hub

Desenvolva o sistema profissional, moderno e responsivo para os cenários abaixo:

sistema PWA chamado Delivery OS.

**Dashboard**
- Receita diária
- Lucro real
- Custos
- Quilometragem
- Tempo parado
- Ranking de aplicativos
- Mapa de calor de entregas
- Histórico completo

**Mobile**
- GPS automático
- Rotas
- Navegação
- Financeiro
- Abastecimento
- Manutenção
- IA
- Scanner OCR
- Relatórios

**Web**
- Dashboard completo
- Relatórios em PDF
- Exportação para Excel
- Controle financeiro
- Agenda de manutenção
- Planejamento de metas
- Comparação entre meses

**Diferencial**

A maior parte dos aplicativos existentes controla apenas ganhos ou apenas despesas. Um sistema que una GPS automático, gestão financeira, manutenção do veículo, análise de desempenho e inteligência artificial entregaria uma visão completa da atividade do entregador, algo que hoje é raro no mercado.

Esse tipo de plataforma também pode evoluir para um modelo de assinatura (SaaS), com aplicativo para Android/iOS e painel web para acompanhar relatórios detalhados.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/6ea0ef38-a00c-43ce-8d64-e281368be399).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Stack

- **Framework:** [TanStack Start](https://tanstack.com/start) (React + SSR)
- **Build:** Vite + Nitro (preset `node-server`)
- **Backend:** Supabase (auth, banco de dados, storage)
- **PWA:** Service Worker com atualização automática (`vite-plugin-pwa`)
- **Deploy:** GitHub Actions → VM própria (Docker + Nginx Proxy Manager)

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Build de produção

```bash
npm run build
```

Gera a pasta `.output/`:
- `.output/public/` — assets estáticos (JS, CSS, imagens, manifest do PWA)
- `.output/server/index.mjs` — servidor Node (SSR + API routes)

## Integração de GPS com app nativo

O rastreador da jornada aceita pontos enviados por uma WebView Android/iOS. O app nativo pode
usar `window.postMessage` ou disparar um `CustomEvent` chamado `deliveryos:gps` com este formato:

```json
{
  "type": "deliveryos:gps",
  "payload": {
    "latitude": -23.55052,
    "longitude": -46.633308,
    "accuracy": 12,
    "timestamp": 1791244800000
  }
}
```

Também são aceitos `lat`, `lng` e uma data ISO em `at`. Coordenadas, precisão e data são
validadas antes do cálculo. Quando chega o primeiro ponto nativo válido, o GPS do navegador é
desativado para impedir captura duplicada.

Ao iniciar, finalizar ou zerar uma jornada, a aplicação envia ao host React Native uma mensagem
com o tipo `deliveryos:trip-command` e os comandos `start`, `finish` ou `reset`. Os mesmos dados
são publicados como `CustomEvent` para outros tipos de WebView.

## Precisão e estabilidade do GPS

A captura no navegador solicita alta precisão e posições novas, sem reutilizar o cache. O rastreador processa cada leitura recebida, sem descartar amostras por um intervalo fixo; a frequência efetiva depende do dispositivo e do sistema operacional.

- Valida coordenadas, precisão e horário; descarta leituras anteriores à jornada, com mais de 60 segundos ou mais de 5 segundos no futuro.
- Rejeita deslocamentos que implicariam velocidade média acima de 180 km/h.
- Filtra oscilações usando a precisão informada pelo sensor, com um mínimo de 3 metros. Mantém a última posição aceita como referência para acumular deslocamentos lentos e preservar curvas curtas quando o sinal é preciso.
- Soma distâncias sem arredondar cada amostra, evitando erro acumulado.
- Após um intervalo superior a 60 segundos entre posições aceitas, estabelece uma nova referência sem somar um trajeto desconhecido. A quilometragem desse intervalo pode ficar subestimada.
- Prioriza a captura nativa após uma leitura válida, interrompendo a captura do navegador. A troca de sensores não soma a diferença entre suas estimativas de posição.

Esses filtros se aplicam às coordenadas capturadas pelo navegador e pela ponte nativa. A integração externa que fornece contadores de quilometragem mantém seu cálculo próprio.

A precisão real depende do aparelho, das permissões e da recepção do sinal. Alta precisão pode aumentar o consumo de bateria; captura em segundo plano depende do suporte do aplicativo nativo e do sistema operacional. Ainda é necessário avaliar o resultado em percursos reais, incluindo curvas, paradas e períodos sem sinal.

### Troca automática entre integração e navegador

Se uma jornada for iniciada com integração cadastrada, mas sem leitura válida nos últimos 30 segundos, o PWA seleciona imediatamente o GPS do navegador. Durante a jornada, verifica a integração a cada 5 segundos e troca para o navegador quando a última leitura ultrapassa 30 segundos. Isso também vale para a ponte GPS nativa; leituras válidas de um aparelho parado mantêm a conexão ativa, mesmo sem deslocamento.

Quando chegam leituras externas recentes, o sistema retorna à integração e interrompe a captura do navegador. A reconexão estabelece uma nova base do contador, sem importar a quilometragem acumulada durante o fallback. Leituras com atraso de rede aguardam uma base posterior ao último ponto do navegador antes de voltar a somar distância. O dispositivo integrado permanece identificado durante a troca, evitando misturar contadores de aparelhos diferentes. Pode haver subcontagem nos intervalos sem sinal e na transição entre fontes.

As pausas suspendem a captura do navegador e a soma de distância; finalizar a jornada interrompe a captura. O resumo da jornada preserva a fonte e as referências de tempo necessárias para uma reconexão após recarregar a página, sem persistir coordenadas exatas.

A tela informa qual fonte está selecionada. Se a localização estiver bloqueada ou falhar, apresenta a orientação e o botão **Tentar ativar GPS deste dispositivo**. A troca automática não concede permissões: o usuário precisa autorizar a localização em um contexto seguro (HTTPS). A negativa de permissão não gera novas solicitações periódicas; uma nova tentativa depende da ação do usuário.

**iPhone:** mantenha o PWA aberto. O iOS pode suspender a localização, os temporizadores e as consultas em segundo plano ou com a tela bloqueada. Ao voltar ao aplicativo, o PWA reavalia a integração e reinicia a captura do navegador quando necessário. A implementação não garante rastreamento contínuo em segundo plano e ainda precisa de validação em um iPhone real.

### Validação das melhorias

A validação da troca automática inclui 81 testes, cobrindo indisponibilidade inicial, expiração de leituras, reconexões com atraso, prevenção de dupla contagem, recarga da página, pausas, GPS parado e mensagens da interface. O build de produção, a checagem TypeScript e o ESLint dos módulos de GPS alterados também são verificados. O lint global tem pendências preexistentes. Os testes automatizados não substituem a avaliação de precisão e permissões em dispositivos reais.

Para executar as suítes existentes com o carregador TypeScript disponível nas dependências instaladas:

```bash
node --import tsx --input-type=module -e 'for (const file of ["gps-failover", "gps-filter", "gps-ingestion", "integrated-gps-point", "integrated-trip", "metrics", "operation-time", "trip-sync"]) await import(`./src/lib/${file}.test.ts`); await import("./src/components/GpsTrackingStatus.test.tsx")'
```

## Controle de módulos da Administração

Ao ativar ou desativar um módulo, o menu e a tela correspondente são atualizados na sessão que salvou a configuração, sem recarregar o PWA. A disponibilidade global vale para usuários, administradores e superadministradores. A Administração continua acessível ao superadministrador para reativar módulos, inclusive quando todos os demais estiverem desabilitados.

Outros dispositivos consultam a configuração a cada 15 segundos enquanto o aplicativo está aberto e conectado. O PWA também consulta ao abrir uma tela, voltar ao primeiro plano e recuperar a conexão, mesmo que exista um cache recente. Dispositivos offline mantêm a última configuração conhecida até poderem consultar o servidor; o sistema operacional pode suspender consultas em segundo plano.

O bloqueio remove o módulo dos menus de desktop e celular e substitui seu conteúdo por um aviso ao acessar a URL diretamente. Os botões de ação da tela também ficam ocultos. A navegação de retorno usa um módulo disponível, em vez de enviar sempre para um Dashboard que pode estar desativado. As regras de autenticação e de acesso a dados do backend continuam independentes da disponibilidade visual dos módulos.

A correção inclui testes de desativação e reativação, todos os papéis, URLs diretas, resposta antiga em andamento, falha ao salvar, cache restaurado, retorno ao primeiro plano e reconexão. Para executar esses testes:

```bash
node --import tsx src/lib/system-access.test.ts
```

## Como funcionam as atualizações

### Deploy do servidor (automático)

Todo push na branch `main` — seja feito localmente ou sincronizado a partir do Lovable — dispara o workflow `.github/workflows/deploy.yml`, que:
1. Builda o projeto no runner do GitHub (não na VM — evita problemas de memória)
2. Sincroniza `.output/` para a VM via rsync/SSH
3. Recria o container (`docker compose up -d --force-recreate`), aplicando o código novo

Não é necessário nenhum passo manual — só dar push. Acompanhe o progresso na aba **Actions** do repositório.

### Atualização do app no navegador (PWA — automática)

O app registra um Service Worker com `autoUpdate`. Quando há uma versão nova publicada:
- O navegador do usuário detecta e baixa os arquivos novos em segundo plano
- O novo Service Worker assume o controle imediatamente (`skipWaiting` + `clientsClaim`), sem exigir fechar o app manualmente
- O usuário vê a versão atualizada na próxima navegação ou reload — geralmente em poucos segundos após o deploy

### O que **não** é automático

- **Lock file desatualizado:** se novas dependências forem adicionadas ao `package.json`, é preciso rodar `npm install` localmente e commitar o `package-lock.json` atualizado — senão o `npm ci` do CI falha.
- **Mudanças de infraestrutura:** configuração do Nginx Proxy Manager, regras de firewall (`firewalld`) e domínio/DNS são feitas manualmente na VM, fora do pipeline de deploy.

## Arquitetura de deploy (detalhada)

Ver [`DEPLOY.md`](./DEPLOY.md) para a documentação completa da arquitetura de deploy, incluindo o histórico de problemas resolvidos (bug de bundling do TanStack Start, configuração de firewall, etc.) — útil como referência caso algo semelhante aconteça de novo.

## Deploy manual (fallback)

Se precisar fazer deploy sem passar pelo GitHub Actions, direto na VM:
```bash
cd /home/opc/delivery-os-hub
git pull origin main
docker compose up -d --force-recreate
```
Isso só reinicia o container com o que já estiver sincronizado em `output/` — não builda nada. Para builds manuais, veja os comandos de referência em `DEPLOY.md`.

## Desafios e bonificações por aplicativo

Em **Metas**, cadastre o aplicativo, a descrição, a validade, a quantidade de entregas
ou receita necessária e o valor da bonificação. O progresso considera entregas concluídas
do aplicativo no intervalo informado; metas de receita incluem a **Gratificação do cliente**
(antigo campo Gorjeta, mantido na coluna `tip` para preservar os dados existentes).
Regras particulares de cada plataforma devem ser conferidas no aplicativo de origem.

Ao atingir a meta, o banco credita automaticamente a bonificação uma única vez na receita
e no lucro do dashboard, financeiro e relatórios. A data contábil é a data da validação
pelo servidor, inclusive para entregas sincronizadas depois de uso offline ou desafios
cadastrados após as entregas. Isso não confirma um pagamento externo pelo aplicativo.
Desmarque **Creditar automaticamente ao atingir a meta** para confirmar manualmente
o recebimento e informar sua data efetiva.
Cada desafio possui um único recebimento, que pode ser estornado. O estorno desativa
a automação desse desafio; para reativar, edite-o e marque novamente a opção. Alterações
ou exclusões posteriores das entregas não estornam créditos existentes: confira e estorne
o desafio quando necessário. Não registre como
bonificação um valor já incluído nos ganhos de uma entrega. Desafios recebidos não podem
ser editados ou excluídos sem estornar antes.

A visão por aplicativo inclui as bonificações recebidas no período, inclusive quando não
há entregas naquele período. Quantidade de entregas, distância, ticket médio de entregas,
metas pessoais e progresso dos desafios não recebem entregas fictícias. Gráficos,
ranking de entregas e detalhamentos históricos de operação continuam específicos às
entregas e são identificados como sem bonificações. O relatório de composição da receita
lista e exporta os recebimentos separadamente; a exportação da seleção por aplicativo
identifica cada linha como entrega ou bonificação.

**Ativação do banco:** aplique `supabase/migrations/20261101090000_app_challenges.sql`
e depois `supabase/migrations/20261104090000_automatic_app_challenges.sql`
no projeto Supabase antes de publicar esta versão. A segunda migração ativa a automação
nos desafios existentes sem recebimento e credita imediatamente os elegíveis, na data
da migração. Recebimentos já registrados são preservados. Revise os desafios pendentes
antes da aplicação, inclusive estornos antigos que ainda não tinham uma opção de automação. A migração cria `app_challenges`,
políticas de acesso por usuário, validações e a assinatura Realtime. A automação usa
gatilhos transacionais, bloqueio por desafio, índice de progresso e reconciliação autenticada
ao consultar os desafios, sem depender da tela de Metas aberta. Não exige alterações
na tabela de entregas nem reescrita dos valores existentes. Sem a migração ou sem conexão,
a interface avisa que as bonificações estão indisponíveis; não considere os totais completos.
As alterações de desafios e confirmações de pagamento exigem conexão.

Teste das regras e da apresentação por aplicativo:

```bash
node --import tsx --input-type=module -e 'await import("./src/lib/app-challenges.test.ts"); await import("./src/components/AppPerformance.test.tsx")'
```


Teste isolado da automação no PostgreSQL (não acessa produção):

```bash
npm install --prefix /tmp/delivery-db-validation --no-save --no-audit --no-fund @electric-sql/pglite
PGLITE_MODULE_PATH=/tmp/delivery-db-validation/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-app-challenges-db.mjs
```

O teste cobre metas de quantidade e receita com gratificações, normalização do aplicativo,
entregas em rota e fora da validade, repetição sem duplicidade, confirmação manual,
estorno, reativação, proteção de créditos e isolamento entre contas com RLS.


## Segurança, desempenho e testes

As proteções e otimizações compartilhadas, os cenários verificados e os limites da
validação estão em [SECURITY_REVIEW.md](./SECURITY_REVIEW.md). Para executar os testes:

```sh
npm ci
npm test
npm run typecheck
npm run test:db
npm run build
```

Os testes de banco usam PostgreSQL embarcado e não acessam o Supabase remoto.
Antes de publicar essas correções, aplique as duas migrações de segurança indicadas
no documento sobre a instalação existente. O push/deploy do frontend não aplica
migrações automaticamente.


## Jornada compartilhada entre dispositivos

Com a mesma conta autenticada, iniciar, pausar, retomar e finalizar a jornada atualiza
os outros dispositivos por Realtime. Uma consulta de recuperação a cada cinco segundos,
ao recuperar a conexão e ao voltar para a tela mantém o estado mesmo sem o canal ao vivo.
O navegador precisa estar aberto e conectado; o iOS pode suspender atividade em segundo
plano e revalida ao retornar.

A finalização fica registrada no snapshot compartilhado: mensagens atrasadas não reabrem
a jornada nem encerram uma jornada nova. O salvamento do histórico também fecha o snapshot,
mesmo se uma navegação interromper a fila do dispositivo original. Rascunhos de histórico
pendentes continuam apenas no dispositivo responsável até serem salvos. Falhas de rede
ou de atualização do servidor aparecem nas telas Entregas e Financeiro com **Tentar sincronizar**.

**Ativação:** aplicar `supabase/migrations/20261106090000_active_journey_sync.sql` sobre uma
instalação que já tenha `active_work_journeys` e `work_journeys`. A mesma migração está
registrada como `drizzle/migrations/0010_active_journey_sync.sql` para o fluxo Drizzle/Lovable.
Use o fluxo de migrações adotado pelo projeto; não é necessário executá-la pelos dois.
Ela registra a tabela no Realtime quando a publicação existe e restringe escritas à RPC
que valida conta, jornada e operação. Atualize/reabra o aplicativo nos demais dispositivos:
versões anteriores que escrevem diretamente na tabela não podem continuar sincronizando.
O push do frontend não substitui a aplicação da migração.

`npm test` cobre ordenação de requisições, respostas atrasadas, reconexão e troca de conta.
`npm run test:db` inclui dois clientes simulados usando PostgreSQL local para verificar
os botões de início/fim, mensagens antigas, concorrência de inícios, encerramento pelo
histórico, isolamento por conta e configuração da publicação. Não substitui a confirmação
em dois aparelhos reais com a migração aplicada.

### Entregas: carregamento e registro rápido

A tela consulta o período selecionado no banco e carrega o histórico em blocos de
20 registros. **Tudo** libera a consulta sem limite de datas, mantendo a paginação.
Os indicadores de aprendizagem usam uma projeção reduzida do mês e dos 56 dias
anteriores ao início dele; jornadas que atravessam a meia-noite continuam incluídas
nos cálculos por intervalo. Financeiro também filtra entregas pelo período escolhido.

O modo **Rápido** oferece aplicativos, valores frequentes, incrementos e conserva o
último pagamento escolhido. O modo **Completo** mantém endereços, paradas e mapa.
Formulário, resumo, mapa e histórico têm estado separado. Rotas repetidas e endereços
usam cache limitado em memória; o cálculo automático aguarda 600 ms e a geocodificação
respeita uma fila de uma chamada por segundo. Coordenadas não são persistidas por
esse cache.

A medição de uma entrega usa a diferença dos contadores da mesma jornada e desconta
pausas. Sugestões exigem leitura recente; **Medir esta entrega** define uma referência
explícita quando não há uma referência segura. **Cheguei no restaurante** e **Entregue**
capturam uma posição nova. Finalizar pelo histórico preserva os quilômetros informados.
O registro rápido funciona offline pela fila local, que sincroniza ao reconectar.

O scanner aceita JPG, PNG e WebP de até 6 MB, reduz a imagem localmente e só a envia
quando **Ler imagem** é acionado. Os campos extraídos são revisáveis antes da aplicação
ao formulário; a leitura nunca salva uma entrega automaticamente. Usa a integração
`LOVABLE_API_KEY` no servidor e a quota autenticada já compartilhada com o scanner de
combustível. A chave não está configurada neste ambiente de desenvolvimento; a
integração foi validada com respostas simuladas, sem chamar o provedor real.

Validação: `npm test`, `npm run typecheck`, `npm run build` e `npm run test:db`.
O teste móvel isolado `python scripts/smoke-deliveries.py` requer Python Playwright,
Chromium e o servidor Vite na porta 3005 (`npm run dev -- --host 0.0.0.0 --port 3005`).
Ele intercepta serviços externos e verifica paginação, taxas, pagamento e gravação
online/offline. `SMOKE_BASE_URL` permite alterar a URL local. Não substitui a validação
de GPS em aparelhos reais nem a leitura de comprovantes pelo provedor de IA.

A sincronização também compara o histórico de pausas ao proteger comandos contra
respostas atrasadas. Pausar/retomar avançam a versão mesmo se o relógio local voltar
ou dois comandos ocorrerem no mesmo milissegundo. Um comando antigo rejeitado pela
RPC adota o estado confirmado no servidor, evitando manter uma pausa já encerrada
em outro dispositivo. Os testes com dois clientes PostgreSQL cobrem início, pausa,
retomada, reconexão com pausa antiga e finalização. A publicação da versão atual e
a migração de sincronização descrita acima continuam necessárias para uso entre
aparelhos; esta correção não acrescenta outra migração.
