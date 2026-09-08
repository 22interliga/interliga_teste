/* Interfood · homologação · cadastro de push FCM
   Mantém o push ativo após atualizar/reabrir a página no mesmo navegador.
   Cada perfil mantém seu próprio contexto no navegador.
   Logout continua desativando somente o perfil autenticado por segurança. */
(function(){
  const ENDPOINT='https://us-central1-interliga-homologacao-eb0f2.cloudfunctions.net/registrarPushInterfood';
  const SW_URL='./firebase-messaging-sw.js?v=2026.09.06.3';
  const STORAGE_KEY='interfoodPushContextosHomologacao';
  const STORAGE_ANTIGO='interfoodPushContextoHomologacao';

  function carregarMessaging(){
    if(firebase.messaging)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src='https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js';
      s.onload=resolve;
      s.onerror=()=>reject(new Error('Não foi possível carregar o Firebase Messaging.'));
      document.head.appendChild(s);
    });
  }

  async function obterToken(opts){
    const vapid=String(window.INTERFOOD_VAPID_KEY||'').trim();
    if(!vapid) throw new Error('Push ainda não configurado: falta a chave Web Push da homologação.');
    if(!('serviceWorker' in navigator)) throw new Error('Este navegador não oferece suporte a Service Worker.');
    if(!opts||!opts.app||!opts.auth) throw new Error('Configuração de push incompleta.');
    await carregarMessaging();
    const reg=await navigator.serviceWorker.register(SW_URL,{scope:'./',updateViaCache:'none'});
    try{await reg.update()}catch(_){ }
    await navigator.serviceWorker.ready;
    const ativo=await navigator.serviceWorker.getRegistration('./')||reg;
    const messaging=opts.app.messaging();
    const token=await messaging.getToken({vapidKey:vapid,serviceWorkerRegistration:ativo});
    if(!token) throw new Error('O navegador não forneceu um token de notificação.');
    return token;
  }

  async function obterAppCheckToken(opts){
    if(!opts||!opts.app)throw new Error('App Check: app Firebase não informado.');
    const ac=window.InterfoodAppCheck&&window.InterfoodAppCheck.ativar
      ? window.InterfoodAppCheck.ativar(opts.app)
      : opts.app.appCheck();
    const r=await ac.getToken(false);
    const token=String(r&&r.token||'').trim();
    if(!token)throw new Error('App Check não forneceu token.');
    return token;
  }

  async function chamarBackend(opts,token,acao){
    const user=opts&&opts.auth&&opts.auth.currentUser;
    if(!user) throw new Error('Usuário não autenticado.');
    const [idToken,appCheckToken]=await Promise.all([user.getIdToken(),obterAppCheckToken(opts)]);
    const resp=await fetch(ENDPOINT,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Bearer '+idToken,
        'X-Firebase-AppCheck':appCheckToken
      },
      body:JSON.stringify({
        token,
        acao:acao||'registrar',
        role:String(opts.role||''),
        franquiaId:String(opts.franquiaId||''),
        lojaId:String(opts.lojaId||'')
      })
    });
    const data=await resp.json().catch(()=>({}));
    if(!resp.ok) throw new Error(data.error||'Não foi possível atualizar o cadastro de push.');
    return data;
  }

  function lerContextos(){
    let mapa={};
    try{
      mapa=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')||{};
      if(typeof mapa!=='object'||Array.isArray(mapa))mapa={};
    }catch(_){mapa={};}
    try{
      const antigo=JSON.parse(localStorage.getItem(STORAGE_ANTIGO)||'null');
      if(antigo&&antigo.role&&!mapa[antigo.role]){
        mapa[antigo.role]=antigo;
        localStorage.setItem(STORAGE_KEY,JSON.stringify(mapa));
      }
      localStorage.removeItem(STORAGE_ANTIGO);
    }catch(_){ }
    return mapa;
  }

  function salvarContexto(opts){
    try{
      const role=String(opts.role||'');
      if(!role)return;
      const mapa=lerContextos();
      mapa[role]={
        appName:String(opts.app&&opts.app.name||'[DEFAULT]'),
        role,
        franquiaId:String(opts.franquiaId||''),
        lojaId:String(opts.lojaId||'')
      };
      localStorage.setItem(STORAGE_KEY,JSON.stringify(mapa));
      if(role==='cliente'){
        localStorage.setItem('interfoodClienteAlertas','1');
        localStorage.setItem('interfoodClientePushRegistrado','1');
      }
    }catch(_){ }
  }

  function limparContexto(opts){
    try{
      const role=String(opts&&opts.role||'');
      const mapa=lerContextos();
      if(role&&mapa[role])delete mapa[role];
      if(Object.keys(mapa).length)localStorage.setItem(STORAGE_KEY,JSON.stringify(mapa));
      else localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_ANTIGO);
      if(role==='cliente'){
        localStorage.removeItem('interfoodClientePushRegistrado');
        localStorage.removeItem('interfoodClienteAlertas');
      }
    }catch(_){ }
  }

  function botaoDoRole(role){
    const ids={cliente:'btnAlertas',estabelecimento:'pushBtn',entregador:'alertasBtn'};
    return document.getElementById(ids[role]||'');
  }

  function detectarRolePagina(){
    if(document.getElementById('btnAlertas'))return 'cliente';
    if(document.getElementById('pushBtn'))return 'estabelecimento';
    if(document.getElementById('alertasBtn'))return 'entregador';
    return '';
  }

  function marcarUIAtivo(role){
    const b=botaoDoRole(role);
    if(b){
      b.textContent='🔔 Push ativado';
      b.classList.add('ativo');
      if(role==='estabelecimento')b.disabled=true;
    }
    try{window.dispatchEvent(new CustomEvent('interfood-push-status',{detail:{ativo:true,role:String(role||'')}}))}catch(_){ }
  }

  async function desativar(opts){
    if(!opts||!opts.app||!opts.auth)return {ok:false};
    const user=opts.auth.currentUser;
    if(!user){limparContexto(opts);return {ok:true};}
    try{
      const token=await obterToken(opts);
      await chamarBackend(opts,token,'desativar');
      limparContexto(opts);
      return {ok:true};
    }catch(e){
      console.warn('InterfoodPush.desativar',e&&e.message||e);
      limparContexto(opts);
      return {ok:false,error:e};
    }
  }

  function protegerLogout(opts){
    const auth=opts&&opts.auth;
    if(!auth||auth.__interfoodPushLogoutProtegido)return;
    const signOutOriginal=auth.signOut.bind(auth);
    auth.__interfoodPushLogoutProtegido=true;
    auth.signOut=async function(){
      try{await desativar(opts)}catch(_){limparContexto(opts)}
      return signOutOriginal();
    };
  }

  async function ativar(opts){
    if(!('Notification' in window)) throw new Error('Este navegador não oferece suporte a notificações.');
    if(!opts||!opts.app||!opts.auth||!opts.role) throw new Error('Configuração de push incompleta.');
    let perm=Notification.permission;
    if(perm==='default') perm=await Notification.requestPermission();
    if(perm!=='granted') throw new Error('Permissão de notificação não concedida.');
    const token=await obterToken(opts);
    await chamarBackend(opts,token,'registrar');
    salvarContexto(opts);
    protegerLogout(opts);
    marcarUIAtivo(String(opts.role));
    return {ok:true,token};
  }

  async function restaurarSalvo(roleDesejado){
    if(!('Notification' in window)||Notification.permission!=='granted')return false;
    const role=String(roleDesejado||detectarRolePagina()||'');
    if(!role)return false;
    const mapa=lerContextos();
    const salvo=mapa[role];
    if(!salvo||!salvo.appName)return false;
    if(!window.firebase||!Array.isArray(firebase.apps))return false;
    const app=firebase.apps.find(a=>a.name===salvo.appName);
    if(!app)return false;
    const auth=app.auth();
    if(!auth.currentUser)return false;
    const opts={app,auth,role,franquiaId:salvo.franquiaId||'',lojaId:salvo.lojaId||''};
    const token=await obterToken(opts);
    await chamarBackend(opts,token,'registrar');
    salvarContexto(opts);
    protegerLogout(opts);
    marcarUIAtivo(role);
    return true;
  }

  function iniciarRestauracaoAutomatica(){
    let tentativas=0;
    const tentar=async()=>{
      tentativas++;
      try{
        if(await restaurarSalvo())return true;
      }catch(e){console.warn('InterfoodPush.restaurar',e&&e.message||e)}
      return false;
    };
    tentar().then(ok=>{
      if(ok)return;
      const timer=setInterval(async()=>{
        if(await tentar()||tentativas>=30)clearInterval(timer);
      },1000);
    });
  }

  window.InterfoodPush={ativar,desativar,restaurar:restaurarSalvo};
  iniciarRestauracaoAutomatica();
})();
