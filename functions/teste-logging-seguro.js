'use strict';

const {onRequest} = require('firebase-functions/v2/https');

exports.testarLoggingSeguroInterfood = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 15,
    memory: '128MiB',
    maxInstances: 1
  },
  async (req, res) => {
    const esperado = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
    if (esperado && esperado !== 'interliga-homologacao-eb0f2') {
      return res.status(403).json({ok:false,error:'Disponivel somente na homologacao.'});
    }

    // Dados 100% ficticios. A finalidade e validar se o sanitizador do console
    // impede que campos sensiveis cheguem em texto claro ao Cloud Logging.
    console.warn('TESTE_LOGGING_SEGURO_INTERFOOD', {
      endereco: 'Rua TESTE PRIVACIDADE 999999, Candeias - BA',
      cep: '99999999',
      telefone: '+55 71 90000-0000',
      token: 'TOKEN-FICTICIO-NAO-REAL-1234567890',
      authorization: 'Bearer TOKEN-FICTICIO',
      appCheck: 'APP-CHECK-FICTICIO',
      latitude: -12.000001,
      longitude: -38.000001,
      uidTeste: 'uid-ficticio-homologacao',
      motivo: 'validacao-controlada-cloud-logging'
    });

    return res.status(200).json({
      ok: true,
      teste: 'logging-seguro',
      mensagem: 'Evento ficticio enviado ao console para validacao.'
    });
  }
);
