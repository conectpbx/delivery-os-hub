# Melhorar desempenho e meta diária inteligente

## Objetivo
Deixar o PWA mais fluido no celular e calcular uma meta diária realista conforme o progresso mensal e os dias em que o entregador costuma trabalhar.

## Implementação
- Reduzir atualizações e novas consultas desnecessárias ao alternar telas ou retornar ao aplicativo, preservando sincronização em tempo real e modo offline.
- Diminuir gravações repetidas do cache offline, agrupando alterações próximas antes de persistir os dados.
- Evoluir a meta diária para distribuir o valor restante apenas entre os dias habituais de trabalho identificados no histórico recente.
- Usar todos os dias restantes quando ainda não houver histórico suficiente, garantindo um cálculo previsível para novos usuários.
- Exibir quantos dias de trabalho foram considerados e manter Dashboard, Entregas, Metas e alertas usando o mesmo cálculo.

## Validação
- Cobrir a meta inteligente com testes para histórico suficiente, ausência de histórico e mudança de mês.
- Executar os testes existentes e verificar a prévia autenticada no fluxo de Dashboard, Entregas e Metas.
- Confirmar que modo offline e sincronização automática permanecem ativos.
