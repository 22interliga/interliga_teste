const {onSchedule} = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

const PUSH_COLLECTION = 'pushTokensInterfood';
const RATE_COLLECTION = 'rateLimitsInterfood';
const TOKEN_ATIVO_MAX_DIAS = 90;
const TOKEN_INATIVO_RETENCAO_DIAS = 30;
const RATE_RETENCAO_HORAS = 48;
const LIMITE_DOCS_POR_EXECUCAO = 1000;

function millis(v) {
  try {
    if (v && typeof v.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
  } catch (_) {}
  return 0;
}

async function limparPush(db, agora) {
  const snap = await db.collection(PUSH_COLLECTION).limit(LIMITE_DOCS_POR_EXECUCAO).get();
  const limiteAtivo = agora - TOKEN_ATIVO_MAX_DIAS * 24 * 60 * 60 * 1000;
  const limiteInativo = agora - TOKEN_INATIVO_RETENCAO_DIAS * 24 * 60 * 60 * 1000;

  let desativados = 0;
  let removidos = 0;
  let batch = db.batch();
  let ops = 0;

  async function flush() {
    if (!ops) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  }

  for (const d of snap.docs) {
    const x = d.data() || {};
    const atualizado = millis(x.atualizadoEm);
    const desativado = millis(x.desativadoEm);

    if (x.ativo === true && atualizado && atualizado < limiteAtivo) {
      batch.set(d.ref, {
        ativo: false,
        motivoDesativacao: 'expirado_' + TOKEN_ATIVO_MAX_DIAS + '_dias_agendado',
        desativadoEm: admin.firestore.FieldValue.serverTimestamp(),
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
      }, {merge: true});
      ops++;
      desativados++;
    } else if (x.ativo === false) {
      const base = desativado || atualizado;
      if (base && base < limiteInativo) {
        batch.delete(d.ref);
        ops++;
        removidos++;
      }
    }

    if (ops >= 400) await flush();
  }

  await flush();
  return {lidos: snap.size, desativados, removidos};
}

async function limparRateLimits(db, agora) {
  const snap = await db.collection(RATE_COLLECTION).limit(LIMITE_DOCS_POR_EXECUCAO).get();
  const limite = agora - RATE_RETENCAO_HORAS * 60 * 60 * 1000;
  let removidos = 0;
  let batch = db.batch();
  let ops = 0;

  async function flush() {
    if (!ops) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  }

  for (const d of snap.docs) {
    const x = d.data() || {};
    const atualizado = millis(x.atualizadoEm);
    if (atualizado && atualizado < limite) {
      batch.delete(d.ref);
      ops++;
      removidos++;
    }
    if (ops >= 400) await flush();
  }

  await flush();
  return {lidos: snap.size, removidos};
}

exports.limparDadosAuxiliaresInterfood = onSchedule({
  schedule: '0 4 * * *',
  timeZone: 'America/Sao_Paulo',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 120,
  maxInstances: 1
}, async () => {
  const db = admin.firestore();
  const agora = Date.now();
  const [push, rate] = await Promise.all([
    limparPush(db, agora),
    limparRateLimits(db, agora)
  ]);
  console.log('LIMPEZA_DADOS_AUXILIARES_INTERFOOD', {
    ambiente: 'homologacao',
    push,
    rate,
    politica: {
      tokenAtivoMaxDias: TOKEN_ATIVO_MAX_DIAS,
      tokenInativoRetencaoDias: TOKEN_INATIVO_RETENCAO_DIAS,
      rateRetencaoHoras: RATE_RETENCAO_HORAS
    }
  });
});
