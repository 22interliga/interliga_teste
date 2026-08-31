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
                  'Analise esta imagem de cardápio de restaurante com atenção à organização visual e espacial.',
                  'Extraia somente itens realmente legíveis e que tenham preço associado de forma visualmente clara.',
                  'Antes de extrair, identifique os blocos/seções do cardápio e seus títulos.',
                  'Associe cada item ao título de seção visualmente mais próximo, respeitando posição, alinhamento, colunas, caixas e agrupamentos.',
                  'Nunca herde a categoria da seção anterior apenas porque ela apareceu antes no texto.',
                  'Quando um tamanho ou variação aparecer abaixo de um título de produto/seção, combine os dois no nome do produto.',
                  'Exemplos de variações: Regular, Double, Small, Big, Full, Slice.',
                  'Se SMALL e BIG estiverem dentro do bloco FRIES, os itens devem ser Fries Small e Fries Big; não os associe a Drinks só porque Drinks aparece perto.',
                  'Se REGULAR e DOUBLE estiverem dentro do bloco BURGER, os itens devem ser Burger Regular e Burger Double.',
                  'Se FULL e SLICE estiverem dentro do bloco PIZZA, os itens devem ser Pizza Full e Pizza Slice.',
                  'Não invente preços, nomes, categorias ou descrições.',
                  'Ignore títulos decorativos, slogans, textos genéricos e placeholders sem produto identificável.',
                  'Quando o produto e o preço estiverem claros, use revisar=false e deixe observacao vazia.',
                  'Quando houver dúvida real de leitura ou associação entre item, categoria e preço, use revisar=true e explique a dúvida de forma objetiva em observacao.',
                  'Não escreva observações genéricas como "a imagem mostra apenas a categoria" se o produto puder ser identificado pelo agrupamento visual.',
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
