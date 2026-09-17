'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

const ALLOWED_ORIGINS = new Set([
  'https://22interliga.github.io',
  'https://interliga-homologacao-eb0f2.web.app'
]);

function erro(mensagem, status = 400) {
  return Object.assign(new Error(mensagem), { status });
}

function cors(req, res) {
  const origin = req.get('origin');

  if (ALLOWED_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  }

  res.set('Vary', 'Origin');
  res.set(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Firebase-AppCheck'
  );
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

async function autenticar(req) {
  const h = String(req.get('authorization') || '');

  if (!h.startsWith('Bearer ')) {
    throw erro('Sessao nao informada.', 401);
  }

  return admin.auth().verifyIdToken(h.slice(7));
}

exports.enviarAvaliacaoMobilidade = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
    maxInstances: 10
  },
  async (req, res) => {
    cors(req, res);

    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }

    if (req.method !== 'POST') {
      return res.status(405).json({
        ok: false,
        erro: 'Metodo nao permitido.'
      });
    }

    const origin = req.get('origin');

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return res.status(403).json({
        ok: false,
        erro: 'Origem nao autorizada.'
      });
    }

    try {
      const decoded = await autenticar(req);
      const uid = decoded.uid;
      const body = req.body || {};

      const corridaId = String(body.corridaId || '').trim();
      const tipo = String(body.tipo || '').trim();
      const paraId = String(body.paraId || '').trim();
      const comentario = String(body.comentario || '').trim();
      const nota = Number(body.nota);

      if (!corridaId || corridaId.length > 128) {
        throw erro('Corrida invalida.');
      }

      if (!['motorista', 'passageiro'].includes(tipo)) {
        throw erro('Tipo de avaliacao invalido.');
      }

      if (!paraId || paraId.length > 128) {
        throw erro('Usuario avaliado invalido.');
      }

      if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
        throw erro('Nota deve ser um numero inteiro entre 1 e 5.');
      }

      if (comentario.length > 1000) {
        throw erro('Comentario excede o limite permitido.');
      }

      const db = admin.firestore();
      const corridaRef = db.collection('corridas').doc(corridaId);
      const corridaSnap = await corridaRef.get();

      if (!corridaSnap.exists) {
        throw erro('Corrida nao encontrada.', 404);
      }

      const corrida = corridaSnap.data() || {};

      if (corrida.status !== 'finalizada') {
        throw erro('A corrida precisa estar finalizada.', 409);
      }

      const passageiroId = String(corrida.passageiroId || '');
      const motoristaId = String(corrida.motoristaId || '');

      let esperadoParaId;
      let colecaoDestino;

      if (uid === passageiroId) {
        if (tipo !== 'motorista') {
          throw erro('Passageiro somente pode avaliar o motorista.', 403);
        }

        esperadoParaId = motoristaId;
        colecaoDestino = 'motoristas';

      } else if (uid === motoristaId) {
        if (tipo !== 'passageiro') {
          throw erro('Motorista somente pode avaliar o passageiro.', 403);
        }

        esperadoParaId = passageiroId;
        colecaoDestino = 'passageiros';

      } else {
        throw erro('Usuario nao participa desta corrida.', 403);
      }

      if (!esperadoParaId || paraId !== esperadoParaId) {
        throw erro('Usuario avaliado nao corresponde a corrida.', 403);
      }

      /*
       * ID deterministico:
       * uma avaliacao por avaliador por corrida.
       * Evita duplicidade mesmo com clique repetido/retry.
       */
      const avaliacaoId = `${corridaId}_${uid}`;
      const avaliacaoRef = db.collection('avaliacoes').doc(avaliacaoId);
      const destinoRef = db.collection(colecaoDestino).doc(paraId);

      await db.runTransaction(async (tx) => {
        const [avaliacaoSnap, destinoSnap] = await Promise.all([
          tx.get(avaliacaoRef),
          tx.get(destinoRef)
        ]);

        if (avaliacaoSnap.exists) {
          throw erro('Esta corrida ja foi avaliada por este usuario.', 409);
        }

        if (!destinoSnap.exists) {
          throw erro('Perfil avaliado nao encontrado.', 404);
        }

        const dados = destinoSnap.data() || {};
        const totalAtual = Number(dados.totalAvaliacoes || 0);
        const somaAtual = Number(dados.somaAvaliacoes || 0);

        if (
          !Number.isInteger(totalAtual) ||
          totalAtual < 0 ||
          !Number.isFinite(somaAtual) ||
          somaAtual < 0 ||
          somaAtual > totalAtual * 5
        ) {
          throw erro('Dados de avaliacao do perfil estao inconsistentes.', 409);
        }

        const novoTotal = totalAtual + 1;
        const novaSoma = somaAtual + nota;
        const novaMedia = Number((novaSoma / novoTotal).toFixed(1));

        tx.create(avaliacaoRef, {
          corridaId,
          tipo,
          paraId,
          deId: uid,
          nota,
          comentario,
          criadoEm: admin.firestore.FieldValue.serverTimestamp()
        });

        tx.update(destinoRef, {
          totalAvaliacoes: novoTotal,
          somaAvaliacoes: novaSoma,
          avaliacao: novaMedia
        });
      });

      return res.status(200).json({
        ok: true
      });

    } catch (e) {
      console.error(
        'enviarAvaliacaoMobilidade',
        e?.code || e?.message || e
      );

      const status = Number(e?.status) || 500;

      return res.status(status).json({
        ok: false,
        erro:
          status >= 500
            ? 'Nao foi possivel enviar a avaliacao agora.'
            : String(e.message || e)
      });
    }
  }
);
