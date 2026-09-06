# Interfood — Checklist para migração futura

> Escopo: homologação `interliga-homologacao-eb0f2`. Produção `interliga-mobilidade` não deve ser alterada até autorização explícita.

## Já validado em homologação

- Firebase Authentication por e-mail/senha para cliente, estabelecimento, entregador e franqueado.
- Criação de estabelecimento pelo franqueado com acesso próprio e redefinição de senha.
- Bloqueio/liberação de acesso de estabelecimento pelo franqueado.
- Isolamento por `franquiaId` e `lojaId` nas Firestore Rules.
- Estabelecimento lê apenas os próprios pedidos.
- Fluxo do estabelecimento: `Novo → Confirmado → Em preparo → Pronto`.
- Entregador da franquia recebe pedidos `Pronto` e executa: `Entregador aceitou → Coletado → Saiu para entrega → Concluído`.
- Cliente autenticado visualiza apenas os próprios pedidos via `clienteUid`.
- Fluxo operacional em tempo real validado sem F5 entre cliente, estabelecimento e entregador.
- Push Web FCM validado com a aba fechada para cliente, estabelecimento e entregador.
- Logout desativa o vínculo do token de push e novo login pode reativá-lo.
- Backend evita reutilização indevida do mesmo token por contas diferentes.
- Limpeza de tokens inválidos e tokens antigos implantada na homologação.
- Dados básicos do pedido: número, cliente, telefone, entrega, endereço, observações, pagamento, valor, status, loja, franquia, origem e timestamps.
- Cálculo seguro do pedido no backend, sem confiar apenas no valor informado pelo navegador.
- Taxa de entrega, distância e horário operacional integrados.
- Fechamentos financeiros mensais com proteção contra pedido duplicado.
- Comissão congelada no fechamento e repasse com status `Pendente → Pago`.
- Registro de referência de pagamento e histórico financeiro.
- Múltiplos fechamentos legítimos no mesmo estabelecimento e dia suportados sem reutilizar pedidos já fechados.
- Telas financeiras de pendências, fechamento, repasses, comissão acumulada, resumo mensal, visão mensal e extrato por estabelecimento validadas.
- Auditoria operacional de pedidos, desistências e ocorrências disponível para o franqueado.
- Proteção contra página antiga/cache na homologação por controle de build e atualização de service worker.
- Trava explícita no arquivo de configuração impede usar o projeto Firebase de produção nessa camada de homologação.

## Achados da auditoria atual

- O arquivo `interfood-franquia-teste.html` é uma simulação antiga baseada em `localStorage`. Ele não faz parte do fluxo Firebase real e não deve ser usado como referência para produção.
- O checklist antigo estava desatualizado e ainda citava cliente anônimo, notificações pendentes e cálculo de preço não confiável; esses pontos já evoluíram na homologação.
- As Cloud Functions ainda usam Node.js 20. Esse runtime precisa ser atualizado antes de produção, pois está em ciclo de descontinuação.
- A homologação contém arquivos de teste e versões antigas úteis para histórico, mas eles precisam ser classificados antes da migração para evitar confusão com o fluxo oficial.

## Ainda pendente antes de migrar para produção

- Revalidar todas as Firestore Rules no emulador ou em uma bateria final de testes da homologação.
- Ativar e validar App Check nos canais públicos relevantes.
- Atualizar o runtime das Cloud Functions para uma versão suportada e repetir os testes críticos após a mudança.
- Fazer teste específico de concorrência para dois fechamentos simultâneos do mesmo conjunto de pedidos.
- Revisar rate limiting e proteção contra abuso nos endpoints HTTP públicos.
- Fazer revisão final de logs/auditoria e política de retenção de dados.
- Revisar LGPD: dados pessoais necessários, prazo de retenção, exclusão e política de privacidade.
- Fazer teste de carga básico e teste em celular nos três perfis operacionais.
- Classificar arquivos antigos/legados e impedir que páginas de simulação sejam confundidas com as telas oficiais.
- Definir quais meios de pagamento reais serão usados e integrar gateway apenas quando houver decisão comercial.
- Congelar uma versão aprovada da homologação antes da migração.
- Fazer backup/exportação da configuração de produção antes de qualquer alteração.
- Migrar configuração e regras de forma controlada, sem copiar usuários/senhas de teste.
- Executar smoke test em produção com pedido controlado antes da liberação geral.

## Regra de ouro

A homologação é a fonte de validação funcional. A produção só recebe alterações após teste completo e autorização explícita.
