(function(){
  'use strict';
  const BUILD='2026.09.05.1';
  const VERSION_FILE='interfood-homologacao-version.json';
  let verificando=false;

  function urlAtualizada(build){
    const u=new URL(location.href);
    u.searchParams.set('_ifbuild',build);
    return u.toString();
  }

  async function verificarVersao(){
    if(verificando)return;
    verificando=true;
    try{
      const r=await fetch(VERSION_FILE+'?_='+Date.now(),{cache:'no-store'});
      if(!r.ok)return;
      const j=await r.json();
      const nova=String(j.build||'').trim();
      if(nova&&nova!==BUILD){
        location.replace(urlAtualizada(nova));
      }
    }catch(e){
      console.warn('[Interfood homologação] Não foi possível verificar a versão.',e);
    }finally{
      verificando=false;
    }
  }

  window.INTERFOOD_HOMOLOGACAO_BUILD=BUILD;

  window.addEventListener('pageshow',function(ev){
    if(ev.persisted){
      location.replace(urlAtualizada(BUILD));
      return;
    }
    verificarVersao();
  });

  document.addEventListener('visibilitychange',function(){
    if(document.visibilityState==='visible')verificarVersao();
  });

  window.addEventListener('focus',verificarVersao);
  setInterval(verificarVersao,60000);
})();
