// AMBIENTE DE TESTE APENAS.
// NUNCA usar aqui as credenciais/configuracoes do projeto Firebase de producao.
// Crie um projeto Firebase separado para homologacao e copie apenas a configuracao WEB dele.
window.INTERFOOD_FIREBASE_TEST_CONFIG = {
  apiKey: "COLOQUE_A_API_KEY_DO_PROJETO_DE_TESTE",
  authDomain: "SEU-PROJETO-TESTE.firebaseapp.com",
  projectId: "SEU-PROJETO-TESTE",
  storageBucket: "SEU-PROJETO-TESTE.firebasestorage.app",
  messagingSenderId: "ID_TESTE",
  appId: "APP_ID_TESTE"
};

// Protecao adicional: o integrador deve recusar qualquer projectId de producao.
window.INTERFOOD_FIREBASE_PRODUCTION_PROJECT_ID = "interliga-mobilidade";
