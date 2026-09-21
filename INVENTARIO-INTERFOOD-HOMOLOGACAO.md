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

### Entregador / Motorista integrado
- O fluxo oficial de entregas Interfood foi integrado à Intermobilidade.
- Tela atualmente usada e validada: `motorista-homologacao.html?abrir=entregas`
- `entregador-interfood-firebase-teste.html` permanece apenas como versão anterior/histórica e não deve ser tratado como módulo oficial atual.

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

O fluxo atualmente usado e validado é o módulo integrado da Intermobilidade:
`motorista-homologacao.html?abrir=entregas`.

Esses arquivos não foram apagados. Devem permanecer apenas como histórico até uma limpeza posterior explicitamente autorizada.

## 4. Estado atual validado do `firebase.json` e Rules

Auditoria atualizada em 21/09/2026:

- `firebase.json` referencia `firestore.rules` e `storage.rules`.
- Ambos os arquivos existem na raiz e estão versionados.
- `firestore.rules` é a regra principal consolidada da homologação e contém a evolução das regras do Interfood e da integração com a Mobilidade.
- Não substituir `firestore.rules` pelos arquivos auxiliares `firestore-interfood-*.rules`.
- `storage.rules` é a regra ativa/versionada do Firebase Storage da homologação.
- Não substituir automaticamente `storage.rules` por `storage-interfood-seguranca-teste.rules`.
- Qualquer alteração futura de Rules deve ser diagnosticada e validada antes de deploy.

## 5. Runtime atual

Auditoria atualizada em 21/09/2026:

- `firebase.json` está configurado com runtime `nodejs22`.
- A antiga observação sobre Node.js 20 está superada.
- Antes de futura migração para produção, confirmar novamente a versão suportada e executar bateria de testes.

## 6. Regras para futura migração

- Migrar somente o núcleo oficial acima.
- Não copiar arquivos de simulação/diagnóstico como páginas públicas de produção.
- Revisar `firebase.json` antes de qualquer deploy amplo.
- Preservar `firestore.rules` e `storage.rules` como referências ativas da homologação e revisar qualquer diferença necessária antes da migração.
- Revalidar o runtime Node suportado pelo Firebase no momento da migração; atualmente a homologação usa `nodejs22`.
- Congelar commit aprovado da homologação antes de qualquer migração.
- Executar smoke test controlado após a migração.

## 7. Situação desta auditoria

- Nenhum arquivo legado foi apagado.
- Nenhuma alteração foi feita na produção.
- Este documento serve como mapa para separar o que é oficial, apoio de teste e histórico/legado.
