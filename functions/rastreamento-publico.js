'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

exports.consultarCorridaPublica = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
    maxInstances: 10
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }

    if (req.method !== 'GET') {
      return res.status(405).json({
        ok: false,
        erro: 'Metodo nao permitido.'
      });
    }

    try {
      const corridaId = String(req.query.id || '').trim();

      if (!corridaId) {
        return res.status(400).json({
          ok: false,
          erro: 'ID da corrida nao informado.'
        });
      }

      if (corridaId.length > 128) {
        return res.status(400).json({
          ok: false,
          erro: 'ID da corrida invalido.'
        });
      }

      const db = admin.firestore();
      const snap = await db.collection('corridas').doc(corridaId).get();

      if (!snap.exists) {
        return res.status(404).json({
          ok: false,
          erro: 'Corrida nao encontrada.'
        });
      }

      const c = snap.data() || {};

      /*
       * Retornar SOMENTE os dados necessários para o acompanhamento.
       * Não devolver documento completo do Firestore.
       */
      const corrida = {
        id: snap.id,
        status: c.status || null,
        origem: c.origem || null,
        destino: c.destino || null,
        motoristaLat:
          typeof c.motoristaLat === 'number' ? c.motoristaLat : null,
        motoristaLon:
          typeof c.motoristaLon === 'number' ? c.motoristaLon : null,
        motoristaNome: c.motoristaNome || null,
        motoristaVeiculo: c.motoristaVeiculo || null,
        motoristaPlaca: c.motoristaPlaca || null,
        motoristaAvaliacao:
          c.motoristaAvaliacao != null ? c.motoristaAvaliacao : null
      };

      return res.status(200).json({
        ok: true,
        corrida
      });

    } catch (erro) {
      console.error('consultarCorridaPublica', erro);

      return res.status(500).json({
        ok: false,
        erro: 'Nao foi possivel consultar a corrida agora.'
      });
    }
  }
);
