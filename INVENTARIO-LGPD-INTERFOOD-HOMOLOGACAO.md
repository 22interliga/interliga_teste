# Inventário LGPD — Interfood Homologação

> Escopo técnico: `22interliga/interliga_teste`, branch `main`, Firebase `interliga-homologacao-eb0f2`.
> Este documento é um inventário técnico de minimização e retenção. Não substitui análise jurídica nem define automaticamente a política da produção.
> Produção `interliga-mobilidade` permanece sem alteração.

## 1. Princípios adotados

- coletar apenas dados necessários para cadastro, pedido, entrega, segurança e financeiro;
- não adicionar CPF, RG, data de nascimento, documento, biometria ou outros dados sem finalidade operacional/legal definida;
- evitar duplicação de dados pessoais em auditoria e coleções técnicas;
- preservar registros originais de negócio/financeiro até existir política formal de retenção;
- permitir controle do titular sobre dados editáveis quando isso não comprometer registros que precisem ser preservados;
- separar dados pessoais, dados de negócio, auditoria, push e rate limit.

## 2. Cliente

### Perfil e pedido
Dados utilizados pelo fluxo atual:
- UID Firebase;
- nome;
- telefone;
- perfil/situação de acesso;
- vínculo do pedido com a conta autenticada.

Finalidade técnica: identificar o cliente, permitir contato relacionado ao pedido e vincular corretamente pedidos à conta.

### Endereços salvos
A subcoleção `clientes/{uid}/enderecos` pode conter:
- apelido do endereço;
- CEP;
- logradouro/número informado no campo de endereço;
- bairro;
- cidade;
- UF;
- complemento;
- indicador de endereço principal;
- timestamps de criação/atualização.

O cliente autenticado pode cadastrar, editar, definir como principal e excluir seus próprios endereços pela tela oficial de homologação.

O cálculo/validação de entrega pode utilizar coordenadas associadas ao endereço/pedido quando necessárias à rota e à área de atendimento. Coordenadas devem ser tratadas como dado operacional de localização e não devem ser copiadas para auditoria sem necessidade.

### Minimização
No módulo de endereço analisado não há necessidade técnica identificada de CPF, RG ou data de nascimento. Não adicionar esses campos sem finalidade aprovada.

## 3. Entregador

O fluxo oficial usa `usuariosEntregadores/{uid}` para validar o acesso.

Dados operacionais observados:
- UID Firebase;
- nome;
- perfil `entregador`;
- situação ativo/inativo;
- `franquiaId`;
- veículo;
- placa.

Ao aceitar uma entrega, o pedido recebe a identificação operacional do entregador necessária para atribuição da corrida: UID, nome, veículo e placa.

Também podem existir no pedido:
- motivo de desistência da entrega;
- timestamp da desistência;
- incidente/problema reportado;
- UID/nome do entregador que reportou;
- status do pedido no momento do incidente;
- timestamp do incidente.

Motivos e incidentes devem conter apenas informação necessária ao tratamento operacional. Evitar inserir documentos pessoais ou informações sensíveis em campos de texto livre.

Não foi identificada necessidade, neste fluxo operacional analisado, de acrescentar CPF, RG, CNH, foto de documento ou data de nascimento. Caso algum desses dados venha a ser necessário por obrigação contratual/legal, deverá ter finalidade, acesso, retenção e proteção definidos separadamente antes da implementação.

## 4. Estabelecimento

O acesso é validado por `usuariosEstabelecimentos/{uid}` e pelo vínculo com `franquiaId` e `lojaId`.

A configuração operacional da loja contém atualmente:
- nome da loja;
- categoria;
- telefone da loja;
- endereço da loja;
- horário de abertura;
- horário de fechamento;
- taxa de entrega;
- raio de entrega;
- situação `aceitandoPedidos`;
- timestamp de atualização operacional.

Esses dados têm finalidade operacional/comercial. Telefone e endereço podem identificar também uma pessoa quando utilizados por estabelecimento individual; portanto devem continuar protegidos pelas regras de acesso aplicáveis.

A tela oficial limita alteração à própria loja autenticada e relê o documento do servidor após a gravação.

## 5. Pedidos

Pedidos são registros de negócio. Podem reunir dados necessários para execução e comprovação da operação, como:
- cliente/vínculo do cliente;
- endereço de entrega;
- itens e valores;
- estabelecimento;
- status e timestamps;
- entregador atribuído;
- dados operacionais de entrega/incidentes.

Pedidos não participam da rotina automática `limparDadosAuxiliaresInterfood` e não possuem TTL nesta etapa.

Antes de produção deve ser definida política formal para retenção/anônimização de dados pessoais em pedidos, considerando obrigações contratuais, financeiras, fiscais, defesa de direitos e solicitações do titular. Não aplicar exclusão automática em homologação como se fosse uma decisão jurídica definitiva.

## 6. Auditoria

`auditoriaInterfood` é propositalmente minimizada.

Pode registrar:
- entidade/ação;
- IDs técnicos;
- franquia/loja;
- status anterior/novo;
- UID/perfil do responsável quando disponível;
- referência de pagamento quando aplicável;
- timestamps.

Não deve duplicar:
- endereço do cliente;
- telefone;
- conteúdo integral do pedido;
- token FCM;
- coordenadas de entrega;
- documentos pessoais desnecessários.

Retenção técnica atual somente na homologação: 365 dias via `expiraEm`/TTL.

## 7. Push e dados técnicos

### `pushTokensInterfood`
Finalidade exclusiva: notificações push.

Política técnica atual de homologação:
- ativo sem atualização por 90 dias: desativar;
- inativo por mais de 30 dias: excluir.

Tokens não devem ser copiados para auditoria ou pedidos.

### `rateLimitsInterfood`
Finalidade: proteção contra abuso/rate limiting.

Política atual: remoção após 48 horas pela rotina de limpeza de dados auxiliares.

## 8. Financeiro e fechamentos

Fechamentos, comissões congeladas, repasses, situação Pendente/Pago e referências de pagamento são registros de negócio/financeiro.

Não possuem TTL nesta etapa e não entram na limpeza técnica automática. A retenção definitiva deve ser definida antes da produção conforme necessidades contratuais, fiscais, contábeis e de defesa de direitos.

## 9. Classificação técnica atual

### Necessário para operação
- identificação básica do cliente;
- contato do cliente relacionado ao pedido;
- endereço/localização necessária à entrega;
- identificação operacional do entregador;
- veículo/placa para operação de entrega;
- identificação e dados operacionais da loja;
- pedido, status e timestamps.

### Necessário para segurança/rastreabilidade
- UID/perfil dos atores quando disponível;
- auditoria minimizada;
- incidentes/desistências necessários ao tratamento operacional;
- tokens push enquanto tecnicamente úteis;
- rate limits por prazo curto.

### Evitar sem finalidade específica
- CPF;
- RG;
- data de nascimento;
- biometria;
- fotos de documentos;
- cópia de token FCM em histórico;
- cópia de endereço/telefone/coordenadas na auditoria;
- dados sensíveis em campos livres de incidente/desistência.

## 10. Direitos do titular e processo a definir antes da produção

Antes da migração, documentar um fluxo para solicitações relacionadas a:
- confirmação e acesso aos dados;
- correção de dados cadastrais;
- exclusão/anônimização quando aplicável;
- informação sobre tratamento;
- revogação de consentimento quando a base utilizada for consentimento;
- preservação excepcional quando houver obrigação legal/contratual ou necessidade de exercício de direitos.

A exclusão da conta não deve ser implementada como exclusão cega de todo o histórico financeiro/operacional. O procedimento deverá distinguir dado cadastral eliminável, dado anonimizável e registro que precise ser preservado por fundamento aplicável.

## 11. Pendências antes da produção

1. definir política jurídica definitiva de retenção para clientes e pedidos;
2. definir processo formal de solicitação de exclusão/anônimização de conta;
3. definir política de retenção de dados de entregadores e estabelecimentos desligados;
4. revisar textos de privacidade/termos específicos do Interfood;
5. revisar campos livres para reduzir risco de inserção de dados sensíveis;
6. revisar Cloud Logging separadamente do Firestore;
7. confirmar Storage Rules e política de arquivos/imagens;
8. manter App Check geral sem enforcement até concluir os testes previstos;
9. realizar backup antes de qualquer futura rotina de exclusão em massa;
10. exigir autorização expressa antes de copiar qualquer política de TTL/limpeza para produção.

## 12. Estado atual

- inventário técnico de cliente: revisado;
- endereços do cliente: revisados;
- entregador: revisado;
- estabelecimento: revisado;
- auditoria: minimizada e com TTL técnico de homologação;
- push/rate limit: retenção técnica separada;
- pedidos/financeiro: preservados, sem TTL;
- nenhuma exclusão em massa criada;
- nenhuma alteração realizada na produção.
