/* Interfood · homologação · cadastro de push FCM
   Só ativa quando a chave Web Push (VAPID) estiver configurada em
   window.INTERFOOD_VAPID_KEY. Não altera os alertas locais já validados. */
(function(){
  const ENDPOINT='https://us-central1-interliga-homologacao-eb0f2.cloudfunctions.net/registrarPushInterfood';
  const SW_URL='./firebase-messaging-sw.js?v=2026.09.06.2';

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

  async function ativar(opts){
    const vapid=String(window.INTERFOOD_VAPID_KEY||'').trim();
    if(!vapid) throw new Error('Push ainda não configurado: falta a chave Web Push da homologação.');
    if(!('serviceWorker' in navigator)) throw new Error('Este navegador não oferece suporte a Service Worker.');
    if(!('Notification' in window)) throw new Error('Este navegador não oferece suporte a notificações.');
    if(!opts||!opts.app||!opts.auth||!opts.role) throw new Error('Configuração de push incompleta.');

    let perm=Notification.permission;
    if(perm==='default') perm=await Notification.requestPermission();
    if(perm!=='granted') throw new Error('Permissão de notificação não concedida.');

    await carregarMessaging();
    const reg=await navigator.serviceWorker.register(SW_URL,{scope:'./'});
    try{await reg.update()}catch(_){ }
    if(reg.waiting) reg.waiting.postMessage({type:'SKIP_WAITING'});
    await navigator.serviceWorker.ready;
    const ativo=await navigator.serviceWorker.getRegistration('./')||reg;
    const messaging=opts.app.messaging();
    const token=await messaging.getToken({vapidKey:vapid,serviceWorkerRegistration:ativo});
    if(!token) throw new Error('O navegador não forneceu um token de notificação.');

    const user=opts.auth.currentUser;
    if(!user) throw new Error('Usuário não autenticado.');
    const idToken=await user.getIdToken();
    const resp=await fetch(ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+idToken},
      body:JSON.stringify({
        token,
        role:String(opts.role),
        franquiaId:String(opts.franquiaId||''),
        lojaId:String(opts.lojaId||'')
      })
    });
    const data=await resp.json().catch(()=>({}));
    if(!resp.ok) throw new Error(data.error||'Não foi possível registrar este navegador para push.');
    return {ok:true,token};
  }

  window.InterfoodPush={ativar};
})();
