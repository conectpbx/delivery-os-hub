# Melhorar desempenho mobile do Delivery OS

## Objetivo
Reduzir travamentos e demora ao abrir e usar o PWA em celulares, preservando sincronização em tempo real e uso offline.

## Implementação
- Carregar cada tela em um pacote separado, evitando baixar Entregas, relatórios, gráficos e administração antes de serem abertos.
- Reduzir o volume e o custo do cache offline, persistindo somente os dados úteis e adiando a restauração para não bloquear a abertura.
- Compartilhar as assinaturas de atualização automática entre telas, evitando conexões duplicadas para as mesmas informações.
- Evitar consultas externas de rota enquanto o painel não estiver visível e ampliar o tempo de reaproveitamento dos cálculos já feitos.
- Adiar gráficos e conteúdos pesados fora da primeira área visível, mantendo indicadores e ações principais imediatos.
- Otimizar a gravação dos rascunhos no celular, agrupando alterações rápidas em vez de gravar a cada tecla.
- Limitar o trabalho visual de mapas e listas extensas, sem remover o histórico completo.

## Validação
- Executar os testes existentes e a verificação de tipos automática.
- Medir no navegador móvel o carregamento inicial, troca entre telas e interação com Dashboard e Entregas.
- Confirmar que sincronização automática, modo offline, GPS, mapas e filtros continuam funcionando.

## Observação
O modo offline continuará disponível na versão publicada; a prévia permanece protegida contra cache antigo.
