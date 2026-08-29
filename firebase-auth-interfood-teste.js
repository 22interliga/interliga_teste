/* Interfood - camada de autenticacao para HOMOLOGACAO.
   Usa exclusivamente o projeto Firebase de teste configurado em
   firebase-interfood-config-teste.js e recusa producao. */
(function(){
  const PROD_ID='interliga-mobilidade';
  function cfg(){return window.INTERFOOD_FIREBASE_TEST_CONFIG||null}
  function validar(){
    const c=cfg();
    if(!c) throw new Error('Configuracao Firebase de teste ausente.');
    if(!c.projectId || /SEU-PROJETO-TESTE|COLOQUE|ID_TESTE|APP_ID_TESTE/.test(JSON.stringify(c)))
      throw new Error('Configuracao Firebase de teste ainda nao preenchida.');
    if(c.projectId===PROD_ID || c.projectId===window.INTERFOOD_FIREBASE_PRODUCTION_PROJECT_ID)
      throw new Error('BLOQUEADO: este integrador nao aceita o projeto Firebase de producao.');
    return c;
  }
  async function iniciar(){
    const c=validar();
    if(!window.firebase || !firebase.initializeApp) throw new Error('SDK Firebase nao carregado.');
    const app=firebase.apps&&firebase.apps.length?firebase.app():firebase.initializeApp(c);
    const auth=app.auth();
    const db=app.firestore();
    return {app,auth,db,projectId:c.projectId};
  }
  async function login(email,senha){
    const {auth,db}=await iniciar();
    const cred=await auth.signInWithEmailAndPassword(email,senha);
    const uid=cred.user.uid;
    const snap=await db.collection('usuariosEstabelecimentos').doc(uid).get();
    if(!snap.exists){await auth.signOut();throw new Error('Vinculo do estabelecimento nao encontrado.');}
    const p=snap.data()||{};
    if(p.ativo!==true){await auth.signOut();throw new Error('Acesso bloqueado.');}
    if(p.perfil!=='estabelecimento'){await auth.signOut();throw new Error('Perfil nao autorizado para este painel.');}
    if(!p.franquiaId||!p.lojaId){await auth.signOut();throw new Error('Perfil sem franquia/loja vinculada.');}
    const sessao={uid,franquiaId:p.franquiaId,lojaId:p.lojaId,email:cred.user.email,loginEm:new Date().toISOString()};
    sessionStorage.setItem('interliga_sessao_estabelecimento_firebase',JSON.stringify(sessao));
    return {...sessao,...p};
  }
  async function sair(){
    try{const {auth}=await iniciar();await auth.signOut()}finally{sessionStorage.removeItem('interliga_sessao_estabelecimento_firebase')}
  }
  window.InterfoodAuthTeste={validar,iniciar,login,sair};
})();
