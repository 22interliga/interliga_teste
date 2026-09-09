# Retenção de dados — Interfood Homologação

## Objetivo
Este documento registra a política técnica provisória de retenção para o ambiente de homologação do Interfood. Não substitui definição jurídica/LGPD da produção.

## Princípio de separação
Os dados ficam separados em quatro grupos para evitar que uma rotina técnica apague registros de negócio:

1. auditoria operacional e financeira resumida;
2. registros de negócio e financeiros originais;
3. tokens de push;
4. dados técnicos de rate limit.

Nenhuma rotina de limpeza técnica deve excluir pedidos, fechamentos, referências financeiras ou dados que sejam o registro original de uma operação.

## auditoriaInterfood
- Finalidade: trilha resumida de segurança e rastreabilidade.
- Conteúdo minimizado: entidade, IDs técnicos, franquia, loja, ação, status anterior/novo, UID/perfil quando disponível, referência de pagamento quando aplicável e timestamps.
- Não duplicar: endereço, telefone, conteúdo integral do pedido, token FCM ou dados desnecessários do cliente.
- Retenção técnica atual na homologação: 365 dias.
- Cada novo evento recebe `expiraEm` calculado para 365 dias após a criação.
- O TTL do Firestore para `auditoriaInterfood.expiraEm` foi habilitado e validado na homologação em 08/09/2026.
- O TTL atua somente na coleção de auditoria; não foi habilitado para pedidos ou fechamentos.

### Importante sobre auditoria financeira
Os eventos `fechamento_criado`, `fechamento_marcado_pago` e similares são apenas uma trilha resumida. A expiração desses eventos de auditoria não apaga o fechamento financeiro original nem a referência de pagamento armazenada no registro de negócio.

## pedidos e fechamentos financeiros
- São registros de negócio, não dados auxiliares.
- Não possuem TTL nesta etapa.
- Não participam da rotina `limparDadosAuxiliaresInterfood`.
- Fechamentos, comissões congeladas, repasses, situação Pendente/Pago e referências de pagamento permanecem preservados até definição formal de retenção para produção.
- Não executar exclusão automática nem limpeza em massa destes registros sem política aprovada e backup prévio.

## pushTokensInterfood
- Finalidade: entrega de notificações push.
- Tokens não são copiados para a auditoria.
- Política ativa em homologação:
  - token ativo sem atualização por 90 dias: desativar;
  - token já inativo por mais de 30 dias: remover.
- A rotina automática roda diariamente às 04:00 no fuso `America/Sao_Paulo`.

## rateLimitsInterfood
- Finalidade: controle técnico de abuso/rate limiting.
- Não é histórico de negócio.
- Política ativa em homologação: remover registros sem uso após 48 horas.
- A limpeza é feita pela mesma rotina diária de dados auxiliares.

## Rotina automática de dados auxiliares
A função `limparDadosAuxiliaresInterfood` está implantada e agendada na homologação.

Ela pode atuar somente sobre:
- `pushTokensInterfood`;
- `rateLimitsInterfood`.

Ela não deve atuar sobre:
- `auditoriaInterfood` — esta usa TTL próprio;
- pedidos;
- fechamentos financeiros;
- clientes;
- estabelecimentos;
- franquias.

## Estado validado na homologação
- `auditoriaInterfood.expiraEm`: TTL ativo.
- Auditoria de pedidos: ativa e em tempo real.
- Auditoria de fechamentos/pagamentos: ativa e em tempo real.
- `limparDadosAuxiliaresInterfood`: implantada e agendada.
- Tokens antigos/inativos: política específica separada.
- Rate limit: retenção curta específica.
- Pedidos e registros financeiros originais: preservados sem TTL.
- Produção: sem alteração.

## Antes de migrar para produção
Definir e aprovar, separadamente:
1. prazo definitivo de retenção da auditoria operacional;
2. prazo definitivo para registros financeiros/fiscais e obrigações contratuais;
3. política para pedidos e dados pessoais dos clientes;
4. política definitiva de tokens de push;
5. política de dados técnicos de rate limit;
6. processo de atendimento a solicitações LGPD e exceções de preservação legal/contratual;
7. backup/exportação antes de qualquer política automática de exclusão;
8. autorização expressa antes de replicar TTL ou rotinas de limpeza na produção.

## Regra de segurança para produção
A configuração atual é de homologação. Nenhum TTL, prazo de exclusão ou rotina de limpeza deve ser copiado automaticamente para `interliga-mobilidade`. A migração exige revisão final e autorização expressa.