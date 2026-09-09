# Retenção de dados — Interfood Homologação

## Objetivo
Este documento registra a política técnica provisória de retenção para o ambiente de homologação do Interfood. Não substitui definição jurídica/LGPD da produção.

## Escopo atual

### auditoriaInterfood
- Finalidade: trilha operacional e financeira de segurança/auditoria.
- Conteúdo minimizado: entidade, IDs técnicos, franquia, loja, ação, status anterior/novo, UID/perfil quando disponível, referência de pagamento quando aplicável, timestamps.
- Não duplicar: endereço, telefone, conteúdo integral do pedido, token FCM ou dados desnecessários do cliente.
- Retenção técnica atual na homologação: 365 dias.
- Cada novo evento recebe o campo `expiraEm` calculado para 365 dias após a criação.
- O campo `expiraEm` já existe, mas a exclusão automática por TTL não deve ser considerada ativa até a política TTL do Firestore ser explicitamente habilitada e validada.

### pushTokensInterfood
- Finalidade: entrega de notificações push.
- Não copiar tokens para auditoria.
- Tokens inválidos/inativos devem ser tratados por rotina própria; não misturar com retenção de registros financeiros.

### rateLimitsInterfood
- Finalidade: controle técnico de abuso/rate limiting.
- Não é histórico de negócio.
- Pode futuramente receber retenção curta específica, separada da auditoria.

### pedidos e fechamentos financeiros
- Não aplicar exclusão automática nesta etapa.
- Fechamentos, referências de pagamento e demais registros financeiros devem permanecer preservados até definição formal de retenção da produção.

## Estado da implementação
- `functions/auditoria-interfood.js` grava `expiraEm` com 365 dias apenas na homologação.
- Nenhum dado existente deve ser apagado manualmente como parte desta etapa.
- Produção permanece sem alteração.

## Antes de migrar para produção
Definir e aprovar, separadamente:
1. prazo de retenção de auditoria operacional;
2. prazo de retenção de registros financeiros/fiscais;
3. tratamento de pedidos e dados pessoais de clientes;
4. política de tokens de push inativos;
5. política de dados técnicos de rate limit;
6. processo de atendimento a solicitações LGPD e exceções de preservação legal/contratual;
7. backup e exportação antes de qualquer política automática de exclusão.

## Próximo passo seguro na homologação
Após validação expressa, pode-se habilitar TTL somente para `auditoriaInterfood.expiraEm`. Isso fará o Firestore remover automaticamente eventos depois da data de expiração. Essa ativação deve ocorrer apenas na homologação primeiro e não deve ser replicada em produção sem autorização específica.
