/*
 * INTERLIGA — FIREBASE HOMOLOGAÇÃO
 * ATENÇÃO: este arquivo NÃO pode apontar para interliga-mobilidade.
 */

export const FIREBASE_SDK = '10.12.0';

export const firebaseConfig = {
  apiKey: "AIzaSyBwMMsff1hV-6vDuQb3EK-EvSkkhYVBRFE",
  authDomain: "interliga-homologacao-eb0f2.firebaseapp.com",
  projectId: "interliga-homologacao-eb0f2",
  storageBucket: "interliga-homologacao-eb0f2.firebasestorage.app",
  messagingSenderId: "997118774501",
  appId: "1:997118774501:web:59f56ea39ed070986d180c"
};

if (firebaseConfig.projectId === 'interliga-mobilidade') {
  throw new Error('BLOQUEIO DE SEGURANÇA: produção não permitida nesta homologação.');
}

export async function carregarFirebase(nomeApp) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const fb = await import(`${base}/firebase-firestore.js`);
  const authMod = await import(`${base}/firebase-auth.js`);

  const app = initializeApp(firebaseConfig, nomeApp);
  const db = fb.getFirestore(app);
  const auth = authMod.getAuth(app);

  let appCheck = null;
  let appCheckMod = null;

  try {
    appCheckMod = await import(`${base}/firebase-app-check.js`);
    appCheck = appCheckMod.initializeAppCheck(app, {
      provider: new appCheckMod.ReCaptchaEnterpriseProvider(
        '6LdiF6wtAAAAAKQNAdA4ctM0MeVIo7PDDdndbq9-'
      ),
      isTokenAutoRefreshEnabled: true
    });
    console.log('✅ App Check inicializado:', nomeApp);
  } catch (e) {
    console.warn('⚠️ App Check não inicializado; Firebase continuará disponível:', e);
  }

  return { app, db, auth, fb, authMod, appCheck, appCheckMod };
}
