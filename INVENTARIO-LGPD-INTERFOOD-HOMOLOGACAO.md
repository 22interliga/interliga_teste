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
- timestamps de criação/atualização;
- latitude e longitude quando o ponto tiver sido confirmado no mapa.

O cliente autenticado pode cadastrar, editar, definir como principal e excluir seus próprios endereços pela tela oficial de homologação.

O cálculo/validação de entrega utiliza coordenadas associadas ao endereço quando necessárias à área de atendimento. Coordenadas são dado operacional de localização e não devem ser copiadas para auditoria sem necessidade.

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

O backend oficial ativo `criarPedidoClienteSeguro` grava os pedidos em:
`franquias/{franquiaId}/estabelecimentos/{lojaId}/pedidos/{pedidoId}`.

### Campos persistidos atualmente
O documento criado pelo backend contém:
- `numero`;
- `cliente` — nome do cliente;
- `telefone` — telefone do cliente;
- `entrega`;
- `subtotalProdutos`;
- `taxaEntrega`;
- `valor`;
- `itens` — produto, nome, variação, adicionais, quantidade, valor unitário e subtotal;
- `endereco` — endereço textual validado para entrega, ou `Retirada no estabelecimento`;
- `observacoes` — texto livre do cliente, limitado no backend;
- `pagamento`;
- `status`;
- `clienteUid`;
- `franquiaId`;
- `lojaId`;
- `criadoEm`;
- `origem`;
- `calculadoNoServidor`;
- `appCheckValidado`;
- `distanciaEntregaKm`;
- `raioEntregaKm`;
- `localizacaoEntrega` — quando a entrega é Interfood, contém `enderecoId`, latitude, longitude e método de confirmação;
- `horarioValidado`;
- `fusoHorario`.

O backend não persiste o token de autenticação nem o token do App Check dentro do pedido. Esses tokens são usados somente para validação da requisição.

### Dados pessoais presentes no pedido
São dados pessoais ou potencialmente pessoais no contexto do pedido:
- nome do cliente;
- telefone;
- UID do cliente;
- endereço de entrega;
- latitude/longitude da entrega;
- observações em texto livre, que podem conter informação fornecida pelo próprio cliente;
- identificação operacional do entregador quando posteriormente atribuída.

### Minimização e retenção
O endereço e as coordenadas têm finalidade de execução/validação da entrega. O `enderecoId` mantém referência ao endereço salvo utilizado naquele pedido.

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

## 9. Cloud Logging

A homologação possui sanitização central de `console.log`, `console.warn` e `console.error` por `functions/logging-seguro.js`.

Teste controlado realizado e validado em 09/09/2026 confirmou redação dos seguintes campos antes de chegarem ao Cloud Logging:
- endereço;
- CEP;
- telefone;
- token;
- authorization;
- App Check;
- latitude;
- longitude.

No teste, esses valores apareceram como `[redigido]` no Cloud Logging.

A função temporária usada exclusivamente para essa validação foi removida após o teste. O sanitizador permanente foi mantido.

Bucket padrão de logs da homologação: `_Default`, localização `global`, retenção confirmada de 30 dias.

Essa validação não significa que nenhum identificador técnico possa aparecer em logs. UIDs, IDs de pedido, franquia/loja, status e mensagens técnicas podem continuar sendo registrados quando necessários ao diagnóstico, desde que sem inclusão desnecessária de dados pessoais em claro.

## 10. Classificação técnica atual

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
- rate limits por prazo curto;
- logs técnicos com retenção limitada e sanitização de campos sensíveis.

### Evitar sem finalidade específica
- CPF;
- RG;
- data de nascimento;
- biometria;
- fotos de documentos;
- cópia de token FCM em histórico;
- cópia de endereço/telefone/coordenadas na auditoria;
- dados sensíveis em campos livres de incidente/desistência.

## 11. Direitos do titular e processo a definir antes da produção

Antes da migração, documentar um fluxo para solicitações relacionadas a:
- confirmação e acesso aos dados;
- correção de dados cadastrais;
- exclusão/anônimização quando aplicável;
- informação sobre tratamento;
- revogação de consentimento quando a base utilizada for consentimento;
- preservação excepcional quando houver obrigação legal/contratual ou necessidade de exercício de direitos.

A exclusão da conta não deve ser implementada como exclusão cega de todo o histórico financeiro/operacional. O procedimento deverá distinguir dado cadastral eliminável, dado anonimizável e registro que precise ser preservado por fundamento aplicável.

## 12. Pendências antes da produção

1. definir política jurídica definitiva de retenção para clientes e pedidos;
2. definir processo formal de solicitação de exclusão/anônimização de conta;
3. definir política de retenção de dados de entregadores e estabelecimentos desligados;
4. revisar textos de privacidade/termos específicos do Interfood;
5. revisar campos livres para reduzir risco de inserção de dados sensíveis;
6. confirmar Storage Rules e política de arquivos/imagens;
7. manter App Check geral sem enforcement até concluir os testes previstos;
8. realizar backup antes de qualquer futura rotina de exclusão em massa;
9. exigir autorização expressa antes de copiar qualquer política de TTL/limpeza para produção.

## 13. Estado atual

- inventário técnico de cliente: revisado;
- endereços do cliente: revisados;
- entregador: revisado;
- estabelecimento: revisado;
- campos efetivamente persistidos no pedido pelo backend: revisados;
- auditoria: minimizada e com TTL técnico de homologação;
- push/rate limit: retenção técnica separada;
- Cloud Logging: sanitização validada e retenção de 30 dias confirmada;
- pedidos/financeiro: preservados, sem TTL;
- nenhuma exclusão em massa criada;
- nenhuma alteração realizada na produção.
