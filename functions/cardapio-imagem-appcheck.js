const {onRequest} = require('firebase-functions/v2/https');
const {defineSecret} = require('firebase-functions/params');
const admin = require('firebase-admin');
const base = require('./index');

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
const ALLOWED_ORIGIN = 'https://22interliga.github.io';

function cors(req, res) {
  const origin = req.get('origin');
  if (origin === ALLOWED_ORIGIN) res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
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
      if (!appCheckToken) {
        return res.status(401).json({error: 'App Check não informado.'});
      }
      await admin.appCheck().verifyToken(appCheckToken);
      return base.analisarCardapioImagem(req, res);
    } catch (e) {
      console.warn('APPCHECK_CARDAPIO_BLOQUEADO', {erro: String(e?.message || e)});
      return res.status(401).json({error: 'App Check inválido.'});
    }
  }
);
