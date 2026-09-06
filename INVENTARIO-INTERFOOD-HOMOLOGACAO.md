# Interfood — Inventário da homologação

> Escopo: repositório `22interliga/interliga_teste`, branch `main`, projeto Firebase `interliga-homologacao-eb0f2`.
> Produção `interliga-mobilidade` permanece fora deste inventário e não deve ser alterada sem autorização explícita.

## 1. Núcleo oficial atualmente usado

### Cliente
- `login-cliente-firebase-teste.html`
- `painel-cliente-interfood-homologacao.html`
- `novo-pedido-cliente-homologacao.html`
- `meus-pedidos-cliente-homologacao.html`
- `acompanhar-pedido-cliente-homologacao.html`
- `perfil-cliente-interfood-homologacao.html`
- `enderecos-cliente-interfood-homologacao.html`
- `cardapio-cliente-homologacao.html`

### Estabelecimento
- `login-estabelecimento-firebase-teste.html`
- `painel-estabelecimento-firebase-teste.html`
- `cardapio-estabelecimento-homologacao.html`
- `categorias-cardapio-estabelecimento-homologacao.html`
- `configuracao-estabelecimento-interfood-homologacao.html`
- `foto-produto-estabelecimento-homologacao.html`

### Entregador
- `login-entregador-firebase-teste.html`
- `entregador-interfood-firebase-teste.html`

### Franqueado / operação / financeiro
- `auditoria-interfood-franqueado.html`
- `financeiro-interfood-franqueado-homologacao.html`
- `pendencias-fechamento-interfood-franqueado-homologacao.html`
- `registrar-fechamento-interfood-franqueado-homologacao.html`
- `conferencia-pedidos-fechamento-interfood-homologacao.html`
- `fechamento-repasses-interfood-franqueado-homologacao.html`
- `repasses-consolidados-interfood-franqueado-homologacao.html`
- `comissao-acumulada-interfood-franqueado-homologacao.html`
- `resumo-mensal-interfood-franqueado-homologacao.html`
- `visao-geral-mensal-interfood-franqueado-homologacao.html`
- `extrato-estabelecimento-interfood-franqueado-homologacao.html`
- `configurar-comissao-interfood-franqueado-homologacao.html`
- `acessos-estabelecimentos-franqueado.html`

### Infraestrutura compartilhada
- `firebase-interfood-config-teste.js`
- `firebase-auth-interfood-teste.js`
- `interfood-homologacao-refresh.js`
- `interfood-homologacao-version.json`
- `interfood-push-homologacao.js`
- `firebase-messaging-sw.js`
- `firestore-interfood-seguranca-teste.rules`

### Cloud Functions usadas pelo fluxo oficial
- `functions/main.js`
- `functions/index.js`
- `functions/pedido-coordenadas.js`
- `functions/pedido-coordenadas-adapter.js`
- `functions/fechamentos-interfood.js`
- `functions/push-interfood.js`
- `functions/package.json`

## 2. Arquivos de diagnóstico / apoio de homologação

Estes arquivos são úteis para teste e investigação, mas não devem ser tratados como telas oficiais para o usuário final:

- `diagnostico-pedidos-estabelecimento.html`
- `diagnostico-push-interfood-homologacao.html`
- scripts `aplicar-*.py`
- `corrigir-regra-gestao-ocorrencia-franqueado.py`
- arquivos `.example.js`

Recomendação: manter na homologação, mas não incluir numa futura publicação de produção sem necessidade específica.

## 3. Legados / simulações que não representam o fluxo Firebase oficial

### Confirmado como legado
- `interfood-franquia-teste.html`
  - usa `localStorage`;
  - cria dados fictícios/semente;
  - possui financeiro e alteração de status simulados;
  - não representa o fluxo real atual no Firestore.

### Versões antigas do entregador
- `entregador-interfood-teste.html`
- `entregador-interfood-v2-teste.html`

O painel atualmente usado e validado é `entregador-interfood-firebase-teste.html`.

Esses arquivos não foram apagados. Devem permanecer apenas como histórico até uma limpeza posterior explicitamente autorizada.

## 4. Achado crítico da auditoria: `firebase.json`

O arquivo `firebase.json` aponta atualmente para:

- `firestore.rules`
- `storage.rules`

Esses dois arquivos não existem na raiz atual do repositório.

A regra Firestore que existe e vem sendo trabalhada no Interfood é:

- `firestore-interfood-seguranca-teste.rules`

Consequência: um comando genérico como `firebase deploy --only firestore:rules` usando o `firebase.json` atual pode falhar ou não usar a regra esperada. Não corrigir isso de forma automática sem antes decidir também como o Storage deve ser configurado, porque o `storage.rules` referenciado também não existe.

## 5. Achado de runtime

As Functions continuam configuradas em Node.js 20 tanto em `functions/package.json` quanto em `firebase.json`. Atualizar o runtime é pendência obrigatória antes de produção, seguida de nova bateria de testes.

## 6. Regras para futura migração

- Migrar somente o núcleo oficial acima.
- Não copiar arquivos de simulação/diagnóstico como páginas públicas de produção.
- Revisar `firebase.json` antes de qualquer deploy amplo.
- Confirmar arquivo oficial de Firestore Rules e criar/definir a política oficial de Storage Rules.
- Atualizar runtime Node antes de produção.
- Congelar commit aprovado da homologação antes de qualquer migração.
- Executar smoke test controlado após a migração.

## 7. Situação desta auditoria

- Nenhum arquivo legado foi apagado.
- Nenhuma alteração foi feita na produção.
- Este documento serve como mapa para separar o que é oficial, apoio de teste e histórico/legado.
