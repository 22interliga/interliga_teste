// Firebase App Check — somente HOMOLOGACAO Interfood.
(function(){
  'use strict';

  const PROD='interliga-mobilidade';
  const cfg=window.INTERFOOD_FIREBASE_TEST_CONFIG;
  const key=String(window.INTERFOOD_RECAPTCHA_ENTERPRISE_KEY||'').trim();
  const ativados=new Set();

  function validar(){
    if(!cfg||!cfg.projectId)throw new Error('App Check: configuração Firebase de homologação ausente.');
    if(cfg.projectId===PROD)throw new Error('App Check BLOQUEADO: projeto de produção detectado.');
    if(!key)throw new Error('App Check: chave reCAPTCHA Enterprise ausente.');
    if(!window.firebase||!firebase.appCheck)throw new Error('App Check: SDK firebase-app-check-compat não carregado.');
  }

  function ativar(app){
    validar();
    if(!app)throw new Error('App Check: app Firebase não informado.');
    const nome=String(app.name||'[DEFAULT]');
    if(ativados.has(nome))return app.appCheck();
    const ac=app.appCheck();
    ac.activate(new firebase.appCheck.ReCaptchaEnterpriseProvider(key),true);
    ativados.add(nome);
    console.info('[Interfood homologacao] App Check ativo:',nome);
    return ac;
  }

  window.InterfoodAppCheck={ativar};
})();
