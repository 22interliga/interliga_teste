const {onRequest} = require('firebase-functions/v2/https');
const {defineSecret} = require('firebase-functions/params');
const admin = require('firebase-admin');
const OpenAI = require('openai');

admin.initializeApp();
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

const ALLOWED_ORIGIN = 'https://22interliga.github.io';

function cors(req, res) {
  const origin = req.get('origin');
  if (origin === ALLOWED_ORIGIN) res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function cleanJson(text) {
  return String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
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
      const authHeader = req.get('authorization') || '';
      if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({error: 'Sessão não informada.'});
      }

      const idToken = authHeader.slice(7);
      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;

      const {franquiaId, lojaId, imageBase64} = req.body || {};
      if (!franquiaId || !lojaId || !imageBase64) {
        return res.status(400).json({error: 'Dados incompletos.'});
      }
      if (typeof imageBase64 !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/i.test(imageBase64)) {
        return res.status(400).json({error: 'Imagem inválida. Use JPG, PNG ou WEBP.'});
      }
      if (imageBase64.length > 8_000_000) {
        return res.status(413).json({error: 'Imagem muito grande. Use até aproximadamente 5 MB.'});
      }

      const vinculoRef = admin.firestore().collection('usuariosEstabelecimentos').doc(uid);
      const vinculoSnap = await vinculoRef.get();
      if (!vinculoSnap.exists) return res.status(403).json({error: 'Vínculo não encontrado.'});
      const vinculo = vinculoSnap.data() || {};
      if (vinculo.perfil !== 'estabelecimento' || vinculo.ativo !== true) {
        return res.status(403).json({error: 'Estabelecimento sem acesso ativo.'});
      }
      if (vinculo.franquiaId !== franquiaId || vinculo.lojaId !== lojaId) {
        return res.status(403).json({error: 'A loja solicitada não pertence ao usuário autenticado.'});
      }

      const lojaSnap = await admin.firestore()
        .collection('franquias').doc(franquiaId)
        .collection('estabelecimentos').doc(lojaId).get();
      if (!lojaSnap.exists || lojaSnap.data()?.ativo !== true) {
        return res.status(403).json({error: 'Loja não encontrada ou inativa.'});
      }

      const client = new OpenAI({apiKey: OPENAI_API_KEY.value()});
      const response = await client.responses.create({
        model: 'gpt-5.6-luna',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: [
                  'Analise esta imagem de cardápio de restaurante.',
                  'Extraia somente itens realmente legíveis.',
                  'Associe cada item à categoria mais provável do próprio cardápio.',
                  'Quando houver tamanho ou variação (ex.: Regular, Double, Small, Big, Full, Slice), inclua a variação no nome do produto.',
                  'Não invente preços nem nomes.',
                  'Ignore títulos decorativos, slogans e textos genéricos sem produto identificável.',
                  'Se algo estiver incerto, marque revisar=true e explique brevemente em observacao.',
                  'Converta preços para número decimal, sem símbolo de moeda.',
                  'Responda SOMENTE JSON válido no formato:',
                  '{"itens":[{"categoria":"string","nome":"string","preco":0,"descricao":"string","revisar":false,"observacao":"string"}]}',
                  'No máximo 80 itens.'
                ].join('\n')
              },
              {type: 'input_image', image_url: imageBase64}
            ]
          }
        ]
      });

      const parsed = JSON.parse(cleanJson(response.output_text));
      const rawItens = Array.isArray(parsed?.itens) ? parsed.itens : [];
      const itens = rawItens.slice(0, 80).map((x) => ({
        categoria: String(x?.categoria || 'Revisar').trim().slice(0, 100),
        nome: String(x?.nome || '').trim().slice(0, 160),
        preco: Number(x?.preco),
        descricao: String(x?.descricao || '').trim().slice(0, 500),
        revisar: x?.revisar === true,
        observacao: String(x?.observacao || '').trim().slice(0, 300),
      })).filter((x) => x.nome.length >= 2 && Number.isFinite(x.preco) && x.preco >= 0 && x.preco <= 100000);

      return res.status(200).json({itens, modelo: 'gpt-5.6-luna'});
    } catch (e) {
      console.error('analisarCardapioImagem', e);
      return res.status(500).json({error: 'Não foi possível analisar o cardápio agora.'});
    }
  }
);
