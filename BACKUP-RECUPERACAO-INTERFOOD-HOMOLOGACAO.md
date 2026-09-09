# Backup e recuperação — Interfood Homologação

## Objetivo
Definir um procedimento seguro de backup e recuperação para o ambiente de homologação do Interfood antes de qualquer migração ou mudança estrutural relevante.

## Princípios
- Produção não deve ser alterada nesta etapa.
- Nenhum restore deve ser executado diretamente sobre a base ativa sem validação prévia.
- Sempre registrar a data/hora do backup e o projeto de origem.
- Preferir exportação completa do Firestore para um bucket dedicado à homologação.
- Antes de uma migração para produção, gerar um backup imediatamente anterior à mudança.

## Escopo do backup
O backup deve incluir o Firestore do projeto `interliga-homologacao-eb0f2`, incluindo:
- franquias;
- estabelecimentos;
- pedidos;
- fechamentos financeiros;
- clientes;
- perfis de usuários;
- auditoria;
- tokens e dados auxiliares, quando existentes no momento da exportação.

## O que não é substituído pelo backup do Firestore
A exportação do Firestore não substitui o versionamento do código no GitHub, as regras do Firestore, as Cloud Functions, configurações de App Check e demais configurações de infraestrutura. Esses itens devem continuar versionados/documentados separadamente.

## Procedimento seguro
1. Confirmar o projeto ativo como `interliga-homologacao-eb0f2`.
2. Identificar um bucket Cloud Storage pertencente à homologação ou criar um bucket dedicado.
3. Executar exportação completa do Firestore para um prefixo com data/hora.
4. Aguardar conclusão da operação.
5. Conferir se os arquivos de exportação foram gravados no bucket.
6. Registrar o caminho exato do backup neste documento ou no checklist da migração.
7. Não executar import/restore na base ativa apenas para teste.

## Recuperação
Em caso de necessidade de recuperação:
1. interromper alterações operacionais relevantes;
2. identificar o backup correto;
3. confirmar projeto de destino;
4. preferir validar a recuperação em ambiente isolado quando possível;
5. somente importar para uma base ativa após autorização expressa;
6. validar pedidos, fechamentos, permissões e auditoria após a recuperação.

## Antes da migração para produção
- criar backup da produção imediatamente antes da migração;
- criar backup final da homologação validada;
- registrar commits GitHub da versão aprovada;
- registrar regras Firestore e funções implantadas;
- validar um plano de rollback;
- não ativar políticas de exclusão/TTL de produção sem aprovação específica.

## Estado atual
Este documento define o procedimento. O próximo passo é identificar os buckets disponíveis no projeto de homologação antes de executar qualquer exportação real.
