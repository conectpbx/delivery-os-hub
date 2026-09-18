# Sincronização em tempo real e alertas de manutenção

## Objetivo
Fazer o Dashboard refletir automaticamente novas entregas, custos, abastecimentos, manutenções, metas e alterações do perfil, sem recarregar a página. Corrigir os alertas para que um ciclo antigo de manutenção não continue aparecendo como atrasado depois que o mesmo serviço foi realizado novamente.

## Implementação
- Criar uma assinatura Realtime reutilizável nos hooks de dados e conectá-la às consultas de entregas, abastecimentos, despesas, manutenções, metas e perfil.
- Ao receber inclusão, alteração ou exclusão, atualizar/inutilizar a consulta correspondente para recalcular imediatamente cards, gráficos, metas e alertas.
- Habilitar Realtime, por migração, nas tabelas usadas pelo Dashboard que ainda não participam da publicação.
- Ajustar os alertas de manutenção para considerar somente o registro mais recente de cada tipo de serviço. Um serviço posterior encerra o ciclo e o vencimento do registro anterior.
- Preservar no histórico todos os serviços realizados; a filtragem vale apenas para lembretes e avisos ativos.
- Adicionar testes cobrindo o encerramento de alerta antigo e a seleção do ciclo mais recente.

## Detalhes técnicos
- As assinaturas serão criadas dentro de `useEffect` e removidas ao desmontar, evitando canais duplicados.
- As mudanças serão filtradas pela segurança já existente no banco e reutilizarão as chaves atuais do cache.
- A identificação do mesmo serviço normalizará maiúsculas/minúsculas e espaços no nome para evitar duplicidade simples.
- A migração será idempotente, adicionando apenas as tabelas ausentes à publicação Realtime.

## Validação
- Executar os testes das métricas e alertas.
- Verificar o Dashboard autenticado, confirmando atualização de gráfico, meta e alerta após uma alteração sem recarregar.
- Confirmar que um registro antigo vencido não gera alerta quando há um serviço mais recente do mesmo tipo.
