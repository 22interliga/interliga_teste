const {onRequest} = require('firebase-functions/v2/https');
const {onDocumentWritten} = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const crypto = require('crypto');

const ALLOWED_ORIGIN='https://22interliga.github.io';
const TOKENS='pushTokensInterfood';
const WEB_BASE='https://22interliga.github.io/interliga_teste/';
const WEB_ICON=WEB_BASE+'icon-192.png';
const TOKEN_MAX_AGE_DAYS=90;

function cors(req,res){
  const origin=req.get('origin');
  if(origin===ALLOWED_ORIGIN)res.set('Access-Control-Allow-Origin',origin);
  res.set('Vary','Origin');
  res.set('Access-Control-Allow-Headers','Authorization, Content-Type, X-Firebase-AppCheck');
  res.set('Access-Control-Allow-Methods','POST, OPTIONS');
}

async function validarAppCheck(req){
  const token=String(req.get('X-Firebase-AppCheck')||'').trim();
  if(!token)throw Object.assign(new Error('App Check não informado.'),{status:401});
  try{return await admin.appCheck().verifyToken(token)}
  catch(_){throw Object.assign(new Error('App Check inválido.'),{status:401});}
}

async function usuario(req){
  const h=req.get('authorization')||'';
  if(!h.startsWith('Bearer '))throw Object.assign(new Error('Sessão não informada.'),{status:401});
  return admin.auth().verifyIdToken(h.slice(7));
}

async function validarVinculo(uid,role,franquiaId,lojaId){
  const db=admin.firestore();
  if(role==='cliente'){
    const s=await db.collection('clientes').doc(uid).get();
    if(!s.exists||s.data()?.perfil!=='cliente'||s.data()?.ativo!==true)throw Object.assign(new Error('Cliente sem acesso ativo.'),{status:403});
    if(!franquiaId||!lojaId)throw Object.assign(new Error('Franquia e estabelecimento são obrigatórios.'),{status:400});
    const loja=await db.collection('franquias').doc(franquiaId).collection('estabelecimentos').doc(lojaId).get();
    if(!loja.exists||loja.data()?.ativo!==true)throw Object.assign(new Error('Estabelecimento inválido.'),{status:403});
    return;
  }
  if(role==='estabelecimento'){
    const s=await db.collection('usuariosEstabelecimentos').doc(uid).get();
    const p=s.data()||{};
    if(!s.exists||p.perfil!=='estabelecimento'||p.ativo!==true||p.franquiaId!==franquiaId||p.lojaId!==lojaId)throw Object.assign(new Error('Vínculo do estabelecimento inválido.'),{status:403});
    return;
  }
  if(role==='entregador'){
    const s=await db.collection('usuariosEntregadores').doc(uid).get();
    const p=s.data()||{};
    if(!s.exists||p.perfil!=='entregador'||p.ativo!==true||p.franquiaId!==franquiaId)throw Object.assign(new Error('Vínculo do entregador inválido.'),{status:403});
    return;
  }
  throw Object.assign(new Error('Perfil de push inválido.'),{status:400});
}

exports.registrarPushInterfood=onRequest({region:'us-central1',timeoutSeconds:30,memory:'256MiB',maxInstances:10},async(req,res)=>{
  cors(req,res);
  if(req.method==='OPTIONS')return res.status(204).send('');
  if(req.method!=='POST')return res.status(405).json({error:'Método não permitido.'});
  if(req.get('origin')&&req.get('origin')!==ALLOWED_ORIGIN)return res.status(403).json({error:'Origem não autorizada.'});
  try{
    await validarAppCheck(req);
    const decoded=await usuario(req);
    const {token,role,franquiaId='',lojaId='',acao='registrar'}=req.body||{};
    if(typeof token!=='string'||token.length<40||token.length>4096)return res.status(400).json({error:'Token de push inválido.'});
    const roleNormalizado=String(role||'');
    const hash=crypto.createHash('sha256').update(token).digest('hex').slice(0,40);
    const db=admin.firestore();
    const ref=db.collection(TOKENS).doc(decoded.uid+'_'+hash);

    if(String(acao)==='desativar'){
      const atual=await ref.get();
      if(atual.exists&&atual.data()?.uid===decoded.uid&&atual.data()?.token===token){
        await ref.set({ativo:false,desativadoEm:admin.firestore.FieldValue.serverTimestamp(),atualizadoEm:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
      }
      console.log('PUSH_DESATIVADO',{uid:decoded.uid});
      return res.json({ok:true});
    }

    if(String(acao)!=='registrar')return res.status(400).json({error:'Ação de push inválida.'});
    await validarVinculo(decoded.uid,roleNormalizado,String(franquiaId||''),String(lojaId||''));

    const mesmosToken=await db.collection(TOKENS).where('token','==',token).get();
    const batch=db.batch();
    let substituidosMesmoPerfil=0;
    mesmosToken.docs.forEach(d=>{
      if(d.ref.path===ref.path)return;
      const anterior=d.data()||{};
      if(String(anterior.role||'')===roleNormalizado){
        substituidosMesmoPerfil++;
        batch.set(d.ref,{
          ativo:false,
          substituidoPorUid:decoded.uid,
          motivoDesativacao:'substituido_mesmo_perfil',
          atualizadoEm:admin.firestore.FieldValue.serverTimestamp()
        },{merge:true});
      }
    });
    batch.set(ref,{
      uid:decoded.uid,
      token,
      role:roleNormalizado,
      franquiaId:String(franquiaId||''),
      lojaId:String(lojaId||''),
      ativo:true,
      desativadoEm:admin.firestore.FieldValue.delete(),
      substituidoPorUid:admin.firestore.FieldValue.delete(),
      motivoDesativacao:admin.firestore.FieldValue.delete(),
      atualizadoEm:admin.firestore.FieldValue.serverTimestamp()
    },{merge:true});
    await batch.commit();
    console.log('PUSH_REGISTRO_OK',{uid:decoded.uid,role:roleNormalizado,franquiaId:String(franquiaId||''),lojaId:String(lojaId||''),substituidosMesmoPerfil});
    return res.json({ok:true});
  }catch(e){
    console.error('registrarPushInterfood',e);
    return res.status(Number(e.status)||500).json({error:e.message||'Falha ao registrar push.'});
  }
});

function msgStatus(status){
  const mapa={
    'Confirmado':'Seu pedido foi confirmado pelo estabelecimento.',
    'Em preparo':'Seu pedido está sendo preparado.',
    'Pronto':'Seu pedido está pronto e aguardando entregador.',
    'Entregador aceitou':'Um entregador aceitou seu pedido.',
    'Coletado':'Seu pedido foi coletado pelo entregador.',
    'Saiu para entrega':'Seu pedido saiu para entrega.',
    'Concluído':'Pedido entregue. Bom apetite!',
    'Cancelado':'Seu pedido foi cancelado.',
    'Recusado':'O estabelecimento recusou o pedido.'
  };
  return mapa[status]||'';
}

function timestampMs(v){
  try{
    if(v&&typeof v.toMillis==='function')return v.toMillis();
    if(v instanceof Date)return v.getTime();
    if(typeof v==='number')return v;
  }catch(_){ }
  return 0;
}

async function carregarTokens(filtros){
  let q=admin.firestore().collection(TOKENS).where('ativo','==',true);
  Object.entries(filtros).forEach(([k,v])=>{q=q.where(k,'==',v)});
  const s=await q.get();
  const limite=Date.now()-(TOKEN_MAX_AGE_DAYS*24*60*60*1000);
  const tokens=[];
  const expirar=[];
  let antigos=0;
  for(const d of s.docs){
    const x={ref:d.ref,...d.data()};
    if(!x.token)continue;
    const atualizado=timestampMs(x.atualizadoEm);
    if(atualizado&&atualizado<limite){
      antigos++;
      expirar.push(d.ref.set({
        ativo:false,
        motivoDesativacao:'expirado_'+TOKEN_MAX_AGE_DAYS+'_dias',
        desativadoEm:admin.firestore.FieldValue.serverTimestamp(),
        atualizadoEm:admin.firestore.FieldValue.serverTimestamp()
      },{merge:true}));
      continue;
    }
    tokens.push(x);
  }
  if(expirar.length)await Promise.all(expirar);
  console.log('PUSH_TOKENS',{filtros,quantidade:tokens.length,expirados:antigos});
  return tokens;
}

function urlWeb(valor){
  try{return new URL(String(valor||'./'),WEB_BASE).href}catch(_){return WEB_BASE}
}

async function enviar(tokens,data){
  if(!tokens.length){
    console.warn('PUSH_SEM_TOKENS',{tag:data&&data.tag||''});
    return {sucesso:0,falha:0};
  }
  const unicos=[];const vistos=new Set();let duplicados=0;
  for(const t of tokens){
    if(vistos.has(t.token)){duplicados++;continue}
    vistos.add(t.token);unicos.push(t);
  }
  let sucesso=0,falha=0;
  const destino=urlWeb(data&&data.url);
  const titulo=String(data&&data.title||'Interfood');
  const corpo=String(data&&data.body||'Há uma atualização no seu pedido.');
  const tag=String(data&&data.tag||'interfood-push');
  for(let i=0;i<unicos.length;i+=500){
    const lote=unicos.slice(i,i+500);
    const r=await admin.messaging().sendEachForMulticast({
      tokens:lote.map(x=>x.token),
      data:{...data,url:destino},
      webpush:{
        notification:{
          title:titulo,
          body:corpo,
          icon:WEB_ICON,
          badge:WEB_ICON,
          tag,
          renotify:true
        },
        fcmOptions:{link:destino}
      }
    });
    sucesso+=Number(r.successCount||0);
    falha+=Number(r.failureCount||0);
    const apagar=[];
    r.responses.forEach((resp,idx)=>{
      const code=resp.error&&resp.error.code;
      if(!resp.success)console.error('PUSH_FCM_ERRO',{code:code||'desconhecido',message:resp.error&&resp.error.message||''});
      if(!resp.success&&(code==='messaging/registration-token-not-registered'||code==='messaging/invalid-registration-token'))apagar.push(lote[idx].ref.delete());
    });
    await Promise.all(apagar);
  }
  console.log('PUSH_FCM_RESULTADO',{tag,sucesso,falha,duplicadosIgnorados:duplicados});
  return {sucesso,falha,duplicadosIgnorados:duplicados};
}

exports.notificarPedidoInterfood=onDocumentWritten({
  document:'franquias/{franquiaId}/estabelecimentos/{lojaId}/pedidos/{pedidoId}',
  region:'us-central1',
  memory:'256MiB',
  timeoutSeconds:60,
  maxInstances:20
},async(event)=>{
  const antes=event.data?.before?.exists?event.data.before.data():null;
  const depois=event.data?.after?.exists?event.data.after.data():null;
  if(!depois)return;
  const {franquiaId,lojaId,pedidoId}=event.params;
  const status=String(depois.status||'');
  const anterior=String(antes?.status||'');
  const numero=String(depois.numero||pedidoId);
  console.log('PUSH_EVENTO',{pedidoId,franquiaId,lojaId,anterior,status,temClienteUid:Boolean(depois.clienteUid)});

  if(!antes&&(status==='Novo'||status==='Pendente')){
    const ts=await carregarTokens({role:'estabelecimento',franquiaId,lojaId});
    await enviar(ts,{
      title:'Interfood · Novo pedido',
      body:'Novo pedido '+numero+' recebido.',
      tag:'interfood-loja-'+pedidoId,
      url:'./painel-estabelecimento-firebase-teste.html?franquia='+encodeURIComponent(franquiaId)+'&loja='+encodeURIComponent(lojaId)
    });
    return;
  }

  if(status===anterior)return;

  const texto=msgStatus(status);
  if(texto&&depois.clienteUid){
    const ts=await carregarTokens({role:'cliente',uid:String(depois.clienteUid),franquiaId,lojaId});
    await enviar(ts,{
      title:'Interfood · Pedido '+numero,
      body:texto,
      tag:'interfood-cliente-'+pedidoId,
      url:'./acompanhar-pedido-cliente-homologacao.html?franquia='+encodeURIComponent(franquiaId)+'&loja='+encodeURIComponent(lojaId)+'&pedido='+encodeURIComponent(pedidoId)
    });
  }else if(texto){
    console.warn('PUSH_CLIENTE_SEM_UID',{pedidoId,status});
  }

  if(status==='Pronto'){
    const ts=await carregarTokens({role:'entregador',franquiaId});
    await enviar(ts,{
      title:'Interfood · Nova entrega',
      body:'Pedido '+numero+' pronto para retirada.',
      tag:'interfood-entrega-'+pedidoId,
      url:'./entregador-interfood-firebase-teste.html?franquia='+encodeURIComponent(franquiaId)
    });
  }
});
