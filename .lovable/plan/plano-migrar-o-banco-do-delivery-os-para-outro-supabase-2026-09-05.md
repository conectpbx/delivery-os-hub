# Plano: migrar o banco do Delivery OS para outro Supabase

## Resumo
Recriar o schema do zero no novo projeto Supabase usando as migrations do repositório, depois transferir os dados das tabelas `public` e reconfigurar o app para apontar para o novo backend. A migração de usuários do `auth.users` tem limitações importantes porque o Lovable Cloud não expõe a service role key nem os hashes de senha.

## Passos

1. **Preparar o destino**
   - Criar um novo projeto Supabase (fora do Lovable Cloud, com dashboard acessível) ou outro projeto Lovable Cloud.
   - Anotar a nova `URL` e a chave `anon`/`publishable`.

2. **Recriar o schema**
   - Aplicar sequencialmente todos os arquivos em `supabase/migrations/` no novo projeto, na ordem dos timestamps:
     - `20260809152628_0147c680-8751-40cf-86b3-750c6b5835a5.sql`
     - `20260809152723_ec8621a3-d6c0-4c50-9483-f0eaee61d405.sql`
     - `20260809165124_cbbb3252-778f-400c-9fba-60adbcd84078.sql`
     - `20260812120549_067b874b-07a7-44f2-907a-28febaacdf4e.sql`
     - `20260812231350_086dfc67-0b33-4c74-a3e3-2ef48e0c4593.sql`
     - `20260830120000_add_delivery_payment_method.sql`
     - `20260831145603_e66fc414-62e3-4e77-bf27-6748b717236e.sql`
     - `20260903000736_d4360a00-e0ba-424d-84af-cc08f87d5581.sql`
   - Verificar se as tabelas, funções, triggers, políticas RLS e GRANTs estão idênticos ao projeto atual.

3. **Configurar autenticação no destino**
   - Habilitar Google OAuth (e qualquer outro provider usado) no novo projeto.
   - Atualizar os `redirect_uri` para o domínio do app após a troca.

4. **Migrar os dados das tabelas `public`**
   - Tabelas a exportar/importar: `profiles`, `apps`, `deliveries`, `fuelings`, `maintenances`, `expenses`, `goals`, `ai_scan_usage`.
   - Opção A (recomendada se houver poucos usuários): para cada usuário, exportar via API REST autenticada do projeto atual e inserir no novo projeto usando service role key do destino.
   - Opção B (dados anônimos/aggregados): exportar CSV pelo painel Cloud → Advanced → Export data e importar via SQL/CSV no destino, depois vincular manualmente os `user_id`.

5. **Migrar ou recriar usuários (`auth.users`)**
   - **Limitação crítica**: o Lovable Cloud não fornece a service role key nem a senha do banco, então não é possível exportar hashes de senha nem a lista completa de `auth.users`.
   - Opção A: convidar cada usuário a fazer login novamente no novo app com Google OAuth; o trigger `handle_new_user()` recria o `profile` automaticamente.
   - Opção B: se o novo projeto tiver service role key, criar os usuários via API Admin do Supabase (`auth.admin.createUser`) e enviar magic link para redefinição de senha.

6. **Atualizar o app**
   - Trocar as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` (e as server-side `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`) para o novo projeto.
   - Se o destino for Lovable Cloud, deixar que o Lovable gere/atualize essas variáveis automaticamente.
   - Rebuild e redeploy.

7. **Validação**
   - Verificar se o login funciona no novo projeto.
   - Conferir se os dados históricos aparecem no Dashboard, Entregas, Financeiro, Metas e Relatórios.
   - Testar uma entrega nova e uma despesa nova para garantir que RLS e triggers estão corretos.

## Riscos e limitações
- **auth.users**: sem acesso à service role key do projeto atual, não é possível migrar senhas. Os usuários precisarão fazer login novamente ou redefinir senha.
- **Storage**: não há buckets no projeto atual, então não há arquivos para migrar.
- **IDs**: as tabelas usam `UUID` gerados pelo banco; a importação em bulk precisa preservar os `id` para manter relacionamentos consistentes.
- **Downtime**: o app deve ser apontado para o novo banco apenas depois que os dados estiverem migrados, ou manter o banco antigo em modo leitura durante a transição.

## Decisões pendentes
- O novo Supabase será gerenciado diretamente pelo dashboard do Supabase ou será outro projeto Lovable Cloud?
- Quantos usuários ativos existem no app hoje?
- Os usuários podem ser convidados a fazer login novamente, ou é necessário preservar senhas sem interação?
