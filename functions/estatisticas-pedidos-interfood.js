const {onDocumentWritten} = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const crypto = require('crypto');

const EVENTOS_COLLECTION = 'eventosEstatisticasInterfood';
const RETENCAO_EVENTO_DIAS = 7;

function numeroSeguro(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function eventoId(eventId) {
  return crypto.createHash('sha256').update(String(eventId || '')).digest('hex');
}

function expiraEm() {
  return admin.firestore.Timestamp.fromMillis(
    Date.now() + RETENCAO_EVENTO_DIAS * 24 * 60 * 60 * 1000
  );
}

exports.atualizarEstatisticasPedidosInterfood = onDocumentWritten({
  document: 'franquias/{franquiaId}/estabelecimentos/{lojaId}/pedidos/{pedidoId}',
  region: 'southamerica-east1',
  memory: '256MiB',
  timeoutSeconds: 30,
  maxInstances: 10
}, async (event) => {
  const antes = event.data?.before?.exists ? event.data.before.data() : null;
  const depois = event.data?.after?.exists ? event.data.after.data() : null;
  const {franquiaId, lojaId} = event.params;

  const totalAntes = antes ? 1 : 0;
  const totalDepois = depois ? 1 : 0;

  const concluidoAntes = antes?.status === 'Concluído';
  const concluidoDepois = depois?.status === 'Concluído';

  const deltaTotal = totalDepois - totalAntes;
  const deltaConcluidos =
    (concluidoDepois ? 1 : 0) - (concluidoAntes ? 1 : 0);

  const valorAntes = concluidoAntes ? numeroSeguro(antes?.valor) : 0;
  const valorDepois = concluidoDepois ? numeroSeguro(depois?.valor) : 0;
  const deltaValor = valorDepois - valorAntes;

  if (deltaTotal === 0 && deltaConcluidos === 0 && deltaValor === 0) return;

  const db = admin.firestore();

  const resumoRef = db
    .collection('franquias').doc(franquiaId)
    .collection('estabelecimentos').doc(lojaId)
    .collection('estatisticas').doc('resumoPedidos');

  const eventoRef = db.collection(EVENTOS_COLLECTION).doc(eventoId(event.id));

  await db.runTransaction(async (tx) => {
    const [eventoSnap, resumoSnap] = await Promise.all([
      tx.get(eventoRef),
      tx.get(resumoRef)
    ]);

    if (eventoSnap.exists) return;

    const atual = resumoSnap.exists ? resumoSnap.data() : {};

    const totalPedidos = Math.max(
      0,
      numeroSeguro(atual.totalPedidos) + deltaTotal
    );

    const totalConcluidos = Math.max(
      0,
      numeroSeguro(atual.totalConcluidos) + deltaConcluidos
    );

    const valorConcluido = Math.max(
      0,
      Math.round(
        (numeroSeguro(atual.valorConcluido) + deltaValor) * 100
      ) / 100
    );

    tx.set(resumoRef, {
      totalPedidos,
      totalConcluidos,
      valorConcluido,
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      versao: 1
    }, {merge: true});

    tx.create(eventoRef, {
      franquiaId,
      lojaId,
      processadoEm: admin.firestore.FieldValue.serverTimestamp(),
      expiraEm: expiraEm(),
      ambiente: 'homologacao'
    });
  });
});
