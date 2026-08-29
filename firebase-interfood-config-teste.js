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
