const {onDocumentWritten} = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const crypto = require('crypto');

const COLECAO_AUDITORIA = 'auditoriaInterfood';
const RETENCAO_DIAS_HOMOLOGACAO = 365;

function valorSeguro(v, max = 160) {
  if (v === undefined || v === null) return null;
  return String(v).slice(0, max);
}

function mudou(a, b, campo) {
  return JSON.stringify(a?.[campo] ?? null) !== JSON.stringify(b?.[campo] ?? null);
}

function eventoId(eventId, sufixo) {
  return crypto.createHash('sha256').update(String(eventId || '') + '|' + sufixo).digest('hex');
}

function expiraEm() {
  return admin.firestore.Timestamp.fromMillis(Date.now() + RETENCAO_DIAS_HOMOLOGACAO * 24 * 60 * 60 * 1000);
}

async function gravar(eventId, sufixo, dados) {
  const id = eventoId(eventId, sufixo);
  await admin.firestore().collection(COLECAO_AUDITORIA).doc(id).set({
    ...dados,
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    expiraEm: expiraEm(),
    ambiente: 'homologacao',
    versaoAuditoria: 1
  }, {merge: false});
}

function inferirAtorPedido(antes, depois) {
  if (depois?.canceladoPor) return {uid: valorSeguro(depois.canceladoPor), perfil: 'cancelamento'};
  if (depois?.incidenteEntrega?.uid) return {uid: valorSeguro(depois.incidenteEntrega.uid), perfil: 'entregador'};
  if (depois?.entregador?.uid && antes?.status !== depois?.status) return {uid: valorSeguro(depois.entregador.uid), perfil: 'entregador'};
  return {uid: null, perfil: 'nao-identificado-no-evento'};
}

exports.auditarPedidoInterfood = onDocumentWritten({
  document: 'franquias/{franquiaId}/estabelecimentos/{lojaId}/pedidos/{pedidoId}',
  region: 'southamerica-east1',
  memory: '256MiB',
  timeoutSeconds: 30,
  maxInstances: 10
}, async (event) => {
  const antes = event.data?.before?.exists ? event.data.before.data() : null;
  const depois = event.data?.after?.exists ? event.data.after.data() : null;
  const {franquiaId, lojaId, pedidoId} = event.params;

  if (!depois) return;

  const numero = valorSeguro(depois.numero || antes?.numero || pedidoId, 80);
  const base = {
    entidade: 'pedido',
    entidadeId: pedidoId,
    numero,
    franquiaId: valorSeguro(franquiaId, 120),
    lojaId: valorSeguro(lojaId, 120)
  };

  if (!antes) {
    await gravar(event.id, 'pedido-criado', {
      ...base,
      acao: 'pedido_criado',
      statusAnterior: null,
      statusNovo: valorSeguro(depois.status, 80),
      atorUid: valorSeguro(depois.clienteUid),
      atorPerfil: 'cliente'
    });
    return;
  }

  const tarefas = [];
  if (mudou(antes, depois, 'status')) {
    const ator = inferirAtorPedido(antes, depois);
    tarefas.push(gravar(event.id, 'status', {
      ...base,
      acao: 'status_alterado',
      statusAnterior: valorSeguro(antes.status, 80),
      statusNovo: valorSeguro(depois.status, 80),
      atorUid: ator.uid,
      atorPerfil: ator.perfil
    }));
  }

  if (mudou(antes, depois, 'motivoDesistenciaEntrega')) {
    tarefas.push(gravar(event.id, 'desistencia', {
      ...base,
      acao: 'entrega_desistencia_registrada',
      statusAnterior: valorSeguro(antes.status, 80),
      statusNovo: valorSeguro(depois.status, 80),
      atorUid: valorSeguro(antes?.entregador?.uid || depois?.entregador?.uid),
      atorPerfil: 'entregador'
    }));
  }

  if (mudou(antes, depois, 'incidenteEntrega')) {
    tarefas.push(gravar(event.id, 'incidente', {
      ...base,
      acao: 'entrega_incidente_registrado',
      statusAnterior: valorSeguro(antes.status, 80),
      statusNovo: valorSeguro(depois.status, 80),
      atorUid: valorSeguro(depois?.incidenteEntrega?.uid),
      atorPerfil: 'entregador'
    }));
  }

  if (mudou(antes, depois, 'gestaoOcorrencia')) {
    tarefas.push(gravar(event.id, 'gestao-ocorrencia', {
      ...base,
      acao: 'ocorrencia_gestao_atualizada',
      statusAnterior: valorSeguro(antes?.gestaoOcorrencia?.status, 80),
      statusNovo: valorSeguro(depois?.gestaoOcorrencia?.status, 80),
      atorUid: valorSeguro(depois?.gestaoOcorrencia?.franqueadoUid),
      atorPerfil: 'franqueado'
    }));
  }

  await Promise.all(tarefas);
});

exports.auditarFechamentoInterfood = onDocumentWritten({
  document: 'franquias/{franquiaId}/fechamentosInterfood/{fechamentoId}',
  region: 'southamerica-east1',
  memory: '256MiB',
  timeoutSeconds: 30,
  maxInstances: 10
}, async (event) => {
  const antes = event.data?.before?.exists ? event.data.before.data() : null;
  const depois = event.data?.after?.exists ? event.data.after.data() : null;
  const {franquiaId, fechamentoId} = event.params;
  if (!depois) return;

  const base = {
    entidade: 'fechamento',
    entidadeId: fechamentoId,
    franquiaId: valorSeguro(franquiaId, 120),
    lojaId: valorSeguro(depois.lojaId || antes?.lojaId, 120)
  };

  if (!antes) {
    await gravar(event.id, 'fechamento-criado', {
      ...base,
      acao: 'fechamento_criado',
      statusAnterior: null,
      statusNovo: valorSeguro(depois.status, 80),
      atorUid: valorSeguro(depois.criadoPor),
      atorPerfil: 'franqueado'
    });
    return;
  }

  if (mudou(antes, depois, 'status')) {
    await gravar(event.id, 'fechamento-status', {
      ...base,
      acao: depois.status === 'Pago' ? 'fechamento_marcado_pago' : 'fechamento_status_alterado',
      statusAnterior: valorSeguro(antes.status, 80),
      statusNovo: valorSeguro(depois.status, 80),
      atorUid: valorSeguro(depois.pagoPor || depois.criadoPor),
      atorPerfil: 'franqueado',
      referenciaPagamento: depois.status === 'Pago' ? valorSeguro(depois.referenciaPagamento, 120) : null
    });
  }
});
