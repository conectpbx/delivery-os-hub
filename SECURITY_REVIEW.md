# Revisão de segurança e desempenho

A revisão cobre o código da aplicação e os testes locais. Não certifica a configuração
atual do Supabase, do domínio publicado ou do proxy de produção.

## Correções de segurança

| Camada | Verificação e correção |
| --- | --- |
| Sessão e autenticação | Uma assinatura compartilhada de sessão; um resultado inicial atrasado não substitui login/logout mais recente. Falhas de autenticação das funções de servidor usam HTTP 401. A validação de assinatura/expiração continua no Supabase `getClaims`. |
| Cache e rascunhos | Restauração assíncrona vinculada à conta; troca de usuário limpa memória e não restaura o cache anterior. Cache offline permite somente dados operacionais; administração e coordenadas GPS não são persistidas nesse cache. Rascunhos também são vinculados à conta durante a renderização/gravação. |
| Sincronização offline | Atualizações atômicas no IndexedDB preservam inserções simultâneas e registros adicionados durante o envio. IDs estáveis e upsert idempotente impedem duplicação após perda de resposta. Tabela/chave e proprietário são validados antes do envio; RLS continua a autorização definitiva. |
| Banco/RLS | A regra de assinaturas agora compara explicitamente a organização da assinatura externa à subconsulta. O teste reproduz a leitura indevida anterior e verifica o isolamento corrigido. Políticas restritivas negam acesso a contas bloqueadas mesmo com JWT não expirado. |
| Administração e cadastro | Verificação administrativa inclui conta ativa. O bloqueio revoga tokens de dispositivos. A opção de desabilitar cadastros é aplicada no banco independentemente do gatilho legado de papéis. |
| IA | Contadores de uso não podem ser alterados diretamente por clientes. A RPC mantém incremento atômico, aplica o teto central e recusa a primeira utilização quando o limite é zero. A função de OCR continua autenticada e protegida contra CSRF. |
| APIs GPS | Limite de 16 KiB durante leitura, inclusive sem Content-Length, e prazo de 10 segundos. RPCs validam dados independentemente do HTTP. Token só altera a própria rota; pontos duplicados não mudam o estado, pontos antigos não sobrescrevem totais recentes e encerramento é idempotente. Histórico atrasado anterior ao encerramento continua permitido. |
| Uploads de funções de servidor | Leitura limitada a 8,1 MB antes do parser do framework, compatível com imagem de 6 MB codificada em base64 mais envelope. |
| Navegador/exportação | Cabeçalhos nosniff, referrer policy, permissions policy e CSP para base/object/framing. HTML é privado; APIs/funções de servidor e erros não entram em cache compartilhado. Texto de CSV não pode iniciar fórmulas no Excel; números negativos continuam numéricos. |
| Dependências | Vite, Zod, serializador e dependências transitivas vulneráveis foram atualizados. Overrides de ferramentas são testados com build/Workbox, ESLint e `drizzle-kit check`. Ambos os lockfiles são mantidos. |

A CSP é deliberadamente parcial: não foi adicionada uma política `script-src` sem
validar nonce/hidratação e as integrações do editor. React continua escapando o
conteúdo textual; a única injeção de CSS encontrada é o componente de gráficos com
configuração do próprio código, sem entrada livre de usuário. Tokens de serviço e
chaves de IA continuam em módulos/handlers de servidor; a verificação dos arquivos
JS públicos não encontrou os nomes dessas variáveis.

## Desempenho

- Formatadores `Intl` reutilizados em todos os módulos. No mesmo processo/ambiente,
  20 mil formatações passaram de aproximadamente 465 ms para 9 ms. É uma medição
  dessa rotina, não uma promessa de ganho equivalente no aplicativo completo.
- Cálculos financeiros são memorizados por dados/período; o relógio da jornada e a
  digitação dos formulários não repetem o processamento do histórico inteiro.
- Consultas pessoais só iniciam com sessão, aceitam cancelamento e reutilizam cache
  recente ao navegar/focar. Permissões conservam sua atualização a cada 15 segundos;
  os intervalos e filtros de captura GPS não foram reduzidos.
- Histórico paginado remove o truncamento silencioso de totais acima de 1.000 linhas.
  A leitura completa continua proporcional ao histórico: não foi introduzido um
  limite arbitrário que altere os resultados financeiros.
- Realtime compartilha canais por conta/tabela, filtra inserções/alterações e agrupa
  notificações. Exclusões continuam sem filtro porque o Supabase não suporta filtrar
  eventos DELETE; consultas de dados continuam protegidas por RLS.
- O cache offline é desidratado e gravado por lote, não a cada atualização. Falhas de
  armazenamento preservam o uso online. pagehide/ocultação solicita a última gravação.
- Nitro gera gzip/Brotli dos assets. Arquivos com hash usam cache imutável; service
  worker e manifest têm revalidação própria. Gráficos e Leaflet conservam carregamento
  sob demanda já existente.

## Executar as verificações

```sh
npm ci
npm test
npm run typecheck
npm run test:db
npm run build
npx drizzle-kit check
npm audit --omit=dev
npm audit
```

Os testes SQL usam PostgreSQL embarcado (PGlite), contas e tokens fictícios. Não
acessam nem alteram produção. O cenário de administração usa uma fixture consolidada:
há migrações históricas que redefinem tabelas/tipos, portanto isto não valida replay
do histórico completo em um banco vazio.

Para verificar o servidor construído, inicie em outro terminal:

```sh
HOST=127.0.0.1 PORT=3002 node --env-file=.env .output/server/index.mjs
```

Depois execute `node scripts/smoke-server.mjs` (ou defina `SMOKE_BASE_URL`). O teste
verifica SSR/login, CORS, 401/400/413 nas APIs GPS, CSRF, função OCR sem autenticação,
limite de upload e Brotli/cache. Não envia dados válidos ao backend externo.

## Ativação e limites da validação

Aplicar as novas migrações, nessa ordem, sobre a instalação existente, conferindo
antes o histórico efetivamente aplicado:

1. `supabase/migrations/20261105090000_security_hardening.sql`
2. `supabase/migrations/20261105091000_gps_route_security.sql`

A primeira pressupõe o plano administrativo com schema `private`, tabelas de
configuração/uso de IA e migração anterior de desafios. A segunda pressupõe as
tabelas de dispositivos, pontos e sessões GPS. Não reaplicar migrações históricas que
já constam no projeto. A ativação remota não foi realizada nesta tarefa.

Depois de bloquear/desbloquear uma conta, seus tokens GPS antigos permanecem
revogados; gere novos tokens para voltar a integrar os dispositivos. Desabilitar
cadastros bloqueia inserções em auth.users, inclusive convites enquanto a opção
estiver desativada. Bloqueio remoto não apaga dados já baixados pelo usuário para
uso offline.

A auditoria final de produção não aponta advisories conhecidos. Há quatro avisos de
severidade baixa na cadeia de build do Workbox, todos derivados de `deepmerge` 4.3.1,
cuja versão mais recente consultada ainda é afetada. A entrada de merge nessa cadeia
é a configuração local de build, sem entrada de usuário em execução. Não foi aplicado
o downgrade incompatível de vite-plugin-pwa sugerido pelo npm para eliminar o aviso.
Isto deve ser reavaliado quando houver correção upstream; não usar configuração de
build não confiável.

Continuam fora da validação local: políticas reais do projeto Supabase, MFA/CAPTCHA e
limites de login, gestão/rotação de segredos, TLS/HSTS e limites de taxa no proxy,
headers de CDN, permissões do host Docker e testes autenticados em navegador/dispositivo
real. O lint global tem pendências anteriores; o lint dos arquivos TypeScript alterados
é verificado separadamente, sem reformatar o restante do aplicativo.
