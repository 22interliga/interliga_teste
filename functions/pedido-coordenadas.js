const {onRequest} = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

const ALLOWED_ORIGIN = 'https://22interliga.github.io';
const FUSO_OPERACAO = 'America/Bahia';

function cors(req,res){
  const origin=req.get('origin');
  if(origin===ALLOWED_ORIGIN)res.set('Access-Control-Allow-Origin',origin);
  res.set('Vary','Origin');
  res.set('Access-Control-Allow-Headers','Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods','POST, OPTIONS');
}
function erro(msg,status){return Object.assign(new Error(msg),{status});}
function coordValida(lat,lon){return Number.isFinite(Number(lat))&&Number(lat)>=-90&&Number(lat)<=90&&Number.isFinite(Number(lon))&&Number(lon)>=-180&&Number(lon)<=180;}
function distanciaKm(a,b){const R=6371,rad=x=>x*Math.PI/180,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);const p=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(p));}
function centavos(n){return Math.round(Number(n||0)*100);}
function horarioMinutos(h){
  const m=String(h||'').match(/^(\d{2}):(\d{2})$/);
  if(!m)return null;
  const hh=Number(m[1]),mm=Number(m[2]);
  if(hh<0||hh>23||mm<0||mm>59)return null;
  return hh*60+mm;
}
function agoraNoFusoMinutos(){
  const partes=new Intl.DateTimeFormat('pt-BR',{timeZone:FUSO_OPERACAO,hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
  const hh=Number(partes.find(p=>p.type==='hour')?.value),mm=Number(partes.find(p=>p.type==='minute')?.value);
  return hh*60+mm;
}
function lojaAbertaNoHorario(loja){
  const abertura=horarioMinutos(loja.horarioAbertura),fechamento=horarioMinutos(loja.horarioFechamento);
  if(abertura===null||fechamento===null)return {ok:false,motivo:'A loja ainda não configurou um horário de funcionamento válido.'};
  if(abertura===fechamento)return {ok:true,vinteQuatroHoras:true};
  const agora=agoraNoFusoMinutos();
  const aberta=abertura<fechamento ? agora>=abertura&&agora<fechamento : agora>=abertura||agora<fechamento;
  return {ok:aberta,abertura:String(loja.horarioAbertura),fechamento:String(loja.horarioFechamento),agora};
}

async function autenticarCliente(req){
  const h=req.get('authorization')||'';
  if(!h.startsWith('Bearer '))throw erro('Sessão não informada.',401);
  const decoded=await admin.auth().verifyIdToken(h.slice(7));
  const snap=await admin.firestore().collection('clientes').doc(decoded.uid).get();
  if(!snap.exists)throw erro('Perfil do cliente não encontrado.',403);
  const perfil=snap.data()||{};
  if(perfil.perfil!=='cliente'||perfil.ativo!==true)throw erro('Cliente sem acesso ativo.',403);
  return {uid:decoded.uid,perfil};
}

function selecionarPrecoProduto(produto,item){
  if(!produto||produto.ativo===false)throw erro('Um produto do carrinho não está mais disponível.',409);
  const variacoes=Array.isArray(produto.variacoes)?produto.variacoes.filter(v=>v&&v.ativo!==false):[];
  let precoBase=Number(produto.preco||0),variacaoSaida=null;
  if(variacoes.length){const nome=String(item?.variacao?.nome||'').trim(),v=variacoes.find(x=>String(x.nome||'').trim()===nome);if(!v)throw erro('A variação escolhida não está mais disponível.',409);precoBase=Number(v.preco||0);variacaoSaida={nome:String(v.nome||''),preco:Number(v.preco||0)};}
  if(!Number.isFinite(precoBase)||precoBase<0)throw erro('Preço inválido no cardápio.',409);
  const grupos=Array.isArray(produto.gruposAdicionais)?produto.gruposAdicionais:[],solicitados=Array.isArray(item?.adicionais)?item.adicionais:[];
  const adicionaisSaida=[];let totalAdicionais=0;
  for(const g of grupos){const opcoes=Array.isArray(g?.opcoes)?g.opcoes.filter(o=>o&&o.ativo!==false):[];const deste=solicitados.filter(a=>String(a?.grupo||'').trim()===String(g?.nome||'').trim());const min=Number(g?.min||0),max=Number(g?.max||1);if(deste.length<min||deste.length>max)throw erro('Seleção de adicionais fora das regras do cardápio.',409);for(const a of deste){const op=opcoes.find(o=>String(o.nome||'').trim()===String(a?.nome||'').trim());if(!op)throw erro('Um adicional escolhido não está mais disponível.',409);const preco=Number(op.preco||0);totalAdicionais+=preco;adicionaisSaida.push({grupo:String(g.nome||''),nome:String(op.nome||''),preco});}}
  const conhecidos=new Set(grupos.map(g=>String(g?.nome||'').trim()));if(solicitados.some(a=>!conhecidos.has(String(a?.grupo||'').trim())))throw erro('O carrinho contém adicional inválido.',409);
  const quantidade=Number(item?.quantidade||1);if(!Number.isInteger(quantidade)||quantidade<1||quantidade>50)throw erro('Quantidade inválida no carrinho.',400);
  const unitario=precoBase+totalAdicionais;return {produtoId:String(item.produtoId||''),nome:String(produto.nome||'').slice(0,160),variacao:variacaoSaida,adicionais:adicionaisSaida,quantidade,valorUnitario:unitario,subtotal:unitario*quantidade};
}

exports.criarPedidoClienteSeguro = onRequest({region:'us-central1',timeoutSeconds:60,memory:'256MiB',maxInstances:10},async(req,res)=>{
  cors(req,res);if(req.method==='OPTIONS')return res.status(204).send('');if(req.method!=='POST')return res.status(405).json({error:'Método não permitido.'});if(req.get('origin')&&req.get('origin')!==ALLOWED_ORIGIN)return res.status(403).json({error:'Origem não autorizada.'});
  try{
    const {uid,perfil}=await autenticarCliente(req),body=req.body||{};
    const franquiaId=String(body.franquiaId||'').trim(),lojaId=String(body.lojaId||'').trim(),entrega=String(body.entrega||'').trim(),pagamento=String(body.pagamento||'').trim(),enderecoId=String(body.enderecoId||'').trim(),observacoes=String(body.observacoes||'').trim().slice(0,500),itensEntrada=Array.isArray(body.itens)?body.itens:[];
    if(!franquiaId||!lojaId||!['Interfood','Retirada'].includes(entrega))throw erro('Dados do pedido inválidos.',400);if(!['Pix','Dinheiro','Cartão na entrega','Online'].includes(pagamento))throw erro('Forma de pagamento inválida.',400);if(!itensEntrada.length||itensEntrada.length>100)throw erro('Carrinho vazio ou inválido.',400);if(entrega==='Interfood'&&!enderecoId)throw erro('Selecione um endereço salvo e confirmado no mapa.',400);
    const db=admin.firestore(),lojaRef=db.collection('franquias').doc(franquiaId).collection('estabelecimentos').doc(lojaId),lojaSnap=await lojaRef.get();if(!lojaSnap.exists)throw erro('Estabelecimento não encontrado.',404);const loja=lojaSnap.data()||{};if(loja.ativo!==true||loja.aceitandoPedidos!==true)throw erro('Estabelecimento não está aceitando pedidos no momento.',409);
    const horario=lojaAbertaNoHorario(loja);if(!horario.ok){if(horario.abertura&&horario.fechamento)throw erro('Loja fechada neste horário. Funcionamento: '+horario.abertura+' às '+horario.fechamento+'.',409);throw erro(horario.motivo||'Loja fora do horário de funcionamento.',409);}
    const itens=[];for(const item of itensEntrada){const produtoId=String(item?.produtoId||'').trim();if(!produtoId)throw erro('Produto inválido no carrinho.',400);const p=await lojaRef.collection('cardapio').doc(produtoId).get();if(!p.exists)throw erro('Um produto do carrinho não existe mais.',409);itens.push(selecionarPrecoProduto(p.data(),item));}
    const subtotalCent=itens.reduce((s,x)=>s+centavos(x.subtotal),0),taxaCent=entrega==='Interfood'?centavos(loja.taxaEntrega||0):0,totalCent=subtotalCent+taxaCent;if(subtotalCent<=0||totalCent>10000000)throw erro('Total do pedido inválido.',400);
    let distanciaEntregaKm=null,raioEntregaKm=null,enderecoValidado='Retirada no estabelecimento',localizacaoEntrega=null;
    if(entrega==='Interfood'){
      const raio=Number(loja.raioEntregaKm||0);if(!Number.isFinite(raio)||raio<=0)throw erro('A loja ainda não configurou o raio de entrega.',409);raioEntregaKm=raio;
      if(!coordValida(loja.latitudeLoja,loja.longitudeLoja))throw erro('A loja ainda não confirmou o ponto de localização no mapa.',409);
      const endSnap=await db.collection('clientes').doc(uid).collection('enderecos').doc(enderecoId).get();if(!endSnap.exists)throw erro('Endereço salvo não encontrado.',404);const end=endSnap.data()||{};if(!coordValida(end.latitude,end.longitude))throw erro('Este endereço ainda não teve o ponto confirmado no mapa.',409);
      enderecoValidado=[end.logradouro,end.bairro,end.cidade,end.uf].filter(Boolean).join(', ')+(end.complemento?' - '+end.complemento:'');
      const geoLoja={lat:Number(loja.latitudeLoja),lon:Number(loja.longitudeLoja)},geoCliente={lat:Number(end.latitude),lon:Number(end.longitude)};distanciaEntregaKm=Number(distanciaKm(geoLoja,geoCliente).toFixed(2));
      if(distanciaEntregaKm>raio)throw erro('Endereço fora da área de entrega. Distância aproximada: '+distanciaEntregaKm.toFixed(2).replace('.',',')+' km; limite da loja: '+raio.toFixed(1).replace('.',',')+' km.',422);
      localizacaoEntrega={enderecoId,latitude:geoCliente.lat,longitude:geoCliente.lon,metodo:'ponto-confirmado'};
    }
    const ref=lojaRef.collection('pedidos').doc(),numero='PED-'+ref.id.slice(0,8).toUpperCase();const pedido={numero,cliente:String(perfil.nome||'').slice(0,120),telefone:String(perfil.telefone||'').slice(0,30),entrega,subtotalProdutos:subtotalCent/100,taxaEntrega:taxaCent/100,valor:totalCent/100,itens,endereco:enderecoValidado,observacoes,pagamento,status:'Novo',clienteUid:uid,franquiaId,lojaId,criadoEm:admin.firestore.FieldValue.serverTimestamp(),origem:'cliente-homologacao-backend-coordenadas',calculadoNoServidor:true,distanciaEntregaKm,raioEntregaKm,localizacaoEntrega,horarioValidado:true,fusoHorario:FUSO_OPERACAO};await ref.set(pedido);
    return res.status(200).json({ok:true,pedidoId:ref.id,numero,subtotalProdutos:subtotalCent/100,taxaEntrega:taxaCent/100,valor:totalCent/100,distanciaEntregaKm,raioEntregaKm,metodoArea:entrega==='Interfood'?'coordenadas-confirmadas':'retirada',horarioValidado:true});
  }catch(e){console.error('criarPedidoClienteSeguro coordenadas',e);const status=Number(e?.status)||500;return res.status(status).json({error:status>=500?'Não foi possível concluir o pedido agora.':String(e.message||e)});}
});
