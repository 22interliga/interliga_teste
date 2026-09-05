// AMBIENTE DE HOMOLOGACAO INTERLIGA / INTERFOOD
// Projeto Firebase separado da producao.
window.INTERFOOD_FIREBASE_TEST_CONFIG = {
  apiKey: "AIzaSyBwMMsff1hV-6vDuQb3EK-EvSkkhYVBRFE",
  authDomain: "interliga-homologacao-eb0f2.firebaseapp.com",
  projectId: "interliga-homologacao-eb0f2",
  storageBucket: "interliga-homologacao-eb0f2.firebasestorage.app",
  messagingSenderId: "997118774501",
  appId: "1:997118774501:web:59f56ea39ed070986d180c"
};

// Trava: nunca aceitar o projeto de producao nesta camada de homologacao.
window.INTERFOOD_FIREBASE_PRODUCTION_PROJECT_ID = "interliga-mobilidade";
if (window.INTERFOOD_FIREBASE_TEST_CONFIG.projectId === window.INTERFOOD_FIREBASE_PRODUCTION_PROJECT_ID) {
  throw new Error("BLOQUEADO: configuracao de producao detectada no ambiente de homologacao.");
}

// Protecao central contra pagina/aba antiga na homologacao.
// Todas as telas que carregam esta configuracao passam a verificar a versao atual.
(function(){
  if(window.INTERFOOD_HOMOLOGACAO_BUILD)return;
  const BUILD='2026.09.05.1';
  const VERSION_FILE='interfood-homologacao-version.json';
  let verificando=false;
  window.INTERFOOD_HOMOLOGACAO_BUILD=BUILD;

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
      if(nova&&nova!==BUILD)location.replace(urlAtualizada(nova));
    }catch(e){
      console.warn('[Interfood homologacao] Falha ao verificar versao.',e);
    }finally{
      verificando=false;
    }
  }

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
