# Melhorar metas e inteligência mensal

## Objetivo
Deixar todas as metas cadastradas fáceis de consultar e editar, com orientações práticas baseadas no desempenho real e corretas na virada de cada mês.

## Implementação
- Exibir todas as metas cadastradas, ordenadas por mês, com receita, lucro e entregas planejadas e realizadas.
- Manter ações claras para editar e excluir, destacar o mês atual e mostrar o status de cada meta.
- Ao editar, carregar os valores no formulário e levar o usuário até ele para evitar perda de contexto.
- Criar uma análise de desempenho usando os dados disponíveis: projeção do mês, ritmo necessário, melhor dia da semana e comparação com meses anteriores.
- Isolar rigorosamente o mês atual nos cálculos; ao virar o mês, reiniciar progresso e projeção sem carregar receita do mês anterior.
- Preservar o aprendizado dos dias habituais de trabalho com o histórico recente e usar uma orientação segura quando os dados forem insuficientes.

## Validação
- Adicionar testes para virada de mês, projeção e ausência de histórico.
- Validar a tela autenticada em computador e celular, incluindo edição de uma meta sem alterar dados reais.
- Confirmar testes e compilação sem erros.
