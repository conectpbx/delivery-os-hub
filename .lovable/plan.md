# Atualização dos alertas de manutenção

## Objetivo
Fazer os alertas refletirem imediatamente uma manutenção agendada ou excluída.

## Implementação
- Atualizar o cache de manutenções com o registro confirmado, sem depender apenas de uma recarga posterior.
- Gerar lembrete para toda manutenção futura: destaque de urgência nos próximos 7 dias e aviso informativo para datas mais distantes.
- Exibir os alertas preventivos também na página de manutenção, mantendo o painel principal sincronizado.
- Corrigir o cálculo de prazo para usar a mesma data de referência em todos os alertas.

## Validação
- Testar alertas para manutenção vencida, próxima, futura e sem agendamento.
- Confirmar que salvar e excluir atualizam a tela imediatamente.
