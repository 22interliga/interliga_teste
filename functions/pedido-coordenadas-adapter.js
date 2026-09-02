const {onRequest} = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const coordenadas = require('./pedido-coordenadas');

const ALLOWED_ORIGIN='https://22interliga.github.io';
function montarEndereco(x){return [x.logradouro,x.bairro,x.cidade,x.uf].filter(Boolean).join(', ')+(x.complemento?' - '+x.complemento:'');}
function normalizar(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').replace(/\s*,\s*/g,', ').trim();}

exports.criarPedidoClienteSeguro = onRequest({region:'us-central1',timeoutSeconds:60,memory:'256MiB',maxInstances:10},async(req,res)=>{
  if(req.method==='OPTIONS') return coordenadas.criarPedidoClienteSeguro(req,res);
  try{
    if(req.get('origin')&&req.get('origin')!==ALLOWED_ORIGIN)return res.status(403).json({error:'Origem não autorizada.'});
    const body=req.body||{};
    if(String(body.entrega||'')==='Interfood'&&!body.enderecoId){
      const h=req.get('authorization')||'';
      if(!h.startsWith('Bearer '))return coordenadas.criarPedidoClienteSeguro(req,res);
      const decoded=await admin.auth().verifyIdToken(h.slice(7));
      const alvo=normalizar(body.endereco);
      const snap=await admin.firestore().collection('clientes').doc(decoded.uid).collection('enderecos').get();
      let escolhido=null;
      snap.forEach(d=>{if(escolhido)return;const x=d.data()||{};if(normalizar(montarEndereco(x))===alvo)escolhido=d.id;});
      if(!escolhido){
        const principal=snap.docs.find(d=>d.data()?.principal===true&&Number.isFinite(Number(d.data()?.latitude))&&Number.isFinite(Number(d.data()?.longitude)));
        if(principal&&snap.size===1)escolhido=principal.id;
      }
      if(!escolhido)return res.status(409).json({error:'Selecione um endereço salvo com ponto confirmado no mapa. Endereços digitados manualmente não são usados para validar o raio.'});
      req.body=Object.assign({},body,{enderecoId:escolhido});
    }
    return coordenadas.criarPedidoClienteSeguro(req,res);
  }catch(e){console.error('adapter pedido coordenadas',e);return res.status(500).json({error:'Não foi possível validar o endereço salvo agora.'});}
});
