# Interfood — Checklist para migração futura

> Escopo: homologação `interliga-homologacao-eb0f2`. Produção `interliga-mobilidade` não deve ser alterada até autorização explícita.

## Já validado em homologação

- Firebase Authentication por e-mail/senha para estabelecimento.
- Firebase Authentication por e-mail/senha para entregador.
- Firebase Authentication por e-mail/senha para franqueado.
- Criação de estabelecimento pelo franqueado com acesso próprio e redefinição de senha.
- Bloqueio/liberação de acesso de estabelecimento pelo franqueado.
- Isolamento por `franquiaId` e `lojaId` nas Firestore Rules.
- Estabelecimento lê apenas os próprios pedidos.
- Fluxo do estabelecimento: `Novo → Confirmado → Em preparo → Pronto`.
- Entregador da franquia recebe pedidos `Pronto` e executa: `Entregador aceitou → Coletado → Saiu para entrega → Concluído`.
- Franqueado audita todos os estabelecimentos da própria franquia e não acessa outra franquia.
- Pedido do cliente criado automaticamente no Firestore por autenticação anônima, sem uso do Firebase Console.
- Cliente pode acompanhar somente o próprio pedido usando `clienteUid`.
- Dados básicos do pedido: número, cliente, telefone, entrega, endereço, observações, pagamento, valor, status, loja, franquia, origem e timestamps.

## Antes de migrar para produção

- Validar novamente todas as Firestore Rules no emulador ou ambiente de homologação.
- Ativar App Check no canal público do cliente para reduzir abuso automatizado.
- Definir catálogo/cardápio e cálculo de preço no servidor; não confiar em valor digitado pelo cliente em produção.
- Definir taxa de entrega, comissão e regras financeiras oficiais; a comissão de 12% usada na homologação é apenas estimativa.
- Definir política de cancelamento/reembolso e respectivos status.
- Definir meios de pagamento reais e integração do gateway escolhido.
- Implementar criação de pedido no backend confiável quando houver pagamento online ou preço calculado por catálogo.
- Validar notificações para estabelecimento, cliente e entregador.
- Validar logs/auditoria de alterações e retenção de dados.
- Revisar LGPD: dados pessoais necessários, prazo de retenção e política de privacidade.
- Fazer teste de carga básico e teste em celular.
- Congelar uma versão aprovada da homologação antes da migração.
- Fazer backup/exportação da configuração de produção antes de qualquer alteração.
- Migrar configuração e regras de forma controlada, sem copiar usuários/senhas de teste.
- Executar smoke test em produção com pedido controlado antes da liberação geral.

## Regra de ouro

A homologação é a fonte de validação funcional. A produção só recebe alterações após teste completo e autorização explícita.
