# Manutenção diluída por quilometragem

## Objetivo
Manter dois resultados financeiros claros:

- **Lucro por caixa:** desconta integralmente abastecimentos, despesas e manutenções pagas no período.
- **Lucro operacional:** desconta combustível estimado, despesas e uma reserva de manutenção proporcional aos quilômetros rodados.

## O que será implementado

### 1. Cálculo da reserva de manutenção
- Calcular o custo por km de cada serviço com `custo ÷ (próximo km − odômetro atual)`.
- Considerar somente o registro mais recente de cada tipo de serviço, evitando somar ciclos antigos do mesmo item.
- Somar os custos por km válidos para obter a **reserva de manutenção por km**.
- Quando odômetro ou próximo km estiver ausente/inválido, não estimar silenciosamente; sinalizar que faltam dados.

### 2. Tela de manutenção
- Mostrar uma prévia automática do custo por km durante o cadastro.
- Adicionar indicadores de reserva por km e cobertura dos cadastros.
- Exibir em cada serviço o custo diluído e o intervalo utilizado.
- Orientar o preenchimento de “Odômetro atual” e “Próximo km” para habilitar o cálculo.

### 3. Resultados financeiros
- Preservar o cálculo atual por caixa nos relatórios.
- Acrescentar o lucro operacional, calculado com a reserva de manutenção aplicada à quilometragem do período.
- Exibir separadamente o gasto efetivamente pago e a reserva estimada, sem dupla contagem.
- Atualizar painel e financeiro para deixar os dois resultados identificados com clareza.

### 4. Gráficos e relatórios
- Manter exportações contábeis com os valores efetivamente pagos.
- Acrescentar a reserva de manutenção e o lucro operacional ao resumo, sem misturá-los ao total pago.
- Fazer o gráfico de desempenho usar o lucro operacional, enquanto o detalhamento de custos continua mostrando os lançamentos reais.

## Regras técnicas
- O custo diluído será zero quando o intervalo em km for inválido.
- Registros incompletos serão contados e apresentados como pendentes de dados.
- Nenhuma alteração no banco é necessária; serão usados os campos atuais de odômetro, próximo km e custo.
- Serão adicionados testes para cálculo válido, dados incompletos e múltiplos ciclos do mesmo serviço.
