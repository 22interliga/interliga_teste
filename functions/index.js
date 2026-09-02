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

async function autenticarCliente(req) {
  const authHeader = req.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) throw Object.assign(new Error('Sessão não informada.'), {status: 401});
  const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
  const perfilSnap = await admin.firestore().collection('clientes').doc(decoded.uid).get();
  if (!perfilSnap.exists) throw Object.assign(new Error('Perfil do cliente não encontrado.'), {status: 403});
  const perfil = perfilSnap.data() || {};
  if (perfil.perfil !== 'cliente' || perfil.ativo !== true) throw Object.assign(new Error('Cliente sem acesso ativo.'), {status: 403});
  return {uid: decoded.uid, perfil};
}

function normalizarEnderecoBusca(endereco) {
  return String(endereco || '')
    .replace(/\s*[-–—]\s*/g, ', ')
    .replace(/\s*\/\s*/g, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/,+/g, ',')
    .trim()
    .replace(/^,|,$/g, '')
    .trim();
}

function extrairCep(endereco) {
  const texto = String(endereco || '');
  const aposCep = texto.match(/\bcep\b\s*[:.-]?\s*([\d\s.,-]{8,14})/i);
  if (aposCep) {
    const digitos = aposCep[1].replace(/\D/g, '').slice(0, 8);
    if (digitos.length === 8) return digitos;
  }
  const candidatos = texto.match(/\d[\d\s.,-]{6,12}\d/g) || [];
  for (const candidato of candidatos.reverse()) {
    const digitos = candidato.replace(/\D/g, '');
    if (digitos.length === 8) return digitos;
  }
  return '';
}

function extrairNumero(endereco) {
  const base = normalizarEnderecoBusca(endereco);
  const primeiraParte = base.split(',')[0] || '';
  const match = primeiraParte.match(/\b(\d{1,6}[a-zA-Z]?)\b(?!.*\b\d{1,6}[a-zA-Z]?\b)/);
  return match ? match[1] : '';
}

function variantesEndereco(endereco) {
  const base = normalizarEnderecoBusca(endereco);
  const semComplemento = base
    .replace(/,?\s*(ap(?:to|artamento)?|bloco|casa|fundos|loja|sala)\s*[\w-]+.*$/i, '')
    .trim();
  const semNumero = semComplemento
    .replace(/\b(n[ºo°.]?\s*)?\d+[a-zA-Z]?\b(?=\s*,)/i, '')
    .replace(/,\s*,/g, ',')
    .replace(/\s+,/g, ',')
    .trim();

  const candidatas = [
    base,
    `${base}, Brasil`,
    semComplemento,
    `${semComplemento}, Brasil`,
    semNumero,
    `${semNumero}, Brasil`
  ];

  return [...new Set(candidatas.map(x => normalizarEnderecoBusca(x)).filter(x => x.length >= 6))];
}

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function consultarViaCep(cep, numero) {
  if (!/^\d{8}$/.test(cep)) return [];
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      headers: {'User-Agent': 'Interliga-Homologacao/1.0'}
    });
    if (!r.ok) return [];
    const d = await r.json();
    if (!d || d.erro === true) return [];

    const rua = String(d.logradouro || '').trim();
    const bairro = String(d.bairro || '').trim();
    const cidade = String(d.localidade || '').trim();
    const uf = String(d.uf || '').trim();
    const cepFmt = String(d.cep || cep).trim();
    const base = [rua, bairro, cidade, uf, cepFmt, 'Brasil'].filter(Boolean).join(', ');
    const comNumero = rua && numero
      ? [rua + ', ' + numero, bairro, cidade, uf, cepFmt, 'Brasil'].filter(Boolean).join(', ')
      : '';
    const cepCidade = [cepFmt, cidade, uf, 'Brasil'].filter(Boolean).join(', ');
    return [...new Set([comNumero, base, cepCidade].filter(Boolean).map(normalizarEnderecoBusca))];
  } catch (e) {
    console.warn('ViaCEP indisponivel', {cep, erro: String(e?.message || e)});
    return [];
  }
}

async function geocodificarEndereco(endereco, origem) {
  const rotulo = origem === 'loja' ? 'da loja' : 'do cliente';
  const cep = extrairCep(endereco);
  const numero = extrairNumero(endereco);
  const viaCep = cep ? await consultarViaCep(cep, numero) : [];
  const tentativas = [...new Set([...viaCep, ...variantesEndereco(endereco)])];

  if (!tentativas.length) {
    throw Object.assign(new Error(`Endereço ${rotulo} insuficiente para validação.`), {status: 400});
  }

  let ultimoStatus = null;
  for (let i = 0; i < tentativas.length; i++) {
    if (i > 0) await esperar(1100);
    const q = tentativas[i];
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&countrycodes=br&q=' + encodeURIComponent(q);
    let r;
    try {
      r = await fetch(url, {
        headers: {
          'User-Agent': 'Interliga-Homologacao/1.0',
          'Accept-Language': 'pt-BR,pt;q=0.9'
        }
      });
    } catch (e) {
      console.error('Falha de rede no geocodificador', origem, q, e);
      throw Object.assign(new Error(`Serviço de localização indisponível ao validar o endereço ${rotulo}.`), {status: 503});
    }

    ultimoStatus = r.status;
    if (r.status === 429) {
      throw Object.assign(new Error('Serviço de localização temporariamente ocupado. Aguarde alguns segundos e tente novamente.'), {status: 503});
    }
    if (!r.ok) continue;

    const arr = await r.json();
    if (!Array.isArray(arr) || !arr.length) continue;
    const lat = Number(arr[0].lat);
    const lon = Number(arr[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    return {
      lat,
      lon,
      exibicao: String(arr[0].display_name || '').slice(0, 300),
      consultaUsada: q,
      tentativa: i + 1,
      cepUsado: cep || null
    };
  }

  console.warn('Endereco nao localizado', {origem, endereco, cep, numero, tentativas, ultimoStatus});
  const dicaCep = cep ? ` O CEP ${cep.slice(0, 5)}-${cep.slice(5)} também foi consultado.` : ' Inclua também o CEP.';
  throw Object.assign(new Error(`Não foi possível localizar o endereço ${rotulo} no mapa.${dicaCep}`), {status: 422});
}

function distanciaKm(a, b) {
  const R = 6371;
  const rad = (x) => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const p = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(p));
}

function centavos(n) {
  return Math.round(Number(n || 0) * 100);
}

function selecionarPrecoProduto(produto, item) {
  if (!produto || produto.ativo === false) throw Object.assign(new Error('Um produto do carrinho não está mais disponível.'), {status: 409});
  const variacoes = Array.isArray(produto.variacoes) ? produto.variacoes.filter(v => v && v.ativo !== false) : [];
  let precoBase = Number(produto.preco || 0);
  let variacaoSaida = null;
  if (variacoes.length) {
    const nomeVar = String(item?.variacao?.nome || '').trim();
    const v = variacoes.find(x => String(x.nome || '').trim() === nomeVar);
    if (!v) throw Object.assign(new Error('A variação escolhida não está mais disponível.'), {status: 409});
    precoBase = Number(v.preco || 0);
    variacaoSaida = {nome: String(v.nome || ''), preco: Number(v.preco || 0)};
  }
  if (!Number.isFinite(precoBase) || precoBase < 0) throw Object.assign(new Error('Preço inválido no cardápio.'), {status: 409});

  const grupos = Array.isArray(produto.gruposAdicionais) ? produto.gruposAdicionais : [];
  const solicitados = Array.isArray(item?.adicionais) ? item.adicionais : [];
  const adicionaisSaida = [];
  let totalAdicionais = 0;

  for (const g of grupos) {
    const opcoesAtivas = Array.isArray(g?.opcoes) ? g.opcoes.filter(o => o && o.ativo !== false) : [];
    const desteGrupo = solicitados.filter(a => String(a?.grupo || '').trim() === String(g?.nome || '').trim());
    const min = Number(g?.min || 0), max = Number(g?.max || 1);
    if (desteGrupo.length < min || desteGrupo.length > max) throw Object.assign(new Error('Seleção de adicionais fora das regras do cardápio.'), {status: 409});
    for (const a of desteGrupo) {
      const op = opcoesAtivas.find(o => String(o.nome || '').trim() === String(a?.nome || '').trim());
      if (!op) throw Object.assign(new Error('Um adicional escolhido não está mais disponível.'), {status: 409});
      const preco = Number(op.preco || 0);
      totalAdicionais += preco;
      adicionaisSaida.push({grupo: String(g.nome || ''), nome: String(op.nome || ''), preco});
    }
  }

  const gruposConhecidos = new Set(grupos.map(g => String(g?.nome || '').trim()));
  if (solicitados.some(a => !gruposConhecidos.has(String(a?.grupo || '').trim()))) {
    throw Object.assign(new Error('O carrinho contém adicional inválido.'), {status: 409});
  }

  const quantidade = Number(item?.quantidade || 1);
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) throw Object.assign(new Error('Quantidade inválida no carrinho.'), {status: 400});
  const unitario = precoBase + totalAdicionais;
  return {
    produtoId: String(item.produtoId || ''),
    nome: String(produto.nome || '').slice(0, 160),
    variacao: variacaoSaida,
    adicionais: adicionaisSaida,
    quantidade,
    valorUnitario: unitario,
    subtotal: unitario * quantidade
  };
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

exports.criarPedidoClienteSeguro = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    maxInstances: 10,
  },
  async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({error: 'Método não permitido.'});
    if (req.get('origin') && req.get('origin') !== ALLOWED_ORIGIN) return res.status(403).json({error: 'Origem não autorizada.'});

    try {
      const {uid, perfil} = await autenticarCliente(req);
      const body = req.body || {};
      const franquiaId = String(body.franquiaId || '').trim();
      const lojaId = String(body.lojaId || '').trim();
      const entrega = String(body.entrega || '').trim();
      const pagamento = String(body.pagamento || '').trim();
      const endereco = String(body.endereco || '').trim().slice(0, 300);
      const observacoes = String(body.observacoes || '').trim().slice(0, 500);
      const itensEntrada = Array.isArray(body.itens) ? body.itens : [];

      if (!franquiaId || !lojaId || !['Interfood', 'Retirada'].includes(entrega)) throw Object.assign(new Error('Dados do pedido inválidos.'), {status: 400});
      if (!['Pix', 'Dinheiro', 'Cartão na entrega', 'Online'].includes(pagamento)) throw Object.assign(new Error('Forma de pagamento inválida.'), {status: 400});
      if (!itensEntrada.length || itensEntrada.length > 100) throw Object.assign(new Error('Carrinho vazio ou inválido.'), {status: 400});
      if (entrega === 'Interfood' && !endereco) throw Object.assign(new Error('Informe o endereço de entrega.'), {status: 400});

      const db = admin.firestore();
      const lojaRef = db.collection('franquias').doc(franquiaId).collection('estabelecimentos').doc(lojaId);
      const lojaSnap = await lojaRef.get();
      if (!lojaSnap.exists) throw Object.assign(new Error('Estabelecimento não encontrado.'), {status: 404});
      const loja = lojaSnap.data() || {};
      if (loja.ativo !== true || loja.aceitandoPedidos !== true) throw Object.assign(new Error('Estabelecimento não está aceitando pedidos no momento.'), {status: 409});

      const itens = [];
      for (const item of itensEntrada) {
        const produtoId = String(item?.produtoId || '').trim();
        if (!produtoId) throw Object.assign(new Error('Produto inválido no carrinho.'), {status: 400});
        const pSnap = await lojaRef.collection('cardapio').doc(produtoId).get();
        if (!pSnap.exists) throw Object.assign(new Error('Um produto do carrinho não existe mais.'), {status: 409});
        itens.push(selecionarPrecoProduto(pSnap.data(), item));
      }

      const subtotalCent = itens.reduce((s, x) => s + centavos(x.subtotal), 0);
      const taxaCent = entrega === 'Interfood' ? centavos(loja.taxaEntrega || 0) : 0;
      const totalCent = subtotalCent + taxaCent;
      if (subtotalCent <= 0 || totalCent > 10_000_000) throw Object.assign(new Error('Total do pedido inválido.'), {status: 400});

      let distanciaEntregaKm = null;
      let raioEntregaKm = null;
      let enderecoValidado = entrega === 'Retirada' ? 'Retirada no estabelecimento' : endereco;
      if (entrega === 'Interfood') {
        const raio = Number(loja.raioEntregaKm || 0);
        if (!Number.isFinite(raio) || raio <= 0) throw Object.assign(new Error('A loja ainda não configurou o raio de entrega.'), {status: 409});
        raioEntregaKm = raio;
        const enderecoLoja = String(loja.enderecoLoja || '').trim();
        if (!enderecoLoja) throw Object.assign(new Error('A loja ainda não configurou um endereço válido.'), {status: 409});

        const geoLoja = await geocodificarEndereco(enderecoLoja, 'loja');
        await esperar(1100);
        const geoCliente = await geocodificarEndereco(endereco, 'cliente');
        distanciaEntregaKm = Number(distanciaKm(geoLoja, geoCliente).toFixed(2));
        if (distanciaEntregaKm > raio) throw Object.assign(new Error('Endereço fora da área de entrega. Distância aproximada: ' + distanciaEntregaKm.toFixed(2).replace('.', ',') + ' km; limite da loja: ' + raio.toFixed(1).replace('.', ',') + ' km.'), {status: 422});
      }

      const ref = lojaRef.collection('pedidos').doc();
      const numero = 'PED-' + ref.id.slice(0, 8).toUpperCase();
      const pedido = {
        numero,
        cliente: String(perfil.nome || '').slice(0, 120),
        telefone: String(perfil.telefone || '').slice(0, 30),
        entrega,
        subtotalProdutos: subtotalCent / 100,
        taxaEntrega: taxaCent / 100,
        valor: totalCent / 100,
        itens,
        endereco: enderecoValidado,
        observacoes,
        pagamento,
        status: 'Novo',
        clienteUid: uid,
        franquiaId,
        lojaId,
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
        origem: 'cliente-homologacao-backend',
        calculadoNoServidor: true,
        distanciaEntregaKm,
        raioEntregaKm
      };
      await ref.set(pedido);
      return res.status(200).json({
        ok: true,
        pedidoId: ref.id,
        numero,
        subtotalProdutos: subtotalCent / 100,
        taxaEntrega: taxaCent / 100,
        valor: totalCent / 100,
        distanciaEntregaKm,
        raioEntregaKm
      });
    } catch (e) {
      console.error('criarPedidoClienteSeguro', e);
      const status = Number(e?.status) || 500;
      return res.status(status).json({error: status >= 500 ? 'Não foi possível concluir o pedido agora.' : String(e.message || e)});
    }
  }
);
