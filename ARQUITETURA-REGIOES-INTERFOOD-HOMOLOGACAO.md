# Auditoria de regiões — Interfood Homologação

Data da revisão: 08/09/2026

## Escopo

Revisão somente de arquitetura. Nenhuma função foi movida, renomeada ou redeployada nesta etapa. Produção não foi alterada.

Projeto analisado: `interliga-homologacao-eb0f2`.

Banco Firestore: `southamerica-east1`.

## Divergências confirmadas

As funções abaixo usam gatilho Firestore sobre documentos armazenados em `southamerica-east1`, porém a função está configurada em `us-central1`:

- `notificarPedidoInterfood`
- `auditarPedidoInterfood`
- `auditarFechamentoInterfood`

O próprio Firebase CLI exibiu aviso de gatilhos em região diferente da região da função durante o deploy.

### Impacto técnico

Esse desenho não impede o funcionamento já validado, mas pode adicionar latência e tráfego entre regiões. Como as três funções são acionadas diretamente por alterações no Firestore, são as candidatas prioritárias para colocalização futura em `southamerica-east1`.

## Funções HTTP atualmente em us-central1

- `criarPedidoClienteSeguro`
- `gerenciarFechamentosInterfood`
- `registrarPushInterfood`
- `analisarCardapioImagem`

Essas funções são chamadas pelo frontend por HTTP e hoje estão funcionando em homologação. Mover uma função HTTP altera a URL regional e exige atualização coordenada do frontend. Portanto, não serão movidas apenas para eliminar o aviso do Firestore.

## Função agendada

- `limparDadosAuxiliaresInterfood` está em `us-central1` e tem Cloud Scheduler em `us-central1`, às 04:00 no fuso `America/Sao_Paulo`.

Ela acessa o Firestore apenas uma vez por dia. A diferença regional é aceitável nesta fase e não justifica mudança imediata.

## Recomendação para próxima etapa de homologação

1. Não alterar as funções HTTP agora.
2. Planejar teste isolado para mover somente os três gatilhos Firestore para `southamerica-east1`.
3. Fazer um gatilho por vez, começando por `auditarPedidoInterfood`, por ser somente de auditoria e ter menor risco operacional.
4. Após cada alteração, validar criação de pedido e mudança de status antes de avançar para `auditarFechamentoInterfood` e `notificarPedidoInterfood`.
5. Não aplicar essa mudança em produção antes da migração e autorização expressa.

## Estado atual

O aviso de região está mapeado e documentado. Não há falha funcional aberta associada a ele neste momento.
