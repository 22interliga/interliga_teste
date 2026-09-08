const {onRequest} = require('firebase-functions/v2/https');
const {defineSecret} = require('firebase-functions/params');
const admin = require('firebase-admin');
const base = require('./index');

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
const ALLOWED_ORIGIN = 'https://22interliga.github.io';
const RATE_COLLECTION = 'rateLimitsInterfood';
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 10;
const RATE_MIN_INTERVAL_MS = 10 * 1000;

function cors(req, res) {
  const origin = req.get('origin');
  if (origin === ALLOWED_ORIGIN) res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function erro(msg, status) {
  return Object.assign(new Error(msg), {status});
}

async function autenticarUid(req) {
  const authHeader = String(req.get('authorization') || '');
  if (!authHeader.startsWith('Bearer ')) throw erro('Sessão não informada.', 401);
  const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
  return decoded.uid;
}

async function aplicarRateLimit(uid) {
  const db = admin.firestore();
  const ref = db.collection(RATE_COLLECTION).doc('cardapioImagem_' + uid);
  const agora = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const atual = snap.exists ? (snap.data() || {}) : {};
    const inicio = Number(atual.inicioJanelaMs || 0);
    const ultimo = Number(atual.ultimoUsoMs || 0);
    const quantidadeAtual = Number(atual.quantidade || 0);
    const janelaExpirada = !inicio || (agora - inicio) >= RATE_WINDOW_MS;

    if (!janelaExpirada && ultimo && (agora - ultimo) < RATE_MIN_INTERVAL_MS) {
      const segundos = Math.max(1, Math.ceil((RATE_MIN_INTERVAL_MS - (agora - ultimo)) / 1000));
      throw erro('Aguarde ' + segundos + ' segundo(s) antes de analisar outra imagem.', 429);
    }

    const quantidade = janelaExpirada ? 0 : quantidadeAtual;
    if (quantidade >= RATE_MAX) {
      const minutos = Math.max(1, Math.ceil((RATE_WINDOW_MS - (agora - inicio)) / 60000));
      throw erro('Limite temporário de análise atingido. Tente novamente em aproximadamente ' + minutos + ' minuto(s).', 429);
    }

    tx.set(ref, {
      uid,
      recurso: 'analisarCardapioImagem',
      inicioJanelaMs: janelaExpirada ? agora : inicio,
      ultimoUsoMs: agora,
      quantidade: quantidade + 1,
      limitePorHora: RATE_MAX,
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
    }, {merge: true});

    return {quantidade: quantidade + 1, limite: RATE_MAX};
  });
}

exports.analisarCardapioImagem = onRequest(
  {
    region: 'us-central1',
    secrets: [OPENAI_API_KEY],
    timeoutSeconds: 120,
    memory: '512MiB',
    maxInstances: 5,
  },
  async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({error: 'Método não permitido.'});
    if (req.get('origin') && req.get('origin') !== ALLOWED_ORIGIN) {
      return res.status(403).json({error: 'Origem não autorizada.'});
    }

    try {
      const appCheckToken = req.get('X-Firebase-AppCheck') || '';
      if (!appCheckToken) throw erro('App Check não informado.', 401);
      await admin.appCheck().verifyToken(appCheckToken);

      const uid = await autenticarUid(req);
      const rate = await aplicarRateLimit(uid);
      res.set('X-Interfood-RateLimit-Limit', String(rate.limite));
      res.set('X-Interfood-RateLimit-Remaining', String(Math.max(0, rate.limite - rate.quantidade)));

      return base.analisarCardapioImagem(req, res);
    } catch (e) {
      const status = Number(e?.status) || 401;
      if (status === 429) {
        console.warn('RATE_LIMIT_CARDAPIO_BLOQUEADO', {erro: String(e?.message || e)});
        return res.status(429).json({error: String(e.message || 'Muitas solicitações.')});
      }
      console.warn('APPCHECK_CARDAPIO_BLOQUEADO', {erro: String(e?.message || e)});
      return res.status(status).json({error: status === 401 ? 'App Check ou sessão inválidos.' : String(e.message || 'Acesso bloqueado.')});
    }
  }
);
