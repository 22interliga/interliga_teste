// ═══════════════════════════════════════
// INTERLIGA — Motorista
// motorista.js — única fonte de verdade, isolado do passageiro
// ═══════════════════════════════════════

import { carregarFirebase } from './firebase-config.js';
let db = null;
let firebaseReady = false;
let _loginEmAndamento = false;
let fb = {};
let authMotorista = null;
let authModRef = null;
let fbAppInstancia = null;

// Espera o Firebase terminar de conectar (até ~8s), em vez de desistir na hora.
function esperarFirebasePronto(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (firebaseReady && db && authMotorista) return resolve(true);
    const inicio = Date.now();
    const intervalo = setInterval(() => {
      if (firebaseReady && db && authMotorista) {
        clearInterval(intervalo);
        resolve(true);
      } else if (Date.now() - inicio > timeoutMs) {
        clearInterval(intervalo);
        resolve(false);
      }
    }, 300);
  });
}

async function initFirebase() {
  try {
const { app, db: _db, auth, fb: _fb, authMod } = await carregarFirebase('interliga-motorista');
    fb = _fb;
    authModRef = authMod;
    fbAppInstancia = app;
    db = _db;
    authMotorista = auth;
    firebaseReady = true;
    console.log('Firebase conectado (motorista)');

    // Login real (e-mail/senha) — com sessão salva, entra direto. Sem sessão, pede login.
    authMod.onAuthStateChanged(authMotorista, (user) => {
      if (user) {
        _loginEmAndamento = false;
        meuMotoristaId = user.uid;
        verificarCadastroMotorista();
      } else {
        // Se perdeu a sessão, o serviço nativo não pode continuar anunciando corridas.
        try { encerrarOperacaoMotorista(); } catch (e) {}
        meuMotoristaId = null;
        // Aguarda 800ms antes de redirecionar pro login
        // Isso evita o loop quando o app volta de outra aba ou é reaberto
        // (o Firebase demora um pouco pra restaurar a sessão)
        setTimeout(() => {
          if (meuMotoristaId) return; // sessão restaurou nesse tempo, ignora
          if (_loginEmAndamento) return; // login em andamento — não redireciona
          const telaAtual = document.querySelector('.screen[data-active="true"]')?.id;
          const processandoLogin = document.getElementById('btn-fazer-login-motorista')?.disabled;
          if (!processandoLogin &&
              telaAtual !== 'screen-cadastro-motorista' &&
              telaAtual !== 'screen-login-motorista') {
            go('screen-login-motorista');
          }
        }, 800);
      }
    });
  } catch (e) {
    console.warn('Firebase nao disponivel:', e);
    firebaseReady = false;
    alert('⚠️ Erro ao conectar no Firebase:\n\n' + (e.message || e) + '\n\nManda esse texto pro suporte.');
    meuMotoristaId = obterMotoristaIdReserva();
    go('screen-home'); // modo totalmente offline — libera a Home sem cadastro, já que não tem como verificar nada
  }
}

// Cadastra/atualiza o perfil deste motorista na coleção permanente 'motoristas' —
// diferente de 'motoristas_disponiveis', que existe só enquanto ele está online.
// É essa coleção permanente que o Painel Admin usa pra listar todos os motoristas já cadastrados.
function registrarPerfilMotorista() {
  if (!firebaseReady || !db) return;
  fb.setDoc(fb.doc(db, 'motoristas', meuMotoristaId), {
    nome: state.motorista.nome,
    veiculo: state.motorista.veiculo,
    placa: state.motorista.placa,
    avaliacao: state.motorista.avaliacao,
    atualizadoEm: fb.serverTimestamp(),
  }, { merge: true }).catch((e) => console.warn('[motorista] erro ao registrar perfil:', e));
}

// ─────────────────────────────────────
// IDENTIDADE DO MOTORISTA — fixa por dispositivo, usada na fila de prioridade
// ─────────────────────────────────────
// Mantido como reserva: se o Firebase falhar totalmente, ainda gera um ID local
// pra não quebrar funções que dependem de meuMotoristaId.
function obterMotoristaIdReserva() {
  let id = localStorage.getItem('interliga_motorista_id');
  if (!id) {
    id = 'mot-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('interliga_motorista_id', id);
  }
  return id;
}
let meuMotoristaId = null; // definido de verdade pelo login (UID do Firebase Auth)

// ─────────────────────────────────────
// CARTEIRA — saldo calculado por extrato (mesmo padrão do app.js)
// ─────────────────────────────────────
async function obterSaldoCarteira(uid) {
  if (!firebaseReady || !db || !uid) return 0;
  try {
    const snap = await fb.getDocs(fb.query(fb.collection(db, 'carteira_transacoes'), fb.where('uid', '==', uid)));
    let saldo = 0;
    snap.forEach(d => { saldo += Number(d.data().valor || 0); });
    return saldo;
  } catch (e) {
    console.warn('[motorista] erro ao calcular saldo da carteira:', e);
    return 0;
  }
}

async function lancarCarteira(uid, valor, motivo, corridaId = null) {
  if (!firebaseReady || !db || !uid || !valor) return;
  try {
    await fb.addDoc(fb.collection(db, 'carteira_transacoes'), {
      uid, valor, motivo, corridaId,
      criadoEm: fb.serverTimestamp(),
    });
  } catch (e) {
    console.warn('[motorista] erro ao lançar na carteira:', e);
  }
}

// Credita cashback ao passageiro: só pra corridas da categoria Interliga X,
// só se o programa estiver ativo e dentro do período configurado no admin.
// Calculado sobre o valor que o passageiro realmente pagou (já com desconto
// de cupom, se teve).
async function processarCashback(corrida) {
  if (!firebaseReady || !db || !corrida?.passageiroId) return;
  if (corrida.categoria !== 'x') return;
  try {
    const snap = await fb.getDoc(fb.doc(db, 'config', 'cashback'));
    if (!snap.exists()) return;
    const cfg = snap.data();
    if (cfg.ativo === false) return;
    if (!cfg.percentual || cfg.percentual <= 0) return;
    const hoje = new Date().toISOString().slice(0, 10);
    if (cfg.dataInicio && hoje < cfg.dataInicio) return;
    if (cfg.dataFim && hoje > cfg.dataFim) return;

    const valorCashback = Number(corrida.preco || 0) * (cfg.percentual / 100);
    if (valorCashback > 0) {
      await lancarCarteira(corrida.passageiroId, valorCashback, `Cashback (${cfg.percentual}% · Interliga X)`, corrida.id);
    }
  } catch (e) {
    console.warn('[motorista] erro ao processar cashback:', e);
  }
}

async function resolverCodigoIndicacao(codigo) {
  if (!firebaseReady || !db || !codigo) return null;
  try {
    const [snapPax, snapMot] = await Promise.all([
      fb.getDocs(fb.query(fb.collection(db, 'passageiros'), fb.where('codigoIndicacao', '==', codigo))),
      fb.getDocs(fb.query(fb.collection(db, 'motoristas'), fb.where('codigoIndicacao', '==', codigo))),
    ]);
    if (!snapPax.empty) return { uid: snapPax.docs[0].id, tipo: 'passageiro' };
    if (!snapMot.empty) return { uid: snapMot.docs[0].id, tipo: 'motorista' };
    return null;
  } catch (e) {
    console.warn('[motorista] erro ao resolver código de indicação:', e);
    return null;
  }
}

// Credita a recompensa de indicação de quem indicou o PASSAGEIRO dessa corrida:
// R$ fixo (configurável) na primeira corrida do indicado, e % (configurável) nas seguintes, pra sempre.
async function processarRecompensaIndicacao(corrida) {
  if (!firebaseReady || !db || !corrida?.passageiroId) return;
  try {
    const snapPax = await fb.getDoc(fb.doc(db, 'passageiros', corrida.passageiroId));
    if (!snapPax.exists()) return;
    const pax = snapPax.data();
    if (!pax.indicadoPor?.uid) return; // esse passageiro não foi indicado por ninguém

    const snapConfig = await fb.getDoc(fb.doc(db, 'config', 'indicacao'));
    const config = snapConfig.exists() ? snapConfig.data() : { valorPrimeiraCorrida: 0, percentualContinuo: 0 };

    if (!pax.bonusIndicacaoPago) {
      // Primeira corrida do indicado — credita o valor fixo
      if (config.valorPrimeiraCorrida > 0) {
        await lancarCarteira(pax.indicadoPor.uid, config.valorPrimeiraCorrida, 'Bônus: primeira corrida de indicado', corrida.id);
      }
      await fb.setDoc(fb.doc(db, 'passageiros', corrida.passageiroId), { bonusIndicacaoPago: true }, { merge: true });
    } else if (config.percentualContinuo > 0) {
      // Corridas seguintes — credita o percentual sobre o valor da corrida
      const valorCredito = Number(corrida.preco || 0) * (config.percentualContinuo / 100);
      if (valorCredito > 0) {
        await lancarCarteira(pax.indicadoPor.uid, valorCredito, `Indicação: ${config.percentualContinuo}% de corrida`, corrida.id);
      }
    }
  } catch (e) {
    console.warn('[motorista] erro ao processar recompensa de indicação:', e);
  }
}

// ─────────────────────────────────────
// ESTADO
// ─────────────────────────────────────
const state = {
  online: false,
  corridaAtualId: null,
  corridaAtual: null,
  countdownInterval: null,
  corridaChegouEm: null,
  countdownSegundos: 15,
  corridasListenerUnsub: null,
  chatListenerUnsub: null,
  motorista: { nome: 'Motorista', avaliacao: '4.8', veiculo: 'Honda Civic', placa: 'ABC-1234', selfie: null },
  historico: [],
};

// ─────────────────────────────────────
// NAVEGAÇÃO — função única, isolada deste arquivo
// ─────────────────────────────────────
const TELAS_SEM_HISTORICO_MOT = new Set([
  'screen-splash','screen-login-motorista','screen-cadastro-motorista',
  'screen-aguardando-aprovacao-motorista','screen-rejeitado-motorista','screen-bloqueado-motorista',
]);
const historicoNavMotorista = [];

function go(screenId) {
  const next = document.getElementById(screenId);
  if (!next) { console.warn('[go-motorista] Tela nao encontrada:', screenId); return; }
  const current = document.querySelector('.screen[data-active="true"]');
  if (current === next) return;

  const telaAtual = current?.id;
  if (telaAtual && !TELAS_SEM_HISTORICO_MOT.has(telaAtual) && !TELAS_SEM_HISTORICO_MOT.has(screenId)) {
    historicoNavMotorista.push(telaAtual);
    history.pushState({ tela: screenId }, '', '');
  }

  if (current) current.removeAttribute('data-active');
  next.setAttribute('data-active', 'true');

  const onEnterHandlers = {
    'screen-home': onEnterHome,
    'screen-ongoing': onEnterOngoing,
  };
  if (onEnterHandlers[screenId]) onEnterHandlers[screenId]();
}

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-go]');
  if (!target) return;
  const destino = target.dataset.go;
  // Enquanto a corrida estiver ativa, não deixa sair pra Home/Perfil/etc — sempre volta pro andamento
  if (state.emCorridaAtiva && destino !== 'screen-ongoing' && !destino.startsWith('screen-avaliar')) {
    showToast('🚗 Você está numa corrida em andamento');
    go('screen-ongoing');
    return;
  }
  go(destino);
});

// ─────────────────────────────────────
// TOAST
// ─────────────────────────────────────
let toastTimer = null;
function showToast(msg, duration = 2400) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), duration);
}

// ─────────────────────────────────────
// SOM DE NOVA CORRIDA
// ─────────────────────────────────────
let _audioCtx = null;

function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _audioCtx;
}

// Garante que o AudioContext está ativo antes de tocar qualquer som.
// No Android WebView, o contexto pode ficar suspended mesmo depois de
// uma interação — por isso forçamos o resume() sempre antes de usar.
async function garantirAudioAtivo() {
  const ctx = getAudioCtx();
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch(e) {}
  }
  return ctx;
}

// Inicia o contexto de áudio na primeira interação do usuário
document.addEventListener('click', () => { try { getAudioCtx().resume(); } catch(e) {} }, { once: false });
document.addEventListener('touchstart', () => { try { getAudioCtx().resume(); } catch(e) {} }, { once: false });

async function tocarSomNovaCorrida() {
  // No APK Android, usa notificação nativa (som/vibração garantidos mesmo
  // com o app em segundo plano). No navegador, usa AudioContext.
  if (window.AndroidNative?.tocarAlerta) {
    window.AndroidNative.tocarAlerta('nova_corrida');
  }
  // Toca também via AudioContext pra dar feedback imediato na tela
  // (a notificação nativa pode ter delay de alguns ms)
  try {
    const ctx = await garantirAudioAtivo();
    // Sequência musical ascendente — mais reconhecível que um bip simples
    const sequencia = [
      { freq: 523, dur: 0.12, delay: 0.00 },  // Dó
      { freq: 659, dur: 0.12, delay: 0.14 },  // Mi
      { freq: 784, dur: 0.12, delay: 0.28 },  // Sol
      { freq: 1047, dur: 0.25, delay: 0.42 }, // Dó alto
    ];
    const t0 = ctx.currentTime;
    sequencia.forEach(({ freq, dur, delay }) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine';
      o.frequency.value = freq;
      const t = t0 + delay;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.4, t + 0.03);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.start(t); o.stop(t + dur + 0.05);
    });
  } catch (e) { console.warn('[som] erro:', e); }
}

// ─────────────────────────────────────
// HOME — toggle online/offline
// ─────────────────────────────────────
function onEnterHome() {
  atualizarStatsHome();
  initHomeMapDriver();
}

// Chamado pelo MonitorCorridasService quando detecta nova corrida em segundo plano
window._novaCorridaSegundoPlano = function(corridaId) {
  // Nunca alertar em segundo plano se o motorista estiver Offline.
  if (!state.online) {
    console.log('[motorista] alerta de segundo plano ignorado — offline:', corridaId);
    return;
  }

  // Se o app está em primeiro plano, o onSnapshot normal já vai capturar.
  // Se está em segundo plano, o APK usa seu alerta nativo.
  tocarSomNovaCorrida();
};


// Abre uma corrida quando o motorista toca na notificação FCM nativa.
// O MainActivity chama window._abrirCorridaPush(corridaId).
window._abrirCorridaPush = async function(corridaId) {
  try {
    if (!corridaId) return;

    // Ao voltar pelo push, o Firebase pode ainda estar restaurando a sessão.
    // Espera alguns segundos antes de desistir.
    const limite = Date.now() + 8000;
    while ((!firebaseReady || !db || !meuMotoristaId) && Date.now() < limite) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    if (!firebaseReady || !db || !meuMotoristaId) {
      console.warn('[motorista] push recebido, mas Firebase/login ainda não ficou pronto:', corridaId);
      showToast('⚠️ Abra o app novamente para consultar a corrida');
      return;
    }

    const snap = await fb.getDoc(fb.doc(db, 'corridas', corridaId));
    if (!snap.exists()) {
      showToast('⚠️ Essa corrida não está mais disponível');
      return;
    }

    const corrida = { id: snap.id, ...snap.data() };

    if (corrida.status !== 'aguardando') {
      showToast('⚠️ Essa corrida já não está disponível');
      return;
    }

    // Se houver fila, só abre a oferta se ainda for a vez deste motorista.
    if (corrida.motoristaAlvoAtual &&
        corrida.motoristaAlvoAtual !== meuMotoristaId) {
      showToast('⏱️ O tempo dessa oferta já terminou');
      return;
    }

    // Não reapresenta uma corrida que este motorista já aceitou.
    if (corrida.motoristaId === meuMotoristaId) {
      return;
    }

    console.log('[motorista] abrindo corrida recebida via FCM:', corridaId);

    // Mantém a UI coerente mesmo quando o processo foi reaberto pelo push.
    state.online = true;
    const btn = document.getElementById('online-toggle');
    if (btn) {
      btn.dataset.online = 'true';
      const label = btn.querySelector('.online-label');
      if (label) label.textContent = 'Online';
    }

    state.corridaAtual = corrida;
    state.corridaAtualId = corrida.id;
    state.corridaChegouEm = Date.now();

    notificarNovaCorrida(corrida);
    exibirCorridaRecebida(corrida);
    go('screen-request');

  } catch (e) {
    console.error('[motorista] erro ao abrir corrida via FCM:', e);
    showToast('⚠️ Não foi possível abrir a corrida');
  }
};

function encerrarOperacaoMotorista() {
  // Força o estado local para Offline e encerra TUDO que pode continuar alertando.
  state.online = false;
  localStorage.setItem('interliga_motorista_online', 'false');

  try { pararEscutaCorridas(); } catch (e) {}
  try { pararDisponibilidade(); } catch (e) {}
  try { pararEscutaOferta(); } catch (e) {}
  try { clearInterval(state.countdownInterval); } catch (e) {}
  try { clearInterval(state.somRepeticaoInterval); } catch (e) {}
  try { window.speechSynthesis?.cancel(); } catch (e) {}

  if (window.AndroidNative?.desativarSegundoPlano) {
    try { window.AndroidNative.desativarSegundoPlano(); } catch (e) {}
  }
  if (window.AndroidNative?.pararMonitorSegundoPlano) {
    try { window.AndroidNative.pararMonitorSegundoPlano(); } catch (e) {}
  }

  const btn = document.getElementById('online-toggle');
  if (btn) {
    btn.dataset.online = 'false';
    const label = btn.querySelector('.online-label');
    if (label) label.textContent = 'Offline';
  }
}

document.getElementById('online-toggle')?.addEventListener('click', () => {
  state.online = !state.online;
  localStorage.setItem('interliga_motorista_online', state.online ? 'true' : 'false');
  const btn = document.getElementById('online-toggle');
  btn.dataset.online = state.online ? 'true' : 'false';
  btn.querySelector('.online-label').textContent = state.online ? 'Online' : 'Offline';

  if (state.online) {
    showToast('🟢 Você está online — buscando corridas...');
    iniciarEscutaCorridas();
    iniciarDisponibilidade();
    atualizarGridDemanda();
    iniciarListenerEntregas();
    if (window.AndroidNative?.ativarSegundoPlano) {
      window.AndroidNative.ativarSegundoPlano();
    }
    // Inicia o monitor de corridas em segundo plano passando o token de auth
    if (window.AndroidNative?.iniciarMonitorSegundoPlano && authMotorista) {
      try {
        authModRef.getIdToken(authMotorista.currentUser, false).then(token => {
          window.AndroidNative.iniciarMonitorSegundoPlano(meuMotoristaId || '', token);
        }).catch(() => {});
      } catch(e) {}
    }
  } else {
    showToast('🔴 Você está offline');
    encerrarOperacaoMotorista();
  }
});

async function atualizarStatsHome() {
  const historico = JSON.parse(localStorage.getItem('interliga_motorista_historico') || '[]');
  document.getElementById('stat-avaliacao').textContent = state.motorista.avaliacao || '—';

  const hoje = new Date().toDateString();
  const ganhosHoje = historico
    .filter(c => new Date(c.data).toDateString() === hoje)
    .reduce((acc, c) => acc + (c.valor || 0), 0);
  document.getElementById('earnings-today').textContent = 'R$ ' + ganhosHoje.toFixed(2).replace('.', ',');

  // Busca total de corridas do Firebase pra mostrar número real ao motorista
  if (firebaseReady && db && meuMotoristaId) {
    fb.getDocs(fb.query(
      fb.collection(db, 'corridas'),
      fb.where('motoristaId', '==', meuMotoristaId),
      fb.where('status', '==', 'finalizada')
    )).then(snap => {
      document.getElementById('stat-corridas').textContent = snap.size || historico.length;
    }).catch(() => {
      document.getElementById('stat-corridas').textContent = historico.length;
    });
  } else {
    document.getElementById('stat-corridas').textContent = historico.length;
  }
}

// ─────────────────────────────────────
// DISPONIBILIDADE — publica localização do motorista livre pro Firebase,
// pra que o passageiro consiga montar a fila por proximidade/avaliação.
// Só roda enquanto o motorista está Online E sem corrida ativa.
// ─────────────────────────────────────
let intervalDisponibilidade = null;

function publicarDisponibilidade() {
  if (!firebaseReady || !db || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      fb.setDoc(fb.doc(db, 'motoristas_disponiveis', meuMotoristaId), {
        nome: state.motorista.nome,
        avaliacao: state.motorista.avaliacao,
        cidade: state.motorista.cidade || 'madre',
        categoria: state.motorista.categoria || 'x',
        categorias: state.motorista.categorias || [state.motorista.categoria || 'x'],
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        atualizadoEm: fb.serverTimestamp(),
      }).catch((e) => console.warn('[motorista] erro ao publicar disponibilidade:', e));
    },
    () => {},
    { timeout: 5000 }
  );
}

function iniciarDisponibilidade() {
  publicarDisponibilidade();
  clearInterval(intervalDisponibilidade);
  intervalDisponibilidade = setInterval(publicarDisponibilidade, 45000); // atualiza a cada 45s (antes era 20s — reduz consumo de escritas no Firebase)
}

function pararDisponibilidade() {
  clearInterval(intervalDisponibilidade);
  intervalDisponibilidade = null;
  if (firebaseReady && db) {
    fb.deleteDoc(fb.doc(db, 'motoristas_disponiveis', meuMotoristaId)).catch(() => {});
  }
}

// ─────────────────────────────────────
// MAPA HOME
// ─────────────────────────────────────
let homeMapDriver = null;
let homeMapDriverTentativas = 0;
const CIDADES_INTERLIGA_MOT = {
  madre: [-12.7440, -38.6170],
  sfc: [-12.6275, -38.6800],
  candeias: [-12.6678, -38.5506],
  simoes: [-12.7870, -38.3990],
};

function initHomeMapDriver() {
  console.log('[mapa-motorista] initHomeMapDriver chamada. homeMapDriver atual:', homeMapDriver);

  if (homeMapDriver) {
    setTimeout(() => homeMapDriver.invalidateSize(), 100);
    return;
  }
  const el = document.getElementById('map-home-driver');
  if (!el) { console.warn('[mapa-motorista] elemento #map-home-driver não encontrado'); return; }

  const tryInit = () => {
    homeMapDriverTentativas++;
    if (typeof L === 'undefined') {
      if (homeMapDriverTentativas < 50) { setTimeout(tryInit, 150); return; }
      console.warn('[mapa-motorista] Leaflet (L) nunca carregou após várias tentativas');
      return;
    }
    if (el.offsetWidth < 10 || el.offsetHeight < 10) {
      if (homeMapDriverTentativas < 50) { setTimeout(tryInit, 150); return; }
      console.warn('[mapa-motorista] elemento sem dimensões visíveis após várias tentativas. width:', el.offsetWidth, 'height:', el.offsetHeight);
      return;
    }

    console.log('[mapa-motorista] criando mapa Leaflet agora');
    homeMapDriver = L.map('map-home-driver', { zoomControl: false, attributionControl: false })
      .setView([-12.7375, -38.6285], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(homeMapDriver);

    navigator.geolocation?.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      homeMapDriver.setView([latitude, longitude], 15);
      L.circleMarker([latitude, longitude], { radius: 8, color: '#1251B5', fillColor: '#1251B5', fillOpacity: 0.8 }).addTo(homeMapDriver);
    }, () => {}, { timeout: 5000 });

    // Grid de demanda (hexágonos com multiplicador) — atualiza ao abrir e depois de tempos em tempos
    atualizarGridDemanda();
    clearInterval(intervalGridDemanda);
    intervalGridDemanda = setInterval(atualizarGridDemanda, 30000);
  };
  tryInit();
}

// ─────────────────────────────────────
// GRID DE DEMANDA (hexágonos) — mostra visualmente onde tem mais corrida pedida
// do que motorista disponível, com o multiplicador de preço daquela área.
// ─────────────────────────────────────
const HEX_TAMANHO_METROS = 400; // raio de cada hexágono
const HEX_METROS_POR_GRAU_LAT = 111320;
function hexMetrosPorGrauLon(latRef) { return 111320 * Math.cos(latRef * Math.PI / 180); }

function hexLatLonParaXY(lat, lon, latRef, lonRef) {
  return {
    x: (lon - lonRef) * hexMetrosPorGrauLon(latRef),
    y: (lat - latRef) * HEX_METROS_POR_GRAU_LAT,
  };
}
function hexXYParaLatLon(x, y, latRef, lonRef) {
  return {
    lat: latRef + y / HEX_METROS_POR_GRAU_LAT,
    lon: lonRef + x / hexMetrosPorGrauLon(latRef),
  };
}
function hexArredondar(q, r) {
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return { q: rx, r: rz };
}
function hexObterCelula(lat, lon, latRef, lonRef) {
  const { x, y } = hexLatLonParaXY(lat, lon, latRef, lonRef);
  const q = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / HEX_TAMANHO_METROS;
  const r = (2 / 3 * y) / HEX_TAMANHO_METROS;
  return hexArredondar(q, r);
}
function hexCelulaParaXY(q, r) {
  return { x: HEX_TAMANHO_METROS * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r), y: HEX_TAMANHO_METROS * (3 / 2 * r) };
}
function hexCantos(centroX, centroY) {
  const cantos = [];
  for (let i = 0; i < 6; i++) {
    const ang = Math.PI / 180 * (60 * i - 30);
    cantos.push({ x: centroX + HEX_TAMANHO_METROS * Math.cos(ang), y: centroY + HEX_TAMANHO_METROS * Math.sin(ang) });
  }
  return cantos;
}

// Calcula o multiplicador de uma célula a partir da demanda (corridas aguardando) vs oferta (motoristas livres)
function calcularMultiplicadorZona(demanda, oferta) {
  if (demanda <= 0) return 1.0;
  if (oferta <= 0) return Math.min(2.0, 1.0 + demanda * 0.25);
  const proporcao = demanda / oferta;
  if (proporcao <= 1) return 1.0;
  return Math.min(2.0, 1.0 + (proporcao - 1) * 0.4);
}

function corPorMultiplicador(mult) {
  if (mult >= 1.7) return '#E8002D';
  if (mult >= 1.4) return '#FF6B00';
  if (mult >= 1.1) return '#F5A623';
  return null; // 1.0x não pinta nada (sem demanda extra)
}

let hexagonosNoMapa = [];
let intervalGridDemanda = null;

async function calcularZonasDemanda() {
  if (!firebaseReady || !db) return new Map();
  const latRef = state.motorista.cidade ? (CIDADES_INTERLIGA_MOT[state.motorista.cidade] || [-12.7440, -38.6170])[0] : -12.7440;
  const lonRef = state.motorista.cidade ? (CIDADES_INTERLIGA_MOT[state.motorista.cidade] || [-12.7440, -38.6170])[1] : -38.6170;

  const zonas = new Map(); // chave "q_r" -> { q, r, demanda, oferta }
  function celula(q, r) {
    const chave = q + '_' + r;
    if (!zonas.has(chave)) zonas.set(chave, { q, r, demanda: 0, oferta: 0 });
    return zonas.get(chave);
  }

  try {
    const [snapCorridas, snapMotoristas] = await Promise.all([
      fb.getDocs(fb.query(fb.collection(db, 'corridas'), fb.where('status', '==', 'aguardando'))),
      fb.getDocs(fb.collection(db, 'motoristas_disponiveis')),
    ]);
    snapCorridas.forEach(d => {
      const c = d.data();
      if (typeof c.origemLat !== 'number') return;
      if (state.motorista.cidade && c.cidade && c.cidade !== state.motorista.cidade) return;
      const { q, r } = hexObterCelula(c.origemLat, c.origemLon, latRef, lonRef);
      celula(q, r).demanda++;
    });
    snapMotoristas.forEach(d => {
      const m = d.data();
      if (typeof m.lat !== 'number') return;
      if (state.motorista.cidade && m.cidade && m.cidade !== state.motorista.cidade) return;
      const { q, r } = hexObterCelula(m.lat, m.lon, latRef, lonRef);
      celula(q, r).oferta++;
    });
  } catch (e) {
    console.warn('[motorista] erro ao calcular zonas de demanda:', e);
  }
  return { zonas, latRef, lonRef };
}

async function atualizarGridDemanda() {
  if (!homeMapDriver || typeof L === 'undefined' || !state.online) return;
  hexagonosNoMapa.forEach(h => homeMapDriver.removeLayer(h));
  hexagonosNoMapa = [];

  const { zonas, latRef, lonRef } = await calcularZonasDemanda();
  zonas.forEach(({ q, r, demanda, oferta }) => {
    const mult = calcularMultiplicadorZona(demanda, oferta);
    const cor = corPorMultiplicador(mult);
    if (!cor) return; // não desenha hexágono pra área sem demanda extra (fica "limpo" o mapa)

    const centro = hexCelulaParaXY(q, r);
    const cantosLatLon = hexCantos(centro.x, centro.y).map(c => hexXYParaLatLon(c.x, c.y, latRef, lonRef)).map(p => [p.lat, p.lon]);

    const poligono = L.polygon(cantosLatLon, { color: cor, weight: 1, fillColor: cor, fillOpacity: 0.35 }).addTo(homeMapDriver);
    const centroLatLon = hexXYParaLatLon(centro.x, centro.y, latRef, lonRef);
    const rotulo = L.marker([centroLatLon.lat, centroLatLon.lon], {
      icon: L.divIcon({ className: 'hex-label', html: `<div style="background:${cor};color:white;font-weight:700;font-size:11px;padding:3px 7px;border-radius:10px;white-space:nowrap;">${mult.toFixed(1)}x</div>`, iconSize: [40, 20] }),
    }).addTo(homeMapDriver);

    hexagonosNoMapa.push(poligono, rotulo);
  });
}

// ─────────────────────────────────────
// ESCUTAR NOVAS CORRIDAS (Firestore)
// ─────────────────────────────────────
function iniciarEscutaCorridas() {
  // Nunca escutar ofertas enquanto o motorista estiver Offline.
  if (!state.online) {
    console.log('[motorista] offline — listener de corridas não iniciado');
    return;
  }

  if (state.corridasListenerUnsub) return;

  if (firebaseReady && db) {
    try {
      // Query simplificada (sem orderBy) para não exigir índice composto no Firestore
      const q = fb.query(
        fb.collection(db, 'corridas'),
        fb.where('status', '==', 'aguardando')
      );
      state.corridasListenerUnsub = fb.onSnapshot(q, (snap) => {
        // O listener pode receber um último snapshot logo após ficar Offline.
        if (!state.online) {
          console.log('[motorista] snapshot ignorado — motorista offline');
          return;
        }

        console.log('[motorista] snapshot de corridas recebido. docs:', snap.docs.length);
        snap.docChanges().forEach(change => {
          if (!state.online) return;

          if (change.type === 'added' || change.type === 'modified') {
            const corrida = { id: change.doc.id, ...change.doc.data() };
            if (corrida.status !== 'aguardando') return;

            // Aceita Timestamp do Firestore, ISO string ou milissegundos.
            let criadoEmMs = null;
            if (corrida.criadoEm?.toMillis) {
              criadoEmMs = corrida.criadoEm.toMillis();
            } else if (typeof corrida.criadoEm === 'string') {
              const parsed = Date.parse(corrida.criadoEm);
              if (Number.isFinite(parsed)) criadoEmMs = parsed;
            } else if (typeof corrida.criadoEm === 'number') {
              criadoEmMs = corrida.criadoEm;
            }

            // Sem data válida ou com mais de 2 minutos: nunca anunciar como corrida nova.
            if (!criadoEmMs || Math.abs(Date.now() - criadoEmMs) > 2 * 60 * 1000) {
              console.log('[motorista] ignorando corrida antiga/inválida:', corrida.id);
              return;
            }

            // Fila de prioridade: só notifica quem é a vez (motoristaAlvoAtual).
            // Sem fila definida (corrida antiga ou sem motoristas disponíveis cadastrados) = modo aberto, notifica todo mundo.
            const souAlvo = !corrida.motoristaAlvoAtual || corrida.motoristaAlvoAtual === meuMotoristaId;
            if (!souAlvo) return;

            // Evita notificar de novo pela mesma "rodada" da fila (mas notifica de novo se a fila avançou,
            // mesmo que tenha voltado pro mesmo motorista — por isso usa ofertaExpiraEm, que sempre muda).
            // Usa um Set (não uma variável única) pra nunca esquecer o que já foi
            // notificado, mesmo se o listener for reiniciado (ex: ligar/desligar
            // online) — antes, reiniciar o listener podia re-notificar corridas
            // antigas que ainda estavam "aguardando" no banco.
            const chaveOferta = corrida.id + ':' + (corrida.motoristaAlvoAtual || 'todos') + ':' + (corrida.rodadaFila || 0) + ':' + (corrida.ofertaExpiraEm ?? 0);
            if (!state._ofertasJaNotificadas) state._ofertasJaNotificadas = new Set();
            if (state._ofertasJaNotificadas.has(chaveOferta)) return;
            // Nunca notifica de novo uma corrida que já é minha (já aceitei)
            if (corrida.motoristaId && corrida.motoristaId === meuMotoristaId) return;
            state._ofertasJaNotificadas.add(chaveOferta);

            console.log('[motorista] corrida nova/oferta detectada:', corrida);
            notificarNovaCorrida(corrida);
          }
        });
      }, (erro) => {
        console.error('[motorista] erro no listener de corridas:', erro);
      });
      return;
    } catch (e) {
      console.warn('Erro ao escutar corridas:', e);
    }
  }
  // Fallback local: olha localStorage periodicamente (útil para teste no mesmo dispositivo)
  state.corridasListenerUnsub = setInterval(() => {
    const lst = JSON.parse(localStorage.getItem('interliga_corridas') || '[]');
    const pendente = lst.find(c => c.status === 'aguardando');
    if (pendente && pendente.id !== state._ultimaNotificada) {
      state._ultimaNotificada = pendente.id;
      notificarNovaCorrida(pendente);
    }
  }, 3000);
}

function pararEscutaCorridas() {
  if (typeof state.corridasListenerUnsub === 'function') state.corridasListenerUnsub();
  else if (state.corridasListenerUnsub) clearInterval(state.corridasListenerUnsub);
  state.corridasListenerUnsub = null;
}

// ─────────────────────────────────────
// VOZ — avisos falados em voz alta, pro motorista não precisar ficar olhando a tela
// ─────────────────────────────────────
async function falarEmVoz(texto) {
  if (window.AndroidNative?.tocarAlerta) {
    // Passa 'cancelamento' ou 'nova_corrida' em vez do texto completo
    // pra o Java conseguir identificar o tipo correto
    const tipo = texto.toLowerCase().includes('cancelou') || texto.toLowerCase().includes('cancel')
      ? 'cancelamento' : 'nova_corrida';
    window.AndroidNative.tocarAlerta(tipo);
    return;
  }
  try {
    const ctx = await garantirAudioAtivo();
    const ehCancelamento = texto.toLowerCase().includes('cancel') || texto.toLowerCase().includes('passageiro cancelou');
    const notas = ehCancelamento ? [880, 660, 440] : [440, 660, 880];
    let t = ctx.currentTime;
    notas.forEach(freq => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = ehCancelamento ? 'sawtooth' : 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.6, t + 0.05);
      g.gain.linearRampToValueAtTime(0, t + 0.3);
      o.start(t); o.stop(t + 0.35); t += 0.38;
    });
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(texto);
      utter.lang = 'pt-BR'; utter.rate = 1;
      window.speechSynthesis.speak(utter);
    }
  } catch (e) { console.warn('[motorista] erro ao falar em voz:', e); }
}

// ─────────────────────────────────────
// ESCUTAR CANCELAMENTO DURANTE A OFERTA — se o passageiro cancelar enquanto
// ainda está chamando este motorista (antes de aceitar), para tudo na hora
// em vez de continuar tocando/falando até o contador de 15s zerar sozinho.
// ─────────────────────────────────────
let ofertaCancelamentoListenerUnsub = null;

function escutarCancelamentoOferta(corridaId) {
  if (!firebaseReady || !db) return;
  pararEscutaOferta();
  ofertaCancelamentoListenerUnsub = fb.onSnapshot(fb.doc(db, 'corridas', corridaId), (snap) => {
    const data = snap.data();
    if (!data || state.corridaAtualId !== corridaId) return;
    if (data.status === 'cancelada') {
      pararEscutaOferta();
      clearInterval(state.countdownInterval);
      clearInterval(state.somRepeticaoInterval);
      try { window.speechSynthesis?.cancel(); } catch (e) {}
      document.getElementById('request-card').hidden = true;
      document.getElementById('request-empty').hidden = false;
      document.getElementById('new-ride-banner').hidden = true;
      state.corridaAtual = null;
      state.corridaAtualId = null;
      state.emCorridaAtiva = false;
      showToast('❌ O passageiro cancelou essa corrida');
      go('screen-home');
    }
  }, (erro) => console.error('[motorista] erro no listener de cancelamento da oferta:', erro));
}

function pararEscutaOferta() {
  if (ofertaCancelamentoListenerUnsub) { ofertaCancelamentoListenerUnsub(); ofertaCancelamentoListenerUnsub = null; }
}

function notificarNovaCorrida(corrida) {
  // Última barreira: nunca anunciar uma oferta se estiver Offline.
  if (!state.online) {
    console.log('[motorista] oferta ignorada em notificarNovaCorrida — offline:', corrida?.id);
    return;
  }

  if (!corrida || corrida.status !== 'aguardando') {
    console.log('[motorista] oferta ignorada — status inválido:', corrida?.id, corrida?.status);
    return;
  }

  if (corrida.motoristaAlvoAtual && corrida.motoristaAlvoAtual !== meuMotoristaId) {
    console.log('[motorista] oferta ignorada — destinada a outro motorista:', corrida.id);
    return;
  }

  console.log('[motorista] Nova corrida recebida:', corrida);
  state.corridaAtual = corrida;
  state.corridaAtualId = corrida.id;
  // Guarda o momento exato que a corrida chegou
  state.corridaChegouEm = Date.now();

  tocarSomNovaCorrida();

  // A voz de "Nova corrida disponível" fica restrita ao APK.
  // No navegador, evita fala fantasma/repetida do speechSynthesis.
  if (window.AndroidNative) {
    falarEmVoz('Nova corrida disponível!');
  }

  escutarCancelamentoOferta(corrida.id);

  const banner = document.getElementById('new-ride-banner');
  const detail = document.getElementById('new-ride-detail');
  if (banner) {
    banner.hidden = false;
    if (detail) detail.textContent = `${corrida.origem} → ${corrida.destino}`;
  }

  showToast('🔔 Nova corrida disponível!');

  // Navega pra tela de corridas com delay de 1.5s
  const telaAtual = document.querySelector('.screen[data-active="true"]')?.id;
  if (telaAtual !== 'screen-request') {
    setTimeout(() => {
      exibirCorridaRecebida(corrida);
      go('screen-request');
    }, 1500);
  } else {
    exibirCorridaRecebida(corrida);
  }
}

// ─────────────────────────────────────
// TELA: CORRIDA RECEBIDA (aceitar/recusar)
// ─────────────────────────────────────
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-go="screen-request"]') && state.corridaAtual) {
    exibirCorridaRecebida(state.corridaAtual);
  }
});


async function geocodificarEnderecoOferta(texto) {
  if (!texto || typeof texto !== 'string') return null;
  try {
    const params = new URLSearchParams({
      q: texto,
      format: 'json',
      limit: '1',
      countrycodes: 'br'
    });
    const resp = await fetch('https://nominatim.openstreetmap.org/search?' + params.toString(), {
      headers: { 'Accept-Language': 'pt-BR' }
    });
    if (!resp.ok) return null;
    const lista = await resp.json();
    if (!Array.isArray(lista) || !lista[0]) return null;
    const lat = Number(lista[0].lat);
    const lon = Number(lista[0].lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  } catch (e) {
    console.warn('[motorista] falha ao geocodificar oferta:', e);
    return null;
  }
}

async function calcularRotaOferta(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false&alternatives=false&steps=false`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const rota = data?.routes?.[0];
    if (!rota) return null;
    return {
      km: Number(rota.distance || 0) / 1000,
      min: Math.max(1, Math.round(Number(rota.duration || 0) / 60))
    };
  } catch (e) {
    console.warn('[motorista] falha ao calcular rota da oferta:', e);
    return null;
  }
}

async function garantirCoordenadasOferta(corrida) {
  let origemLat = Number(corrida.origemLat);
  let origemLon = Number(corrida.origemLon);
  let destinoLat = Number(corrida.destinoLat);
  let destinoLon = Number(corrida.destinoLon);

  const origemValida = Number.isFinite(origemLat) && Number.isFinite(origemLon) &&
    Math.abs(origemLat) > 0.00001 && Math.abs(origemLon) > 0.00001;
  const destinoValido = Number.isFinite(destinoLat) && Number.isFinite(destinoLon) &&
    Math.abs(destinoLat) > 0.00001 && Math.abs(destinoLon) > 0.00001;

  if (!origemValida) {
    const geo = await geocodificarEnderecoOferta(corrida.origem);
    if (geo) {
      origemLat = geo.lat;
      origemLon = geo.lon;
      corrida.origemLat = geo.lat;
      corrida.origemLon = geo.lon;
    }
  }

  if (!destinoValido) {
    const geo = await geocodificarEnderecoOferta(corrida.destino);
    if (geo) {
      destinoLat = geo.lat;
      destinoLon = geo.lon;
      corrida.destinoLat = geo.lat;
      corrida.destinoLon = geo.lon;
    }
  }

  return {
    origemLat, origemLon, destinoLat, destinoLon,
    origemValida: Number.isFinite(origemLat) && Number.isFinite(origemLon),
    destinoValido: Number.isFinite(destinoLat) && Number.isFinite(destinoLon)
  };
}

async function atualizarMetricasOferta(corrida) {
  const elAtePax = document.getElementById('request-ate-pax');
  const elTempo = document.getElementById('request-tempo');
  const elDistancia = document.getElementById('request-distancia');

  if (elAtePax) elAtePax.textContent = 'Calculando...';
  if (elTempo) elTempo.textContent = 'Calculando...';
  if (elDistancia) elDistancia.textContent = 'Calculando...';

  const coords = await garantirCoordenadasOferta(corrida);

  // Distância total da corrida
  if (coords.origemValida && coords.destinoValido) {
    const rotaCorrida = await calcularRotaOferta(
      coords.origemLat, coords.origemLon,
      coords.destinoLat, coords.destinoLon
    );
    if (rotaCorrida && rotaCorrida.km > 0) {
      if (elDistancia) elDistancia.textContent = rotaCorrida.km.toFixed(1) + ' km';
      corrida.distanciaKmCalculada = rotaCorrida.km;
    } else {
      const km = haversineKm(coords.origemLat, coords.origemLon, coords.destinoLat, coords.destinoLon);
      if (elDistancia) elDistancia.textContent = km.toFixed(1) + ' km';
    }
  } else if (elDistancia) {
    elDistancia.textContent = '—';
  }

  // Posição do motorista -> passageiro
  let mLat = Number(state.motoristaLat);
  let mLon = Number(state.motoristaLon);

  if ((!Number.isFinite(mLat) || !Number.isFinite(mLon)) && navigator.geolocation) {
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 30000
        });
      });
      mLat = pos.coords.latitude;
      mLon = pos.coords.longitude;
      state.motoristaLat = mLat;
      state.motoristaLon = mLon;
    } catch (e) {
      console.warn('[motorista] GPS indisponível para calcular distância até passageiro:', e);
    }
  }

  if (Number.isFinite(mLat) && Number.isFinite(mLon) && coords.origemValida) {
    const rotaBusca = await calcularRotaOferta(mLat, mLon, coords.origemLat, coords.origemLon);
    if (rotaBusca && rotaBusca.km >= 0) {
      if (elAtePax) elAtePax.textContent = rotaBusca.km < 1
        ? Math.max(1, Math.round(rotaBusca.km * 1000)) + ' m'
        : rotaBusca.km.toFixed(1) + ' km';
      if (elTempo) elTempo.textContent = '~' + rotaBusca.min + ' min';
    } else {
      const kmAte = haversineKm(mLat, mLon, coords.origemLat, coords.origemLon);
      if (elAtePax) elAtePax.textContent = kmAte < 1
        ? Math.max(1, Math.round(kmAte * 1000)) + ' m'
        : kmAte.toFixed(1) + ' km';
      if (elTempo) elTempo.textContent = '~' + Math.max(1, Math.round((kmAte / 25) * 60)) + ' min';
    }
  } else {
    if (elAtePax) elAtePax.textContent = '—';
    if (elTempo) elTempo.textContent = '—';
  }
}

function exibirCorridaRecebida(corrida) {
  document.getElementById('request-empty').hidden = true;
  document.getElementById('request-card').hidden = false;

  document.getElementById('request-origem').textContent = corrida.origem || 'Origem';
  document.getElementById('request-destino').textContent = corrida.destino || 'Destino';
  document.getElementById('request-valor').textContent =
    'R$ ' + Number(corrida.preco || 18).toFixed(2).replace('.', ',');

  // Passageiro: foto, nome, avaliação e histórico.
  const nomePax = corrida.passageiroNome || 'Passageiro';
  const elPaxNome = document.getElementById('request-pax-nome');
  const elPaxAvatar = document.getElementById('request-pax-avatar');
  const elPaxStats = document.getElementById('request-pax-stats');
  const inicialPax = nomePax.slice(0, 2).toUpperCase();

  if (elPaxNome) elPaxNome.textContent = nomePax;
  renderAvatarMotorista(elPaxAvatar, corrida.passageiroSelfie || null, inicialPax);
  if (elPaxStats) elPaxStats.textContent = 'Carregando...';

  if (corrida.passageiroId && firebaseReady && db) {
    Promise.all([
      fb.getDoc(fb.doc(db, 'passageiros', corrida.passageiroId)),
      fb.getDocs(fb.query(
        fb.collection(db, 'corridas'),
        fb.where('passageiroId', '==', corrida.passageiroId),
        fb.where('status', '==', 'finalizada')
      )),
    ]).then(([snapPax, snapCorridas]) => {
      let avaliacao = null;

      if (snapPax.exists()) {
        const dadosPax = snapPax.data() || {};
        avaliacao = dadosPax.avaliacao || null;

        if (dadosPax.nome) {
          corrida.passageiroNome = dadosPax.nome;
          if (elPaxNome) elPaxNome.textContent = dadosPax.nome;
        }

        if (dadosPax.selfie) {
          corrida.passageiroSelfie = dadosPax.selfie;
          renderAvatarMotorista(
            elPaxAvatar,
            dadosPax.selfie,
            (dadosPax.nome || nomePax).slice(0, 2).toUpperCase()
          );
        }
      }

      const total = snapCorridas.size;
      if (elPaxStats) {
        const estrelas = avaliacao ? `⭐ ${avaliacao}` : '⭐ Sem avaliações';
        const corridas = total === 0
          ? '🆕 Primeira corrida'
          : `🚗 ${total} corrida${total > 1 ? 's' : ''}`;
        elPaxStats.textContent = `${estrelas} · ${corridas}`;
      }
    }).catch((e) => {
      console.warn('[motorista] erro ao carregar dados do passageiro na oferta:', e);
      if (elPaxStats) elPaxStats.textContent = '—';
    });
  } else if (elPaxStats) {
    elPaxStats.textContent = '—';
  }

  // Calcula rota/distâncias sem bloquear a exibição do card.
  atualizarMetricasOferta(corrida).catch((e) => {
    console.warn('[motorista] erro nas métricas da oferta:', e);
    const ate = document.getElementById('request-ate-pax');
    const tempo = document.getElementById('request-tempo');
    const dist = document.getElementById('request-distancia');
    if (ate) ate.textContent = '—';
    if (tempo) tempo.textContent = '—';
    if (dist) dist.textContent = '—';
  });

  iniciarCountdown();
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function iniciarCountdown() {
  // Desconta o tempo que já passou desde que a corrida chegou
  // (evita que o timer comece do zero quando o motorista abre o app)
  const tempoPassado = state.corridaChegouEm
    ? Math.floor((Date.now() - state.corridaChegouEm) / 1000)
    : 0;
  state.countdownSegundos = Math.max(1, 15 - tempoPassado);

  const numEl = document.getElementById('countdown-num');
  const fgEl = document.getElementById('countdown-fg');
  if (numEl) numEl.textContent = state.countdownSegundos;
  if (fgEl) fgEl.style.strokeDashoffset = (15 - state.countdownSegundos) * (100.5 / 15);

  // Toca o som de chamada repetidamente enquanto aguarda resposta
  tocarSomNovaCorrida();
  clearInterval(state.somRepeticaoInterval);
  state.somRepeticaoInterval = setInterval(() => tocarSomNovaCorrida(), 2000);

  clearInterval(state.countdownInterval);
  state.countdownInterval = setInterval(() => {
    state.countdownSegundos--;
    if (numEl) numEl.textContent = state.countdownSegundos;
    if (fgEl) fgEl.style.strokeDashoffset = (15 - state.countdownSegundos) * (100.5 / 15);
    if (state.countdownSegundos <= 0) {
      clearInterval(state.countdownInterval);
      clearInterval(state.somRepeticaoInterval);
      recusarCorrida();
      showToast('⏰ Tempo esgotado — corrida expirou');
    }
  }, 1000);
}

document.getElementById('btn-recusar')?.addEventListener('click', recusarCorrida);
// Avança a corrida pro próximo motorista da fila de prioridade. Se já passou
// por todo mundo, volta pro primeiro da lista (reoferece pra todo mundo de novo),
// em vez de matar a corrida — segue tentando até alguém aceitar.
async function avancarFilaOuReabrir(corridaId, corrida) {
  // Registra que EU recusei — vale pra qualquer modo (com ou sem fila),
  // pra o listener parar de me reofertar esta corrida.
  const recusantes = Array.isArray(corrida.recusantes) ? [...corrida.recusantes] : [];
  if (!recusantes.includes(meuMotoristaId)) recusantes.push(meuMotoristaId);

  const fila = corrida.filaMotoristas || [];
  if (fila.length === 0) {
    // modo aberto (sem fila): so marca minha recusa; a corrida segue 'aguardando' pros outros
    await fb.updateDoc(fb.doc(db, 'corridas', corridaId), { recusantes });
    return;
  }

  let indiceAtual = typeof corrida.filaIndiceAtual === 'number' ? corrida.filaIndiceAtual : 0;
  let proximoIndice = indiceAtual + 1;
  if (proximoIndice >= fila.length) proximoIndice = 0; // deu a volta — reoferece pra todo mundo

  await fb.updateDoc(fb.doc(db, 'corridas', corridaId), {
    filaIndiceAtual: proximoIndice,
    motoristaAlvoAtual: fila[proximoIndice],
    ofertaExpiraEm: Date.now() + 15000,
    recusantes,
  });
}

// Quantos segundos ate re-oferecer uma corrida que EU recusei/ignorei (ajuste aqui)
const REOFERTA_COOLDOWN_MS = 20000; // 20s

function agendarReoferta(corridaId) {
  if (!state._reofertaTimers) state._reofertaTimers = {};
  clearTimeout(state._reofertaTimers[corridaId]);
  state._reofertaTimers[corridaId] = setTimeout(() => reofertarSeAindaLivre(corridaId), REOFERTA_COOLDOWN_MS);
}

function cancelarReoferta(corridaId) {
  if (state._reofertaTimers && state._reofertaTimers[corridaId]) {
    clearTimeout(state._reofertaTimers[corridaId]);
    delete state._reofertaTimers[corridaId];
  }
}

async function reofertarSeAindaLivre(corridaId) {
  if (!state.online) { showToast('⏱️ Cooldown venceu, mas estou offline'); return; }
  if (!firebaseReady || !db) { showToast('⏱️ Cooldown venceu, sem Firebase'); return; }
  try {
    const snap = await fb.getDoc(fb.doc(db, 'corridas', corridaId));
    if (!snap.exists()) { showToast('⚠️ Corrida sumiu do banco'); return; }
    const data = snap.data();
    if (data.status !== 'aguardando') { showToast('⚠️ Corrida já ' + data.status + ' — nao reoferece'); return; }
    if (data.motoristaId === meuMotoristaId) { showToast('⚠️ Essa corrida já e minha'); return; }
    if (data.motoristaAlvoAtual && data.motoristaAlvoAtual !== meuMotoristaId) { showToast('⚠️ E a vez de outro motorista'); return; }
    if (state._ofertasJaNotificadas) {
      for (const k of [...state._ofertasJaNotificadas]) {
        if (k.startsWith(corridaId + ':')) state._ofertasJaNotificadas.delete(k);
      }
    }
    showToast('🔁 Reofertando a corrida agora');
    console.log('[motorista] re-ofertando corrida apos cooldown:', corridaId);
    notificarNovaCorrida({ id: corridaId, ...data });
  } catch (e) {
    showToast('⚠️ Erro ao reofertar: ' + (e && e.message ? e.message : e));
    console.warn('[motorista] erro ao re-ofertar:', e);
  }
}

function recusarCorrida() {
  clearInterval(state.countdownInterval);
  clearInterval(state.somRepeticaoInterval);
  pararEscutaOferta();

  const corridaId = state.corridaAtualId;
  const corrida = state.corridaAtual;
  if (firebaseReady && db && corridaId && !String(corridaId).startsWith('local-') && corrida) {
    avancarFilaOuReabrir(corridaId, corrida).catch((e) =>
      console.error('[motorista] erro ao avançar fila na recusa:', e)
    );
    // Unico (ou ninguem pegou): re-oferece pra mim depois do cooldown
    agendarReoferta(corridaId);
    showToast('↩️ Recusada — reofereço em ' + (REOFERTA_COOLDOWN_MS/1000) + 's');
  }

  document.getElementById('request-card').hidden = true;
  document.getElementById('request-empty').hidden = false;
  document.getElementById('new-ride-banner').hidden = true;
  state.corridaAtual = null;
  state.corridaAtualId = null;
  state.emCorridaAtiva = false;

  // Para o listener atual e reinicia pra garantir que volta a receber novas corridas
  pararEscutaCorridas();
  if (state.online) {
    iniciarDisponibilidade();
    setTimeout(() => iniciarEscutaCorridas(), 1500);
  }

  go('screen-home');
}

document.getElementById('btn-aceitar')?.addEventListener('click', aceitarCorrida);
async function aceitarCorrida() {
  clearInterval(state.countdownInterval);
  clearInterval(state.somRepeticaoInterval);
  pararEscutaOferta();
  cancelarReoferta(state.corridaAtualId);
  const corrida = state.corridaAtual;
  if (!corrida) {
    showToast('⚠️ Esta corrida já não está disponível');
    document.getElementById('request-card').hidden = true;
    document.getElementById('request-empty').hidden = false;
    document.getElementById('new-ride-banner').hidden = true;
    go('screen-home');
    return;
  }

  // Atualizar status no Firebase — usando transação, pra garantir que só o
  // primeiro motorista a clicar "aceitar" consiga, mesmo se dois clicarem juntos
  if (firebaseReady && db && state.corridaAtualId && !String(state.corridaAtualId).startsWith('local-')) {
    try {
      const conseguiu = await fb.runTransaction(db, async (tx) => {
        const ref = fb.doc(db, 'corridas', state.corridaAtualId);
        const snap = await tx.get(ref);
        const data = snap.data();
        if (!data || data.status !== 'aguardando') return false; // outro motorista já pegou, ou foi cancelada
        tx.update(ref, {
          status: 'aceita',
          motoristaId: meuMotoristaId,
          motoristaNome: state.motorista.nome,
          motoristaVeiculo: state.motorista.veiculo,
          motoristaPlaca: state.motorista.placa,
          motoristaAvaliacao: state.motorista.avaliacao,
          motoristaSelfie: state.motorista.selfie || null,
        });
        return true;
      });
      if (!conseguiu) {
        showToast('⚠️ Essa corrida já foi aceita por outro motorista');
        document.getElementById('request-card').hidden = true;
        document.getElementById('request-empty').hidden = false;
        document.getElementById('new-ride-banner').hidden = true;
        state.corridaAtual = null;
        state.corridaAtualId = null;
        state.emCorridaAtiva = false;
        go('screen-home');
        return;
      }
    } catch (e) {
      console.error('[motorista] Falha ao atualizar Firebase:', e);
    }
  }

  pararDisponibilidade(); // fico fora da fila de novas ofertas enquanto rodo essa corrida
  pararEscutaCorridas(); // e paro de escutar/notificar novas corridas também, até finalizar ou cancelar essa

  // Salva corrida ativa no localStorage para restaurar se o app fechar
  try {
    localStorage.setItem('interliga_mot_corrida_ativa', JSON.stringify({
      corridaId: corrida.id,
      origem: corrida.origem,
      destino: corrida.destino,
      passageiroId: corrida.passageiroId,
      passageiroNome: corrida.passageiroNome,
      passageiroSelfie: corrida.passageiroSelfie || null,
      preco: corrida.preco,
      criadoEm: Date.now(),
    }));
  } catch(e) {}

  // Também atualizar localStorage (mesmo dispositivo / fallback)
  try {
    const lst = JSON.parse(localStorage.getItem('interliga_corridas') || '[]');
    const idx = lst.findIndex(c => c.id === corrida.id);
    if (idx >= 0) lst[idx].status = 'aceita';
    localStorage.setItem('interliga_corridas', JSON.stringify(lst));
  } catch (e) {}

  // Persiste a corrida ativa — se o app fechar e reabrir, retoma automaticamente
  localStorage.setItem('interliga_mot_corrida_ativa', JSON.stringify({
    corridaId: corrida.id,
    origem: corrida.origem,
    destino: corrida.destino,
    preco: corrida.preco,
    passageiroNome: corrida.passageiroNome,
    passageiroSelfie: corrida.passageiroSelfie || null,
    passageiroId: corrida.passageiroId || null,
    aceitoEm: Date.now(),
  }));

  document.getElementById('new-ride-banner').hidden = true;
  showToast('✓ Corrida aceita! Indo ao passageiro.');

  try {
    go('screen-ongoing');
  } catch (e) {
    console.error('[motorista] ERRO CRÍTICO ao navegar para screen-ongoing:', e);
  }
}

// ─────────────────────────────────────
// TELA: CORRIDA EM ANDAMENTO
// ─────────────────────────────────────
let mapOngoing = null;
let chegouAoCliente = false;

function onEnterOngoing() {
  const corrida = state.corridaAtual;
  if (!corrida) { console.warn('[onEnterOngoing] sem corrida atual'); return; }
  state.emCorridaAtiva = true;

  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setText('ongoing-origem', corrida.origem);
  setText('ongoing-destino', corrida.destino);
  setText('passenger-name', corrida.passageiroNome || 'Passageiro');

  const passengerAvatar = document.getElementById('passenger-avatar');
  const inicialPassageiro = (corrida.passageiroNome || 'PS').slice(0, 2).toUpperCase();
  renderAvatarMotorista(passengerAvatar, corrida.passageiroSelfie || null, inicialPassageiro);

  setText('passenger-rating', '⭐ —');
  setText('passenger-corridas', '');

  if (corrida.passageiroId && firebaseReady && db) {
    // Busca avaliação e total de corridas do passageiro ao mesmo tempo
    Promise.all([
      fb.getDoc(fb.doc(db, 'passageiros', corrida.passageiroId)),
      fb.getDocs(fb.query(
        fb.collection(db, 'corridas'),
        fb.where('passageiroId', '==', corrida.passageiroId),
        fb.where('status', '==', 'finalizada')
      )),
    ]).then(([snapPax, snapCorridas]) => {
      if (snapPax.exists()) {
        const dadosPax = snapPax.data() || {};

        if (dadosPax.nome) {
          setText('passenger-name', dadosPax.nome);
        }

        if (dadosPax.selfie) {
          corrida.passageiroSelfie = dadosPax.selfie;
          renderAvatarMotorista(
            passengerAvatar,
            dadosPax.selfie,
            (dadosPax.nome || corrida.passageiroNome || 'PS').slice(0, 2).toUpperCase()
          );
        }

        if (dadosPax.avaliacao) {
          setText('passenger-rating', '⭐ ' + dadosPax.avaliacao);
        }
      }
      const totalCorridas = snapCorridas.size;
      const elCorridas = document.getElementById('passenger-corridas');
      if (elCorridas) {
        if (totalCorridas === 0) {
          elCorridas.textContent = '🆕 Primeiro pedido!';
          elCorridas.style.color = '#f59e0b';
        } else {
          elCorridas.textContent = `🚗 ${totalCorridas} corrida${totalCorridas > 1 ? 's' : ''} realizad${totalCorridas > 1 ? 'as' : 'a'}`;
          elCorridas.style.color = 'var(--text-soft)';
        }
      }
    }).catch(() => {});
  }

  chegouAoCliente = false;
  sequenciaRotaMotorista = [];
  indiceRotaAtualMotorista = 0;

  // Monta a rota imediatamente com os dados que já temos (não espera o listener)
  if (corrida.sequenciaRota && corrida.sequenciaRota.length > 0) {
    sequenciaRotaMotorista = corrida.sequenciaRota;
    indiceRotaAtualMotorista = corrida.indiceRotaAtual || 0;
  } else {
    sequenciaRotaMotorista = [
      { texto: corrida.origem || 'Origem', tipo: 'origem' },
      { texto: corrida.destino || 'Destino', tipo: 'destino' },
    ];
  }
  renderRotaMotorista();

  const btnCheguei = document.getElementById('btn-cheguei');
  const btnIniciar = document.getElementById('btn-iniciar-viagem');
  const btnFinalizar = document.getElementById('btn-finalizar-corrida');
  const btnSeguir = document.getElementById('btn-seguir-viagem');

  const viagemJaIniciada = corrida.status === 'em_andamento';

  if (btnCheguei) btnCheguei.hidden = false;
  if (btnIniciar) btnIniciar.hidden = true;
  if (btnFinalizar) btnFinalizar.hidden = true;
  if (btnSeguir) btnSeguir.hidden = true;

  // Ao restaurar uma corrida já iniciada, o próximo "Cheguei"
  // passa a representar chegada à próxima parada/destino.
  chegouAoCliente = viagemJaIniciada;

  try { initMapOngoing(corrida); } catch (e) { console.error('[motorista] erro ao iniciar mapa ongoing:', e); }
  try { iniciarChatMotorista(); } catch (e) { console.error('[motorista] erro ao iniciar chat:', e); }
  try { escutarCancelamentoCorrida(); } catch (e) { console.error('[motorista] erro ao escutar cancelamento:', e); }
  try { escutarMudancasRota(); } catch (e) { console.error('[motorista] erro ao escutar rota:', e); }

  // Atrasa o pedido de geolocalização para depois da tela já estar renderizada,
  // evitando que o prompt de permissão pareça travar a navegação
  setTimeout(() => {
    try { iniciarBroadcastPosicao(); } catch (e) { console.error('[motorista] erro ao iniciar broadcast posição:', e); }
  }, 500);
}

// ─────────────────────────────────────
// ESCUTAR MUDANÇAS NA ROTA (paradas adicionadas pelo passageiro)
// ─────────────────────────────────────
let rotaListenerUnsub = null;
let sequenciaRotaMotorista = [];
let indiceRotaAtualMotorista = 0;

function escutarMudancasRota() {
  if (!firebaseReady || !db || !state.corridaAtualId || rotaListenerUnsub) return;
  if (String(state.corridaAtualId).startsWith('local-')) return;

  rotaListenerUnsub = fb.onSnapshot(fb.doc(db, 'corridas', state.corridaAtualId), (snap) => {
    const data = snap.data();
    if (!data) return;

    // Mantem o preco sincronizado (ex.: passageiro adicionou parada em andamento)
    if (typeof data.preco === 'number' && state.corridaAtual) {
      state.corridaAtual.preco = data.preco;
    }

    if (data.sequenciaRota && data.sequenciaRota.length > 0) {
      // Corrida com rota estruturada (paradas cadastradas)
      sequenciaRotaMotorista = data.sequenciaRota;
      indiceRotaAtualMotorista = data.indiceRotaAtual || 0;
    } else if (sequenciaRotaMotorista.length === 0) {
      // Corrida simples (só origem → destino) — monta a rota mínima
      sequenciaRotaMotorista = [
        { texto: data.origem || 'Origem', tipo: 'origem' },
        { texto: data.destino || 'Destino', tipo: 'destino' },
      ];
      indiceRotaAtualMotorista = 0;
    }
    renderRotaMotorista();
  }, (erro) => console.error('[motorista] erro no listener de rota:', erro));
}

function pararEscutaRota() {
  if (rotaListenerUnsub) { rotaListenerUnsub(); rotaListenerUnsub = null; }
}

function renderRotaMotorista() {
  if (sequenciaRotaMotorista.length === 0) return;
  const pontoAtual = sequenciaRotaMotorista[indiceRotaAtualMotorista];
  const proximoPonto = sequenciaRotaMotorista[indiceRotaAtualMotorista + 1];

  const origemEl = document.getElementById('ongoing-origem');
  const destinoEl = document.getElementById('ongoing-destino');
  if (origemEl) origemEl.textContent = pontoAtual?.texto || '—';
  if (destinoEl) destinoEl.textContent = proximoPonto?.texto || '—';

  const restantes = sequenciaRotaMotorista.slice(indiceRotaAtualMotorista + 2);
  const elRestantes = document.getElementById('ongoing-proximas-paradas');
  if (elRestantes) {
    elRestantes.innerHTML = restantes.length > 0
      ? 'Depois: ' + restantes.map(p => p.texto).join(' → ')
      : '';
  }
}

// ─────────────────────────────────────
// NAVEGAÇÃO EXTERNA — Waze / Google Maps até o próximo ponto da rota
// (este app não tem GPS de navegação próprio; abre o app externo de verdade)
// ─────────────────────────────────────
function obterProximoPontoNavegacao() {
  if (sequenciaRotaMotorista.length > 0) {
    const proximo = sequenciaRotaMotorista[indiceRotaAtualMotorista + 1];
    if (proximo && typeof proximo.lat === 'number' && typeof proximo.lon === 'number') return proximo;
  }
  const corrida = state.corridaAtual;
  if (corrida && typeof corrida.destinoLat === 'number') {
    return { lat: corrida.destinoLat, lon: corrida.destinoLon, texto: corrida.destino };
  }
  return null;
}

document.getElementById('btn-nav-waze')?.addEventListener('click', () => {
  const p = obterProximoPontoNavegacao();
  if (!p) { showToast('⚠️ Sem coordenadas pra navegar ainda'); return; }
  window.open(`https://waze.com/ul?ll=${p.lat},${p.lon}&navigate=yes`, '_blank');
});
document.getElementById('btn-nav-gmaps')?.addEventListener('click', () => {
  const p = obterProximoPontoNavegacao();
  if (!p) { showToast('⚠️ Sem coordenadas pra navegar ainda'); return; }
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=driving`, '_blank');
});

// ─────────────────────────────────────
// ESCUTAR CANCELAMENTO — se o passageiro cancelar, motorista é avisado
// ─────────────────────────────────────
let cancelamentoListenerUnsub = null;

function escutarCancelamentoCorrida() {
  if (!firebaseReady || !db || !state.corridaAtualId || cancelamentoListenerUnsub) return;
  if (String(state.corridaAtualId).startsWith('local-')) return;

  const corridaId = state.corridaAtualId;

  cancelamentoListenerUnsub = fb.onSnapshot(fb.doc(db, 'corridas', corridaId), (snap) => {
    const data = snap.data();
    if (!data) return;
    if (data.status === 'cancelada') {
      reagirAoCancelamentoPeloPassageiro();
    }
  }, (erro) => console.error('[motorista] erro no listener de cancelamento:', erro));

  // Fallback: verifica o status a cada 10 segundos caso o onSnapshot
  // não chegue (ex: app voltando do segundo plano, WebView suspenso)
  if (state._cancelamentoFallbackInterval) clearInterval(state._cancelamentoFallbackInterval);
  state._cancelamentoFallbackInterval = setInterval(async () => {
    if (!state.corridaAtualId || !firebaseReady || !db) return;
    try {
      const snap = await fb.getDoc(fb.doc(db, 'corridas', state.corridaAtualId));
      if (snap.exists() && snap.data()?.status === 'cancelada') {
        reagirAoCancelamentoPeloPassageiro();
      }
    } catch (e) {}
  }, 10000);
}

function reagirAoCancelamentoPeloPassageiro() {
  if (state._cancelamentoFallbackInterval) { clearInterval(state._cancelamentoFallbackInterval); state._cancelamentoFallbackInterval = null; }
  pararEscutaCancelamento();
  pararEscutaChat();
  pararEscutaRota();
  pararBroadcastPosicao();
  marcadorMotoristaMap = null;
  sequenciaRotaMotorista = [];
  indiceRotaAtualMotorista = 0;
  state.corridaAtual = null;
  state.corridaAtualId = null;
  state.emCorridaAtiva = false;
  falarEmVoz('Atenção! O passageiro cancelou a corrida.');
  showToast('❌ Passageiro cancelou a corrida');
  if (state.online) { iniciarDisponibilidade(); iniciarEscutaCorridas(); }
  go('screen-home');
}

function pararEscutaCancelamento() {
  if (cancelamentoListenerUnsub) { cancelamentoListenerUnsub(); cancelamentoListenerUnsub = null; }
}

// ─────────────────────────────────────
// BROADCAST DE POSIÇÃO EM TEMPO REAL (motorista → Firebase → passageiro)
// ─────────────────────────────────────
// Chamada pelo RastreamentoService.java (Android nativo) quando o app está
// minimizado/tela apagada — o WebView sozinho não consegue manter o GPS
// funcionando nesse estado, então o serviço nativo assume e manda a posição
// pra cá, reaproveitando a mesma lógica de sempre.
window.receberPosicaoNativa = function(lat, lon) {
  atualizarPosicaoNoMapa(lat, lon);
  if (firebaseReady && db && state.corridaAtualId && !String(state.corridaAtualId).startsWith('local-')) {
    fb.updateDoc(fb.doc(db, 'corridas', state.corridaAtualId), {
      motoristaLat: lat,
      motoristaLon: lon,
      motoristaAtualizadoEm: Date.now(),
    }).catch((e) => console.error('[motorista] erro ao salvar posição nativa no Firebase:', e));
  }
};

let watchPositionId = null;
let marcadorMotoristaMap = null;

function iniciarBroadcastPosicao() {
  pararBroadcastPosicao();
  const badge = document.getElementById('ongoing-eta-badge');

  if (!navigator.geolocation) {
    if (badge) badge.textContent = '⚠️ Geolocalização não suportada';
    return;
  }

  if (badge) badge.textContent = '📡 Obtendo localização...';

  watchPositionId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      state.motoristaLat = latitude;
      state.motoristaLon = longitude;
      if (badge) badge.textContent = '🟢 Localização ativa';
      atualizarPosicaoNoMapa(latitude, longitude);

      if (firebaseReady && db && state.corridaAtualId && !String(state.corridaAtualId).startsWith('local-')) {
        fb.updateDoc(fb.doc(db, 'corridas', state.corridaAtualId), {
          motoristaLat: latitude,
          motoristaLon: longitude,
          motoristaAtualizadoEm: Date.now(),
        }).catch((e) => console.error('[motorista] erro ao salvar posição no Firebase:', e));
      }
    },
    (erro) => {
      console.warn('[motorista] erro ao obter posição:', erro);
      if (badge) {
        const motivos = { 1: 'Permissão negada', 2: 'Posição indisponível', 3: 'Tempo esgotado' };
        badge.textContent = '⚠️ ' + (motivos[erro.code] || 'Erro de localização');
      }
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
}

function pararBroadcastPosicao() {
  if (watchPositionId !== null) {
    navigator.geolocation.clearWatch(watchPositionId);
    watchPositionId = null;
  }
}

function atualizarPosicaoNoMapa(lat, lon) {
  if (!mapOngoing) return;
  if (!marcadorMotoristaMap) {
    marcadorMotoristaMap = L.marker([lat, lon], {
      icon: L.divIcon({ className: '', html: '<div style="font-size:24px;">🚗</div>', iconSize: [30,30] })
    }).addTo(mapOngoing);
  } else {
    marcadorMotoristaMap.setLatLng([lat, lon]);
  }
  mapOngoing.panTo([lat, lon]);
}

function initMapOngoing(corrida) {
  const el = document.getElementById('map-ongoing');
  if (!el) return;

  const tryInit = () => {
    if (typeof L === 'undefined') { setTimeout(tryInit, 150); return; }
    if (el.offsetWidth < 10 || el.offsetHeight < 10) { setTimeout(tryInit, 150); return; }

    if (mapOngoing) { mapOngoing.remove(); mapOngoing = null; }

    const lat = corrida.origemLat || -12.7375;
    const lon = corrida.origemLon || -38.6285;
    mapOngoing = L.map('map-ongoing', { zoomControl: false, attributionControl: false }).setView([lat, lon], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapOngoing);
    L.marker([lat, lon]).addTo(mapOngoing);
  };
  tryInit();
}

document.getElementById('btn-cheguei')?.addEventListener('click', async () => {
  console.log('[motorista] btn-cheguei clicado.');

  // Antes de iniciar a viagem, "Cheguei" significa chegada ao passageiro/origem.
  if (state.corridaAtual?.status !== 'em_andamento') {
    if (firebaseReady && db && state.corridaAtualId &&
        !String(state.corridaAtualId).startsWith('local-')) {
      try {
        await fb.updateDoc(fb.doc(db, 'corridas', state.corridaAtualId), {
          motoristaChegou: true,
          motoristaChegouEm: fb.serverTimestamp(),
        });

        if (state.corridaAtual) {
          state.corridaAtual.motoristaChegou = true;
        }
      } catch (e) {
        console.error('[motorista] erro ao registrar chegada ao passageiro:', e);
        showToast('⚠️ Não foi possível avisar o passageiro. Tente novamente.');
        return;
      }
    }

    document.getElementById('btn-cheguei').hidden = true;
    document.getElementById('btn-iniciar-viagem').hidden = false;
    document.getElementById('ongoing-eta-badge').textContent = '📍 Passageiro avisado';

    showToast('🔔 Passageiro avisado que você chegou');
    enviarMsgChatMotorista('🚗 Motorista chegou ao seu local!', true);
    return;
  }

  // Viagem já iniciada: agora "Cheguei" representa parada/destino.
  const totalPontos = sequenciaRotaMotorista.length;
  const temParadaPendente =
    totalPontos > 2 && indiceRotaAtualMotorista < totalPontos - 2;

  if (temParadaPendente) {
    document.getElementById('btn-cheguei').hidden = true;
    document.getElementById('btn-seguir-viagem').hidden = false;
    document.getElementById('ongoing-eta-badge').textContent =
      '🟢 Chegou na parada ' + (indiceRotaAtualMotorista + 1);

    showToast('🔔 Parada registrada');
    enviarMsgChatMotorista(
      '🚗 Motorista chegou na parada! Aguardando para seguir viagem.',
      true
    );
  } else {
    chegouAoCliente = true;
    document.getElementById('btn-cheguei').hidden = true;
    document.getElementById('btn-finalizar-corrida').hidden = false;
    document.getElementById('ongoing-eta-badge').textContent = '🟢 Você chegou!';

    showToast('📍 Chegada ao destino registrada');
  }
});

document.getElementById('btn-iniciar-viagem')?.addEventListener('click', async () => {
  if (!state.corridaAtual) return;

  if (firebaseReady && db && state.corridaAtualId &&
      !String(state.corridaAtualId).startsWith('local-')) {
    try {
      await fb.updateDoc(fb.doc(db, 'corridas', state.corridaAtualId), {
        status: 'em_andamento',
        viagemIniciadaEm: fb.serverTimestamp(),
      });
    } catch (e) {
      console.error('[motorista] erro ao iniciar viagem:', e);
      showToast('⚠️ Não foi possível iniciar a viagem. Tente novamente.');
      return;
    }
  }

  state.corridaAtual.status = 'em_andamento';

  document.getElementById('btn-iniciar-viagem').hidden = true;
  document.getElementById('btn-cheguei').hidden = false;
  document.getElementById('ongoing-eta-badge').textContent =
    '🚗 Viagem em andamento';

  showToast('▶ Viagem iniciada!');
  enviarMsgChatMotorista('🚗 Viagem iniciada!', true);
});

document.getElementById('btn-seguir-viagem')?.addEventListener('click', () => {
  indiceRotaAtualMotorista++;
  renderRotaMotorista();

  // Sincroniza com o Firebase para o passageiro também ver a rota atualizada
  if (firebaseReady && db && state.corridaAtualId && !String(state.corridaAtualId).startsWith('local-')) {
    fb.updateDoc(fb.doc(db, 'corridas', state.corridaAtualId), {
      indiceRotaAtual: indiceRotaAtualMotorista,
    }).catch((e) => console.error('[motorista] erro ao sincronizar avanço de rota:', e));
  }

  document.getElementById('btn-seguir-viagem').hidden = true;
  document.getElementById('btn-cheguei').hidden = false;
  document.getElementById('ongoing-eta-badge').textContent = '🕒 -- até o próximo destino';
  showToast('▶ Seguindo para: ' + (sequenciaRotaMotorista[indiceRotaAtualMotorista + 1]?.texto || 'destino'));
  enviarMsgChatMotorista('🚗 Motorista seguiu viagem!', true);
});

document.getElementById('btn-finalizar-corrida')?.addEventListener('click', finalizarCorrida);

// ─── Botão de pânico / emergência ───
document.getElementById('btn-panico-motorista')?.addEventListener('click', () => acionarEmergencia());
async function acionarEmergencia() {
  const ok = confirm('🆘 Acionar EMERGÊNCIA?\n\nSua localização será registrada e o telefone vai ligar para a polícia (190).');
  if (!ok) return;
  const lat = (typeof state.motoristaLat === 'number') ? state.motoristaLat : null;
  const lon = (typeof state.motoristaLon === 'number') ? state.motoristaLon : null;
  try {
    if (firebaseReady && db) {
      await fb.addDoc(fb.collection(db, 'emergencias'), {
        tipo: 'motorista',
        corridaId: state.corridaAtualId || null,
        uid: (typeof meuMotoristaId !== 'undefined' ? meuMotoristaId : null),
        nome: (state.motorista && state.motorista.nome) || '—',
        veiculo: (state.motorista && state.motorista.veiculo) || null,
        placa: (state.motorista && state.motorista.placa) || null,
        cidade: (state.motorista && state.motorista.cidade) || null,
        lat, lon, status: 'ativo',
        criadoEm: fb.serverTimestamp(),
      });
    }
  } catch (e) { console.error('[motorista] erro ao registrar emergencia:', e); }
  try { window.location.href = 'tel:190'; } catch (e) {}
}


document.getElementById('link-cancelar-corrida-motorista')?.addEventListener('click', cancelarCorridaMotorista);
async function cancelarCorridaMotorista() {
  const corrida = state.corridaAtual;
  if (!corrida) { go('screen-home'); return; }
  if (!confirm('Cancelar essa corrida? O passageiro será avisado.')) return;

  if (firebaseReady && db && state.corridaAtualId && !String(state.corridaAtualId).startsWith('local-')) {
    try {
      await fb.updateDoc(fb.doc(db, 'corridas', state.corridaAtualId), {
        status: 'cancelada',
        canceladoPor: 'motorista',
      });
    } catch (e) {
      console.error('[motorista] erro ao cancelar corrida:', e);
      showToast('⚠️ Erro ao cancelar — tenta de novo');
      return;
    }
  }

  state.corridaAtual = null;
  state.corridaAtualId = null;
  state.emCorridaAtiva = false;
  pararEscutaChat();
  pararEscutaCancelamento();
  pararEscutaRota();
  pararBroadcastPosicao();
  marcadorMotoristaMap = null;
  sequenciaRotaMotorista = [];
  indiceRotaAtualMotorista = 0;

  showToast('❌ Corrida cancelada');
  if (state.online) { iniciarDisponibilidade(); iniciarEscutaCorridas(); } // volta a ficar disponível e escutar novas ofertas
  go('screen-home');
}

async function finalizarCorrida() {
  const corrida = state.corridaAtual;
  if (!corrida) { go('screen-home'); return; }

  const km = (corrida.origemLat && corrida.destinoLat)
    ? haversineKm(corrida.origemLat, corrida.origemLon, corrida.destinoLat, corrida.destinoLon)
    : 0;

  const historico = JSON.parse(localStorage.getItem('interliga_motorista_historico') || '[]');
  historico.unshift({
    origem: corrida.origem, destino: corrida.destino,
    valor: Number(corrida.preco || 18), km,
    data: new Date().toISOString(),
  });
  localStorage.setItem('interliga_motorista_historico', JSON.stringify(historico.slice(0, 100)));

  if (firebaseReady && db && state.corridaAtualId && !String(state.corridaAtualId).startsWith('local-')) {
    try {
      await fb.updateDoc(fb.doc(db, 'corridas', state.corridaAtualId), {
        status: 'finalizada',
        finalizadaEm: fb.serverTimestamp(),
      });
    } catch (e) {
      console.error('[motorista] erro ao finalizar corrida no Firebase:', e);
      showToast('⚠️ Não foi possível finalizar a corrida. Tente novamente.');
      return;
    }
  }
  localStorage.removeItem('interliga_mot_corrida_ativa'); // limpa corrida ativa

  // Débito automático se o passageiro escolheu pagar pela Carteira do app
  if (corrida.formaPagamento === 'carteira' && corrida.passageiroId) {
    lancarCarteira(corrida.passageiroId, -Number(corrida.preco || 0), 'Pagamento de corrida', corrida.id);
  }
  // Cupom de desconto: o passageiro pagou menos, mas o motorista recebe o valor
  // cheio — a diferença vira crédito na carteira do motorista, que é abatida
  // depois no repasse (a comissão da plataforma nesse valor a mais nunca é cobrada
  // do motorista, é a plataforma que absorve o custo do cupom).
  if (Number(corrida.descontoCupomValor || 0) > 0 && meuMotoristaId) {
    lancarCarteira(meuMotoristaId, Number(corrida.descontoCupomValor), 'Crédito de cupom aplicado pelo passageiro' + (corrida.cupomCodigo ? ` (${corrida.cupomCodigo})` : ''), corrida.id);
  }
  // Recompensa de indicação (bônus de quem indicou esse passageiro)
  processarRecompensaIndicacao(corrida);
  // Cashback da corrida (só Interliga X, se o programa estiver ativo)
  processarCashback(corrida);

  state.corridaAtual = null;
  state.corridaAtualId = null;
  state.emCorridaAtiva = false;
  pararEscutaChat();
  pararEscutaCancelamento();
  pararEscutaRota();
  pararBroadcastPosicao();
  marcadorMotoristaMap = null;
  sequenciaRotaMotorista = [];
  indiceRotaAtualMotorista = 0;

  showToast('✅ Corrida finalizada! +R$ ' + Number(corrida.precoOriginal || corrida.preco || 18).toFixed(2).replace('.', ','));
  if (state.online) { iniciarDisponibilidade(); iniciarEscutaCorridas(); } // volta a ficar disponível e escutar novas ofertas
  abrirTelaAvaliarPassageiro(corrida.passageiroId, corrida.passageiroNome, corrida.id);
  atualizarStatsHome();
}

// ─────────────────────────────────────
// AVALIAÇÃO MÚTUA — motorista avalia passageiro depois da corrida
// ─────────────────────────────────────
let notaSelecionadaPassageiro = 0;
let avaliarPassageiroId = null;
let avaliarCorridaIdMotorista = null;

function abrirTelaAvaliarPassageiro(passageiroId, passageiroNome, corridaId) {
  avaliarPassageiroId = passageiroId || null;
  avaliarCorridaIdMotorista = corridaId || null;
  notaSelecionadaPassageiro = 0;
  renderEstrelasPassageiro();
  document.getElementById('avaliar-pax-nome').textContent = passageiroNome || 'o passageiro';
  document.getElementById('avaliar-pax-comentario').value = '';
  if (!avaliarPassageiroId) { go('screen-home'); return; } // corrida antiga sem passageiroId — não tem quem avaliar
  go('screen-avaliar-passageiro');
}

function renderEstrelasPassageiro() {
  document.querySelectorAll('#avaliar-pax-estrelas span').forEach(el => {
    const n = Number(el.dataset.nota);
    el.textContent = n <= notaSelecionadaPassageiro ? '★' : '☆';
    el.style.color = n <= notaSelecionadaPassageiro ? 'var(--orange)' : 'var(--text-soft)';
  });
}

document.querySelectorAll('#avaliar-pax-estrelas span').forEach(el => {
  el.style.cursor = 'pointer';
  el.addEventListener('click', () => {
    notaSelecionadaPassageiro = Number(el.dataset.nota);
    renderEstrelasPassageiro();
  });
});

document.getElementById('btn-enviar-avaliacao-passageiro')?.addEventListener('click', async (event) => {
  if (notaSelecionadaPassageiro === 0) { showToast('⚠️ Toca numa estrela pra dar a nota'); return; }

  const btn = event.currentTarget;
  const textoOriginal = btn.textContent;
  const comentario = document.getElementById('avaliar-pax-comentario').value.trim();

  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    await enviarAvaliacao('passageiro', avaliarPassageiroId, notaSelecionadaPassageiro, comentario, avaliarCorridaIdMotorista);

    btn.textContent = '✓ Avaliação enviada';
    showToast('✅ Avaliação enviada!');

    await new Promise(resolve => setTimeout(resolve, 1200));
    go('screen-home');
  } catch (e) {
    console.error('[motorista] erro ao enviar avaliação:', e);
    btn.disabled = false;
    btn.textContent = textoOriginal;
    showToast('⚠️ ' + (e?.message || 'Não foi possível enviar a avaliação.'));
  }
});

document.getElementById('link-pular-avaliacao-passageiro')?.addEventListener('click', () => go('screen-home'));

// Atualiza a média de avaliação de forma segura mesmo com várias avaliações
// chegando ao mesmo tempo (usa transação do Firebase).
async function enviarAvaliacao(tipo, paraId, nota, comentario, corridaId) {
  if (!firebaseReady || !authMotorista?.currentUser) {
    throw new Error('Sessão do motorista não disponível.');
  }

  if (!paraId || !corridaId) {
    throw new Error('Dados da avaliação incompletos.');
  }

  const token = await authMotorista.currentUser.getIdToken();

  const resp = await fetch(
    'https://us-central1-interliga-homologacao-eb0f2.cloudfunctions.net/enviarAvaliacaoMobilidade',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tipo,
        paraId,
        nota,
        comentario,
        corridaId
      })
    }
  );

  let dados = {};
  try {
    dados = await resp.json();
  } catch (_) {}

  if (!resp.ok || dados.ok !== true) {
    throw new Error(dados.erro || 'Não foi possível enviar a avaliação.');
  }

  return dados;
}

// ─────────────────────────────────────
// CHAT — motorista ↔ passageiro
// ─────────────────────────────────────
function iniciarChatMotorista() {
  document.getElementById('chat-panel-driver').hidden = false;
  if (!firebaseReady || !db || !state.corridaAtualId) return;
  if (state.chatListenerUnsub) return;

  document.getElementById('btn-close-chat-driver')?.addEventListener('click', () => {
    document.getElementById('chat-panel-driver').hidden = true;
  });

  const q = fb.query(
    fb.collection(db, 'corridas', state.corridaAtualId, 'mensagens'),
    fb.orderBy('ts', 'asc'), fb.limit(50)
  );

  let primeiraCaraga = true;

  state.chatListenerUnsub = fb.onSnapshot(q, (snap) => {
    const container = document.getElementById('chat-messages-driver');
    if (!container) return;

    if (primeiraCaraga) {
      // Na primeira carga, renderiza todas as mensagens do zero
      primeiraCaraga = false;
      container.innerHTML = '';
      snap.docs.forEach(doc => {
        const msg = doc.data();
        const tipo = msg.de === 'motorista' ? 'me' : msg.de === 'sistema' ? 'sys' : 'them';
        renderChatMessageMotorista(msg.texto, tipo, msg.audioData || null);
      });
      return;
    }

    // Após primeira carga, só adiciona as novas
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const msg = change.doc.data();
        if (change.doc.metadata.hasPendingWrites) return;
        const tipo = msg.de === 'motorista' ? 'me' : msg.de === 'sistema' ? 'sys' : 'them';
        renderChatMessageMotorista(msg.texto, tipo, msg.audioData || null);
      }
    });
  }, (e) => {
    console.warn('[motorista] erro no chat listener:', e);
  });
}

function pararEscutaChat() {
  if (state.chatListenerUnsub) { state.chatListenerUnsub(); state.chatListenerUnsub = null; }
}

function tocarSomNotificacaoChat() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.value = 700;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.03);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
    o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.15);
  } catch (e) {}
}

function renderChatMessageMotorista(texto, tipo, audioDataUrl = null) {
  const container = document.getElementById('chat-messages-driver');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg--${tipo}` + (audioDataUrl ? ' chat-msg--audio' : '');
  if (audioDataUrl) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = audioDataUrl;
    div.appendChild(audio);
  } else {
    div.textContent = texto;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  if (tipo === 'them') {
    tocarSomNotificacaoChat();
    // Badge no botão de chat se o painel estiver fechado
    const chatPanel = document.getElementById('chat-panel-driver');
    if (chatPanel?.hidden) {
      const btnChat = document.getElementById('btn-chat-driver');
      if (btnChat) {
        btnChat.style.position = 'relative';
        let badge = document.getElementById('chat-badge-mot');
        if (!badge) {
          badge = document.createElement('span');
          badge.id = 'chat-badge-mot';
          badge.style.cssText = 'position:absolute;top:-4px;right:-4px;background:#E8002D;color:white;border-radius:50%;width:16px;height:16px;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;';
          badge.textContent = '1';
          btnChat.appendChild(badge);
        } else {
          badge.textContent = String(Number(badge.textContent || 0) + 1);
        }
      }
    }
  }
}

async function enviarMsgChatMotorista(texto, isSystem = false) {
  if (!texto.trim()) return;
  renderChatMessageMotorista(texto, isSystem ? 'sys' : 'me');
  if (firebaseReady && db && state.corridaAtualId) {
    try {
      await fb.addDoc(fb.collection(db, 'corridas', state.corridaAtualId, 'mensagens'), {
        texto, de: isSystem ? 'sistema' : 'motorista', ts: fb.serverTimestamp(),
      });
    } catch (e) { console.warn('Erro ao enviar mensagem:', e); }
  }
}

async function enviarAudioChatMotorista(audioDataUrl) {
  renderChatMessageMotorista(null, 'me', audioDataUrl);
  if (firebaseReady && db && state.corridaAtualId) {
    try {
      await fb.addDoc(fb.collection(db, 'corridas', state.corridaAtualId, 'mensagens'), {
        tipo: 'audio', audioData: audioDataUrl, de: 'motorista', ts: fb.serverTimestamp(),
      });
    } catch (e) {
      console.warn('Erro ao enviar áudio:', e);
      showToast('⚠️ Falha ao enviar o áudio — tente de novo');
    }
  } else {
    showToast('⚠️ Sem conexão — áudio não foi enviado ao passageiro');
  }
}

document.getElementById('btn-send-chat-driver')?.addEventListener('click', () => {
  const input = document.getElementById('chat-input-driver');
  enviarMsgChatMotorista(input.value);
  input.value = '';
});
document.getElementById('chat-input-driver')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-send-chat-driver').click();
});

document.getElementById('btn-chat-driver')?.addEventListener('click', () => {
  document.getElementById('chat-panel-driver').hidden = false;
  document.getElementById('chat-input-driver')?.focus();
  const badge = document.getElementById('chat-badge-mot');
  if (badge) badge.remove();
});

// ─────────────────────────────────────
// MENSAGEM DE VOZ NO CHAT (gravação pelo microfone)
// ─────────────────────────────────────
function blobParaBase64Motorista(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

let gravadorAudioChatMotorista = null;
let pedacosAudioChatMotorista = [];
let gravandoAudioChatMotorista = false;
let timeoutGravacaoChatMotorista = null;

async function alternarGravacaoAudioChatMotorista() {
  const btnMic = document.getElementById('btn-mic-chat-driver');

  // Se tem gravação nativa disponível (APK Android), usa ela em vez do getUserMedia
  // que falha em WebView MIUI/Xiaomi com NotReadableError
  if (window.AndroidNative?.iniciarGravacaoNativa) {
    if (gravandoAudioChatMotorista) {
      window.AndroidNative.pararGravacaoNativa();
      return;
    }
    // Registra callbacks que o Java vai chamar quando terminar
    window._micIniciou = () => {
      gravandoAudioChatMotorista = true;
      btnMic?.classList.add('is-recording');
      showToast('🎙️ Gravando... toque de novo para enviar');
      timeoutGravacaoChatMotorista = setTimeout(() => {
        if (gravandoAudioChatMotorista) window.AndroidNative.pararGravacaoNativa();
      }, 30000);
    };
    window._micDados = (base64) => {
      clearTimeout(timeoutGravacaoChatMotorista);
      gravandoAudioChatMotorista = false;
      btnMic?.classList.remove('is-recording');
      if (base64 && base64.length > 100) {
        enviarAudioChatMotorista(base64);
      } else {
        showToast('⚠️ Gravação vazia, tente de novo');
      }
    };
    window._micErro = (msg) => {
      gravandoAudioChatMotorista = false;
      btnMic?.classList.remove('is-recording');
      showToast('⚠️ Microfone: ' + (msg || 'erro desconhecido'));
    };
    window.AndroidNative.iniciarGravacaoNativa();
    return;
  }

  // Fallback: getUserMedia (funciona no navegador e em alguns WebViews)
  if (gravandoAudioChatMotorista) {
    gravadorAudioChatMotorista?.stop();
    return;
  }
  if(window.AndroidNative?.pedirPermissaoMicrofone){
    window.AndroidNative.pedirPermissaoMicrofone();
    await new Promise(r=>setTimeout(r,500));
  }
  try {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 16000 }
      });
    } catch (e1) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    const opcoes = { audioBitsPerSecond: 24000 };
    if (window.MediaRecorder?.isTypeSupported?.('audio/webm;codecs=opus')) {
      opcoes.mimeType = 'audio/webm;codecs=opus';
    }
    gravadorAudioChatMotorista = new MediaRecorder(stream, opcoes);
    pedacosAudioChatMotorista = [];
    gravadorAudioChatMotorista.ondataavailable = (e) => { if (e.data && e.data.size > 0) pedacosAudioChatMotorista.push(e.data); };
    gravadorAudioChatMotorista.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      clearTimeout(timeoutGravacaoChatMotorista);
      gravandoAudioChatMotorista = false;
      btnMic?.classList.remove('is-recording');
      if (pedacosAudioChatMotorista.length === 0) {
        showToast('⚠️ Gravação muito curta, nada foi enviado');
        return;
      }
      const blob = new Blob(pedacosAudioChatMotorista, { type: gravadorAudioChatMotorista.mimeType || 'audio/webm' });
      if (blob.size > 0) {
        const base64 = await blobParaBase64Motorista(blob);
        enviarAudioChatMotorista(base64);
      } else {
        showToast('⚠️ Gravação vazia, nada foi enviado');
      }
    };
    gravadorAudioChatMotorista.start();
    gravandoAudioChatMotorista = true;
    btnMic?.classList.add('is-recording');
    showToast('🎙️ Gravando... toque de novo para enviar');
    clearTimeout(timeoutGravacaoChatMotorista);
    timeoutGravacaoChatMotorista = setTimeout(() => { if (gravandoAudioChatMotorista) gravadorAudioChatMotorista?.stop(); }, 30000);
  } catch (e) {
    console.error('[motorista] erro ao gravar áudio:', e);
    showToast('❌ Mic erro: ' + (e.name || e.message || String(e)));
  }
}

document.getElementById('btn-mic-chat-driver')?.addEventListener('click', alternarGravacaoAudioChatMotorista);

// Número do bot Interliga (Railway/Baileys) — faz a ponte anônima entre motorista e passageiro
const BOT_NUMERO = '5571981899571';

document.getElementById('btn-call-passenger')?.addEventListener('click', () => {
  const corridaInfo = state.corridaAtualId || 'atual';
  const msg = encodeURIComponent(
    `📞 [Interliga] Motorista solicita ligação · Corrida #${corridaInfo}\nPor favor ligue para o motorista via bot.`
  );
  window.open('https://wa.me/' + BOT_NUMERO + '?text=' + msg, '_blank');
  showToast('📞 Solicitação enviada — passageiro vai ligar via bot');
});

// ─────────────────────────────────────
// GANHOS — histórico
// ─────────────────────────────────────
function renderHistoricoGanhos() {
  const historico = JSON.parse(localStorage.getItem('interliga_motorista_historico') || '[]');
  const total = historico.reduce((acc, c) => acc + c.valor, 0);
  document.getElementById('earnings-total').textContent = 'R$ ' + total.toFixed(2).replace('.', ',');

  const listEl = document.getElementById('earnings-list');
  if (!listEl) return;
  if (historico.length === 0) return; // mantém o empty-state do HTML

  listEl.innerHTML = historico.map(c => `
    <div class="trip-card">
      <div class="trip-card-top">
        <span>${new Date(c.data).toLocaleDateString('pt-BR')}</span>
        <span class="trip-card-price">R$ ${c.valor.toFixed(2).replace('.', ',')}</span>
      </div>
      <div class="trip-card-route">${c.origem} → ${c.destino}</div>
    </div>
  `).join('');
}

document.querySelector('[data-go="screen-earnings"]')?.addEventListener('click', renderHistoricoGanhos);

// ─────────────────────────────────────
// INICIALIZAÇÃO
// ─────────────────────────────────────
// ─────────────────────────────────────
// VALIDAÇÃO DE CPF — mesmo algoritmo padrão dos 2 dígitos verificadores
// ─────────────────────────────────────
function validarCPF(cpf) {
  cpf = (cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(cpf[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i]) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  return resto === parseInt(cpf[10]);
}

document.getElementById('cad-mot-cpf')?.addEventListener('input', (e) => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, '$1.$2.$3-$4');
  else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{0,3})/, '$1.$2.$3');
  else if (v.length > 3) v = v.replace(/(\d{3})(\d{0,3})/, '$1.$2');
  e.target.value = v;
});

// ─────────────────────────────────────
// FOTOS (selfie + documentos) — comprimidas antes de salvar, pra não pesar no Firestore
// ─────────────────────────────────────
function comprimirImagemArquivo(file, maxLado = 700, qualidade = 0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxLado) { height *= maxLado / width; width = maxLado; }
        else if (height > maxLado) { width *= maxLado / height; height = maxLado; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', qualidade));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const fotosCadastroMotorista = { selfie: null, cnh: null, crlv: null, comprovante: null };

function ligarUploadFoto(inputId, previewId, chave, emoji) {
  document.getElementById(inputId)?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const base64 = await comprimirImagemArquivo(file);
      fotosCadastroMotorista[chave] = base64;
      document.getElementById(previewId).innerHTML = `<img src="${base64}">`;
    } catch (err) {
      showToast('⚠️ Não foi possível processar a foto, tenta de novo');
    }
  });
}
ligarUploadFoto('cad-mot-selfie-input', 'cad-mot-selfie-preview', 'selfie');
ligarUploadFoto('cad-mot-cnh-input', 'cad-mot-cnh-preview', 'cnh');
ligarUploadFoto('cad-mot-crlv-input', 'cad-mot-crlv-preview', 'crlv');
ligarUploadFoto('cad-mot-comprovante-input', 'cad-mot-comprovante-preview', 'comprovante');

// ─────────────────────────────────────
// ENVIO DO CADASTRO
// ─────────────────────────────────────
document.getElementById('btn-enviar-cadastro-motorista')?.addEventListener('click', async () => {
  const erroEl = document.getElementById('cad-mot-erro');
  erroEl.hidden = true;
  function mostrarErro(msg) { erroEl.textContent = '⚠️ ' + msg; erroEl.hidden = false; }

  const nome = document.getElementById('cad-mot-nome').value.trim();
  const celular = document.getElementById('cad-mot-celular').value.trim();
  const email = document.getElementById('cad-mot-email').value.trim();
  const cpf = document.getElementById('cad-mot-cpf').value.replace(/\D/g, '');
  const confirma = document.getElementById('cad-mot-cpf-confirma').value.trim();
  const senha = document.getElementById('cad-mot-senha').value;
  const senhaConfirma = document.getElementById('cad-mot-senha-confirma').value;
  const veiculo = document.getElementById('cad-mot-veiculo').value.trim();
  const placa = document.getElementById('cad-mot-placa').value.trim().toUpperCase();
  const cidade = document.getElementById('cad-mot-cidade').value;

  if (!nome || nome.split(' ').length < 2) return mostrarErro('Informe seu nome completo');
  if (celular.replace(/\D/g, '').length < 10) return mostrarErro('Informe um celular válido com DDD');
  if (!email.includes('@') || !email.includes('.')) return mostrarErro('Informe um e-mail válido');
  if (!validarCPF(cpf)) return mostrarErro('CPF inválido — confira os números digitados');
  if (confirma !== cpf.slice(-2)) return mostrarErro('Os 2 últimos dígitos não confirmam o CPF informado');
  if (senha.length < 6) return mostrarErro('A senha precisa ter pelo menos 6 caracteres');
  if (senha !== senhaConfirma) return mostrarErro('As senhas não são iguais');
  if (!veiculo) return mostrarErro('Informe o modelo do veículo');
  if (!placa) return mostrarErro('Informe a placa do veículo');
  if (!fotosCadastroMotorista.selfie) return mostrarErro('Tire uma selfie pra concluir o cadastro');
  if (!fotosCadastroMotorista.cnh) return mostrarErro('Envie a foto da CNH');
  if (!fotosCadastroMotorista.crlv) return mostrarErro('Envie a foto do CRLV (documento do veículo)');
  if (!fotosCadastroMotorista.comprovante) return mostrarErro('Envie a foto do comprovante de residência');

  const btn = document.getElementById('btn-enviar-cadastro-motorista');
  btn.disabled = true;
  btn.textContent = 'Conectando...';

  const pronto = await esperarFirebasePronto();
  if (!pronto) {
    btn.disabled = false;
    btn.textContent = 'Enviar cadastro';
    return mostrarErro('Sem conexão com o servidor — confira sua internet e tenta de novo');
  }

  // Segurança: nunca reutiliza silenciosamente uma sessão de outra conta
  // para criar um novo cadastro de motorista.
  const usuarioAtual = authMotorista?.currentUser || null;
  const emailAtual = (usuarioAtual?.email || '').trim().toLowerCase();
  const emailCadastro = email.trim().toLowerCase();

  if (usuarioAtual && emailAtual && emailAtual !== emailCadastro) {
    btn.disabled = false;
    btn.textContent = 'Enviar cadastro';
    return mostrarErro(
      'Existe outra conta conectada neste aparelho. Saia dela antes de criar um novo cadastro.'
    );
  }

  btn.textContent = 'Verificando CPF...';
  try {
    const [snapPax, snapMot] = await Promise.all([
      fb.getDocs(fb.query(fb.collection(db, 'passageiros'), fb.where('cpf', '==', cpf))),
      fb.getDocs(fb.query(fb.collection(db, 'motoristas'), fb.where('cpf', '==', cpf))),
    ]);
    if (!snapPax.empty || !snapMot.empty) {
      btn.disabled = false;
      btn.textContent = 'Enviar cadastro';
      return mostrarErro('⚠️ Já existe uma conta com esse CPF. Use "Entrar" se já tem cadastro.');
    }
  } catch (e) { console.warn('[motorista] erro ao verificar CPF:', e); }

  btn.textContent = 'Enviando...';

  try {
    if (!meuMotoristaId) {
      const cred = await authModRef.createUserWithEmailAndPassword(authMotorista, email, senha);
      meuMotoristaId = cred.user.uid;
    }

    const codigoDigitado = document.getElementById('cad-mot-codigo-indicacao').value.trim().toUpperCase();
    const indicadoPor = codigoDigitado ? await resolverCodigoIndicacao(codigoDigitado) : null;

    await fb.setDoc(fb.doc(db, 'motoristas', meuMotoristaId), {
      nome, celular, email, cpf, veiculo, placa, cidade,
      avaliacao: state.motorista.avaliacao || '5.0',
      selfie: fotosCadastroMotorista.selfie,
      docCnh: fotosCadastroMotorista.cnh,
      docCrlv: fotosCadastroMotorista.crlv,
      docComprovante: fotosCadastroMotorista.comprovante,
      verificacao: 'pendente',
      codigoIndicacao: meuMotoristaId.slice(-7).toUpperCase(),
      indicadoPor: indicadoPor || null,
      bonusIndicacaoPago: false,
      atualizadoEm: fb.serverTimestamp(),
    }, { merge: true });

    state.motorista.nome = nome;
    state.motorista.veiculo = veiculo;
    state.motorista.placa = placa;
    state.motorista.cidade = cidade;
    state.motorista.selfie = fotosCadastroMotorista.selfie;
    mostrarTelaAguardandoAprovacaoMotorista();
  } catch (e) {
    console.error('[motorista] erro ao enviar cadastro:', e);
    if (e.code === 'auth/email-already-in-use') mostrarErro('Esse e-mail já tem cadastro — tenta Entrar em vez de cadastrar');
    else mostrarErro('Erro ao enviar — confira sua internet e tente de novo');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar cadastro';
  }
});

// ─────────────────────────────────────
// LOGIN (motorista que já tem cadastro)
// ─────────────────────────────────────
document.getElementById('btn-fazer-login-motorista')?.addEventListener('click', async () => {
  const erroEl = document.getElementById('login-mot-erro');
  erroEl.hidden = true;
  const email = document.getElementById('login-mot-email').value.trim();
  const senha = document.getElementById('login-mot-senha').value;
  if (!email || !senha) { erroEl.textContent = '⚠️ Preencha e-mail e senha'; erroEl.hidden = false; return; }

  const btn = document.getElementById('btn-fazer-login-motorista');
  btn.disabled = true;
  btn.textContent = 'Conectando...';
  const pronto = await esperarFirebasePronto();
  if (!pronto) {
    btn.disabled = false;
    btn.textContent = 'Entrar';
    erroEl.textContent = '⚠️ Sem conexão com o servidor — confira sua internet e tenta de novo';
    erroEl.hidden = false;
    return;
  }
  btn.textContent = 'Entrando...';
  try {
    _loginEmAndamento = true;
    await authModRef.signInWithEmailAndPassword(authMotorista, email, senha);
    // onAuthStateChanged cuida do resto (verificarCadastroMotorista) e limpa a flag
  } catch (e) {
    _loginEmAndamento = false; // login falhou — libera a flag
    console.warn('[motorista] erro no login:', e.code);
    erroEl.textContent = '❌ E-mail ou senha incorretos';
    erroEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});

document.getElementById('link-ir-pro-cadastro-mot')?.addEventListener('click', async () => {
  try {
    // "Cadastre-se" significa criar uma NOVA conta.
    // Encerra qualquer sessão anterior para nunca reutilizar outro UID.
    if (authMotorista?.currentUser) {
      await authModRef.signOut(authMotorista);
    }

    meuMotoristaId = null;
    go('screen-cadastro-motorista');
  } catch (e) {
    console.error('[motorista] erro ao preparar novo cadastro:', e);
    showToast('⚠️ Não foi possível iniciar um novo cadastro. Tente novamente.');
  }
});
document.getElementById('link-ir-pro-login-mot')?.addEventListener('click', () => go('screen-login-motorista'));
document.getElementById('link-esqueci-senha-mot')?.addEventListener('click', async () => {
  const email = document.getElementById('login-mot-email').value.trim();
  if (!email) { showToast('⚠️ Digite seu e-mail no campo acima primeiro'); return; }
  if (!authMotorista) return;
  try {
    await authModRef.sendPasswordResetEmail(authMotorista, email);
    showToast('📧 Enviamos um link pra redefinir sua senha');
  } catch (e) {
    showToast('⚠️ Não foi possível enviar — confira o e-mail digitado');
  }
});

// ─────────────────────────────────────
// VERIFICAÇÃO DO STATUS DO CADASTRO
// ─────────────────────────────────────
let cadastroMotoristaListenerUnsub = null;


function renderAvatarMotorista(elemento, foto, fallback = 'M') {
  if (!elemento) return;
  elemento.innerHTML = '';

  if (foto) {
    const img = document.createElement('img');
    img.src = foto;
    img.alt = 'Foto de perfil';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '50%';
    img.style.display = 'block';
    elemento.appendChild(img);
  } else {
    elemento.textContent = fallback || 'M';
  }
}

async function verificarCadastroMotorista() {
  if (!firebaseReady || !db) return;
  try {
    const snap = await fb.getDoc(fb.doc(db, 'motoristas', meuMotoristaId));
    if (!snap.exists() || !snap.data().verificacao) {
      go('screen-cadastro-motorista');
      return;
    }
    const dados = snap.data();
    if (dados.nome) state.motorista.nome = dados.nome;
    if (dados.veiculo) state.motorista.veiculo = dados.veiculo;
    if (dados.placa) state.motorista.placa = dados.placa;
    if (dados.celular) state.motorista.celular = dados.celular;
    if (dados.cidade) state.motorista.cidade = dados.cidade;
    if (dados.cpf) state.motorista.cpf = dados.cpf;
    if (dados.email) state.motorista.email = dados.email;
    state.motorista.selfie = dados.selfie || null;
    if (dados.avaliacao) state.motorista.avaliacao = dados.avaliacao;
    state.motorista.categoria = dados.categoria || 'x';
    state.motorista.categorias = Array.isArray(dados.categorias) ? dados.categorias : [state.motorista.categoria];
    const nomesCategoria = { x: 'Interliga X', plus: 'Interliga Plus', van: 'Interliga Van' };
    const nomesCidade = { madre: 'Madre de Deus', sfc: 'São Francisco do Conde', candeias: 'Candeias', simoes: 'Simões Filho' };
    const elVeiculo = document.getElementById('profile-driver-vehicle');
    const nomesCategoriasTexto = (state.motorista.categorias || [state.motorista.categoria]).map(c => nomesCategoria[c] || c).join(' + ');
    if (elVeiculo) elVeiculo.textContent = `${state.motorista.veiculo || '—'} · ${state.motorista.placa || '—'} · ${nomesCategoriasTexto}`;
    const elNome = document.getElementById('profile-driver-name');
    if (elNome) elNome.textContent = state.motorista.nome || 'Motorista';
    const elTelefone = document.getElementById('profile-driver-phone');
    if (elTelefone) elTelefone.textContent = state.motorista.celular || '—';
    const elAvatar = document.getElementById('profile-driver-avatar');
    const elHomeAvatar = document.getElementById('driver-home-avatar');
    const inicialMotorista = (state.motorista.nome || 'M').trim().charAt(0).toUpperCase();
    renderAvatarMotorista(elAvatar, state.motorista.selfie, inicialMotorista);
    renderAvatarMotorista(elHomeAvatar, state.motorista.selfie, inicialMotorista);

    const elHomeNome = document.getElementById('driver-home-name');
    if (elHomeNome) elHomeNome.textContent = state.motorista.nome || 'Motorista';
    const elHomeAvaliacao = document.getElementById('driver-home-rating');
    if (elHomeAvaliacao) elHomeAvaliacao.textContent = state.motorista.avaliacao || '—';
    const inputFotoMot = document.getElementById('input-trocar-foto-mot');
    if (inputFotoMot && !inputFotoMot._wiredPerfil) {
      inputFotoMot._wiredPerfil = true;
      inputFotoMot.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !firebaseReady || !db || !meuMotoristaId) return;
        try {
          showToast('📷 Atualizando foto...');
          const novaFoto = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = ev => {
              const img = new Image();
              img.onload = () => {
                const canvas = document.createElement('canvas');
                const max = 400;
                const ratio = Math.min(max/img.width, max/img.height, 1);
                canvas.width = img.width * ratio; canvas.height = img.height * ratio;
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
              };
              img.onerror = reject; img.src = ev.target.result;
            };
            reader.onerror = reject; reader.readAsDataURL(file);
          });
          await fb.setDoc(fb.doc(db, 'motoristas', meuMotoristaId), { selfie: novaFoto }, { merge: true });
          state.motorista.selfie = novaFoto;
          renderAvatarMotorista(elAvatar, novaFoto, inicialMotorista);
          renderAvatarMotorista(elHomeAvatar, novaFoto, inicialMotorista);
          showToast('✅ Foto atualizada!');
        } catch (err) { showToast('⚠️ Erro ao atualizar foto'); }
      });
    }
    const elCpf = document.getElementById('perfil-mot-cpf');
    if (elCpf && state.motorista.cpf) elCpf.textContent = state.motorista.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    const elEmail = document.getElementById('perfil-mot-email');
    if (elEmail) elEmail.textContent = state.motorista.email || '—';
    const elCidade = document.getElementById('perfil-mot-cidade');
    if (elCidade) elCidade.textContent = nomesCidade[state.motorista.cidade] || '—';
    const elCodigo = document.getElementById('perfil-mot-codigo');
    if (elCodigo && meuMotoristaId) elCodigo.textContent = meuMotoristaId.slice(-7).toUpperCase();
    obterSaldoCarteira(meuMotoristaId).then((saldo) => {
      const elSaldo = document.getElementById('saldo-carteira-motorista');
      if (elSaldo) elSaldo.textContent = 'R$ ' + saldo.toFixed(2).replace('.', ',');
    });
    aplicarStatusCadastroMotorista(dados);
  } catch (e) {
    console.warn('[motorista] erro ao verificar cadastro, liberando Home pra não travar:', e);
    go('screen-home');
  }
}

async function aplicarStatusCadastroMotorista(dados) {
  if (dados.bloqueado === true) {
    // Força offline na hora — não pode continuar recebendo corridas se foi bloqueado
    encerrarOperacaoMotorista();
    const btnOnline = document.getElementById('online-toggle');
    if (btnOnline) { btnOnline.dataset.online = 'false'; btnOnline.querySelector('.online-label').textContent = 'Offline'; }
    const elMotivo = document.getElementById('bloqueio-mot-motivo-texto');
    if (elMotivo) elMotivo.textContent = dados.motivoBloqueio || 'Sua conta foi bloqueada. Entre em contato com o suporte.';
    go('screen-bloqueado-motorista');
    escutarStatusCadastroMotorista();
    return;
  }
  if (dados.verificacao === 'aprovado') {
    // Restaura a escolha Online/Offline feita pelo próprio motorista.
    // Nunca força Online se ele havia escolhido ficar Offline.
    const onlineSalvo = localStorage.getItem('interliga_motorista_online') === 'true';
    state.online = onlineSalvo;

    const btnOnline = document.getElementById('online-toggle');
    if (btnOnline) {
      btnOnline.dataset.online = state.online ? 'true' : 'false';
      const labelOnline = btnOnline.querySelector('.online-label');
      if (labelOnline) labelOnline.textContent = state.online ? 'Online' : 'Offline';
    }

    if (state.online) {
      iniciarDisponibilidade();
      iniciarEscutaCorridas();
    }

    // Verifica se havia corrida ativa antes de fechar o app
    const corridaAtiva = localStorage.getItem('interliga_mot_corrida_ativa');
    if (corridaAtiva) {
      try {
        const dadosCorrida = JSON.parse(corridaAtiva);
        const idadeMs = Date.now() - (dadosCorrida.aceitoEm || 0);
        if (idadeMs < 2 * 60 * 60 * 1000 && dadosCorrida.corridaId) {
          const snapCorrida = await fb.getDoc(fb.doc(db, 'corridas', dadosCorrida.corridaId));
          if (snapCorrida.exists() && ['aceita', 'em_andamento'].includes(snapCorrida.data().status)) {
            state.corridaAtualId = dadosCorrida.corridaId;
            state.corridaAtual = { id: dadosCorrida.corridaId, ...snapCorrida.data() };
            state.emCorridaAtiva = true;
            showToast('🔄 Corrida em andamento retomada!');
            go('screen-ongoing');
            onEnterOngoing();
            return;
          } else {
            localStorage.removeItem('interliga_mot_corrida_ativa');
          }
        } else {
          localStorage.removeItem('interliga_mot_corrida_ativa');
        }
      } catch(e) {
        console.warn('[motorista] erro ao retomar corrida:', e);
        localStorage.removeItem('interliga_mot_corrida_ativa');
      }
    }
    go('screen-home');
    configurarNotificacoesPush();
  } else if (dados.verificacao === 'rejeitado') {
    document.getElementById('rejeicao-mot-motivo-texto').textContent = dados.motivoRejeicao || 'Houve um problema com seus dados ou documentos. Tente cadastrar de novo, com calma.';
    go('screen-rejeitado-motorista');
  } else {
    go('screen-aguardando-aprovacao-motorista');
  }
  // Mantém o listener vivo mesmo depois de aprovado, pra detectar um bloqueio que aconteça depois
  escutarStatusCadastroMotorista();
}

function escutarStatusCadastroMotorista() {
  if (cadastroMotoristaListenerUnsub || !firebaseReady || !db) return;
  cadastroMotoristaListenerUnsub = fb.onSnapshot(fb.doc(db, 'motoristas', meuMotoristaId), (snap) => {
    if (!snap.exists()) return;
    aplicarStatusCadastroMotorista(snap.data());
  });
}

function mostrarTelaAguardandoAprovacaoMotorista() {
  go('screen-aguardando-aprovacao-motorista');
  if (cadastroMotoristaListenerUnsub || !firebaseReady || !db) return;
  cadastroMotoristaListenerUnsub = fb.onSnapshot(fb.doc(db, 'motoristas', meuMotoristaId), (snap) => {
    if (!snap.exists()) return;
    aplicarStatusCadastroMotorista(snap.data());
  });
}

document.getElementById('btn-tentar-cadastro-mot-novamente')?.addEventListener('click', () => {
  go('screen-cadastro-motorista');
});

document.getElementById('btn-editar-perfil-motorista')?.addEventListener('click', () => {
  document.getElementById('ed-mot-nome').value = state.motorista.nome || '';
  document.getElementById('ed-mot-celular').value = state.motorista.celular || '';
  document.getElementById('ed-mot-veiculo').value = state.motorista.veiculo || '';
  document.getElementById('ed-mot-placa').value = state.motorista.placa || '';
  go('screen-editar-perfil-motorista');
});

document.getElementById('btn-salvar-perfil-motorista')?.addEventListener('click', async () => {
  const erroEl = document.getElementById('ed-mot-erro');
  erroEl.hidden = true;
  const nome = document.getElementById('ed-mot-nome').value.trim();
  const celular = document.getElementById('ed-mot-celular').value.trim();
  const veiculo = document.getElementById('ed-mot-veiculo').value.trim();
  const placa = document.getElementById('ed-mot-placa').value.trim().toUpperCase();

  if (!nome || nome.split(' ').length < 2) { erroEl.textContent = '⚠️ Informe seu nome completo'; erroEl.hidden = false; return; }
  if (celular.replace(/\D/g, '').length < 10) { erroEl.textContent = '⚠️ Informe um celular válido com DDD'; erroEl.hidden = false; return; }
  if (!veiculo || !placa) { erroEl.textContent = '⚠️ Informe o veículo e a placa'; erroEl.hidden = false; return; }
  if (!firebaseReady || !db || !meuMotoristaId) { erroEl.textContent = '⚠️ Sem conexão com o servidor'; erroEl.hidden = false; return; }

  const btn = document.getElementById('btn-salvar-perfil-motorista');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    await fb.setDoc(fb.doc(db, 'motoristas', meuMotoristaId), { nome, celular, veiculo, placa }, { merge: true });
    state.motorista.nome = nome;
    state.motorista.celular = celular;
    state.motorista.veiculo = veiculo;
    state.motorista.placa = placa;
    showToast('✅ Perfil atualizado!');
    go('screen-profile');
    verificarCadastroMotorista(); // recarrega os dados exibidos
  } catch (e) {
    console.error('[motorista] erro ao salvar perfil:', e);
    erroEl.textContent = '⚠️ Erro ao salvar — tenta de novo';
    erroEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar alterações';
  }
});

document.getElementById('btn-suporte-motorista')?.addEventListener('click', () => {
  const msg = encodeURIComponent('Olá! Preciso de ajuda com o app do motorista Interliga.');
  window.open('https://wa.me/5571981899571?text=' + msg, '_blank');
});

document.getElementById('btn-sair-motorista')?.addEventListener('click', async () => {
  if (!confirm('Sair da sua conta? Você vai precisar fazer login de novo pra voltar a usar o app.')) return;
  try {
    encerrarOperacaoMotorista();
    if (authMotorista) await authModRef.signOut(authMotorista);
    meuMotoristaId = null;
    go('screen-login-motorista');
  } catch (e) {
    console.error('[motorista] erro ao sair:', e);
    showToast('⚠️ Erro ao sair, tenta de novo');
  }
});

document.getElementById('btn-trocar-para-passageiro')?.addEventListener('click', () => {
  // Ao sair do papel motorista, encerra o monitor/voz de corridas.
  encerrarOperacaoMotorista();

  // Precisa marcar o papel como 'passageiro' antes de voltar — senão o
  // index.html detecta 'motorista' salvo e manda de volta pra cá na hora.
  localStorage.setItem('interliga_papel', 'passageiro');
  window.location.href = 'passageiro-homologacao.html';
});

// ─────────────────────────────────────
// NOTIFICAÇÕES PUSH — recebe aviso de corrida nova mesmo com o app fechado/
// em segundo plano (precisa da chave VAPID do Firebase Console, ver abaixo)
// ─────────────────────────────────────
const VAPID_KEY = 'BNlkkjvYwHosBBv6UWCzKWCB58rNoEP1YrlGFsXetoPFLDMWUNdA2r4VqtD4sHwgdb_yyKbOBydT2dxKDXWrrY4'; // Firebase Console → Configurações do projeto → Cloud Messaging → Web Push certificates

let pushConfigurado = false;

async function configurarNotificacoesPush() {
  if (pushConfigurado) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[motorista] notificações push não suportadas neste navegador');
    return;
  }
  if (!fbAppInstancia || !meuMotoristaId || !db) return;
  if (!VAPID_KEY || VAPID_KEY.length < 50) {
    console.warn('[motorista] VAPID_KEY inválida — pulando notificações push');
    return;
  }

  try {
    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') {
      console.warn('[motorista] permissão de notificação negada pelo usuário');
      return;
    }

    const messagingMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js');
    const registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
    const messaging = messagingMod.getMessaging(fbAppInstancia);
    const token = await messagingMod.getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (token) {
      await fb.setDoc(fb.doc(db, 'motoristas', meuMotoristaId), { fcmToken: token }, { merge: true });
      pushConfigurado = true;
      console.log('[motorista] notificações push configuradas');
    }
  } catch (e) {
    console.warn('[motorista] erro ao configurar notificações push:', e);
  }
}

window.addEventListener('popstate', () => {
  // Se tiver em corrida ativa, ignora o voltar — não deixa sair da tela de corrida
  if (state.emCorridaAtiva) {
    history.pushState(null, '', '');
    showToast('🚗 Você está numa corrida em andamento');
    return;
  }
  const anterior = historicoNavMotorista.pop();
  if (anterior) {
    const next = document.getElementById(anterior);
    if (!next) return;
    const current = document.querySelector('.screen[data-active="true"]');
    if (current) current.removeAttribute('data-active');
    next.setAttribute('data-active', 'true');
    const handlers = { 'screen-home': onEnterHome, 'screen-ongoing': onEnterOngoing };
    if (handlers[anterior]) handlers[anterior]();
  } else {
    history.pushState(null, '', '');
  }
});

history.pushState(null, '', '');

// ═══════════════════════════════════════
// ENTREGAS INTERIFOOD — motoboy recebe e entrega pedidos
// ═══════════════════════════════════════
let entregasListenerUnsub = null;
let entregaAtualId = null;
let entregaAtualDados = null;

function iniciarListenerEntregas() {
  if (!firebaseReady || !db) return;
  if (entregasListenerUnsub) return;

  // Escuta pedidos com status 'aguardando_entregador' — prontos pra busca
  const q = fb.query(
    fb.collection(db, 'pedidos_food'),
    fb.where('status', '==', 'aguardando_entregador'),
    fb.where('tipoEntrega', '==', 'interliga')
  );

  entregasListenerUnsub = fb.onSnapshot(q, (snap) => {
    const badge = document.getElementById('badge-entregas');
    const lista = document.getElementById('lista-pedidos-entrega');
    if (!lista) return;

    // Não mostra se já está em outra entrega
    if (entregaAtualId) return;

    const pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Atualiza badge
    if (badge) {
      badge.textContent = pedidos.length;
      badge.style.display = pedidos.length > 0 ? 'flex' : 'none';
    }

    if (pedidos.length === 0) {
      lista.innerHTML = `
        <div style="text-align:center;color:#9098A8;padding:30px;">
          <div style="font-size:32px;margin-bottom:8px;">🛵</div>
          <div style="font-weight:600;">Nenhuma entrega disponível</div>
          <div style="font-size:13px;margin-top:4px;">Quando um restaurante precisar de entregador, aparece aqui</div>
        </div>`;
      return;
    }

    lista.innerHTML = pedidos.map(p => {
      const itens = (p.itens || []).map(i => `${i.qtd}x ${i.nome}`).join(', ');
      return `
        <div style="background:#1A1F2E;border-radius:14px;border:1px solid #2A3142;padding:16px;">
          <div style="font-weight:700;font-size:15px;margin-bottom:6px;">🍔 ${p.restauranteNome || '—'}</div>
          <div style="font-size:13px;color:#9098A8;margin-bottom:4px;">Itens: ${itens}</div>
          <div style="font-size:13px;color:#9098A8;margin-bottom:8px;">📍 Entregar em: ${p.endereco || '—'}</div>
          <div style="font-size:15px;font-weight:700;color:#FF6B00;margin-bottom:12px;">Taxa: ${formatMoeda(p.taxaEntrega || 0)}</div>
          <button class="btn-accept" onclick="aceitarEntrega('${p.id}')">✅ Aceitar entrega</button>
        </div>`;
    }).join('');
  });
}

async function aceitarEntrega(pedidoId) {
  if (!firebaseReady || !db || !meuMotoristaId) return;
  try {
    await fb.updateDoc(fb.doc(db, 'pedidos_food', pedidoId), {
      status: 'entrega',
      entregadorId: meuMotoristaId,
      entregadorNome: state.motorista?.nome || 'Entregador',
      atualizadoEm: fb.serverTimestamp(),
    });

    entregaAtualId = pedidoId;
    // Busca os dados completos
    const snap = await fb.getDoc(fb.doc(db, 'pedidos_food', pedidoId));
    entregaAtualDados = snap.data();

    // Mostra o card de entrega em andamento
    document.getElementById('entrega-em-andamento').hidden = false;
    document.getElementById('entrega-restaurante-nome').textContent = entregaAtualDados.restauranteNome || '—';
    document.getElementById('entrega-restaurante-end').textContent = entregaAtualDados.enderecoRestaurante || 'Ver no mapa';
    document.getElementById('entrega-cliente-nome').textContent = entregaAtualDados.passageiroNome || '—';
    document.getElementById('entrega-cliente-end').textContent = entregaAtualDados.endereco || '—';

    document.getElementById('lista-pedidos-entrega').innerHTML = '';
    showToast('✅ Entrega aceita! Vá ao restaurante buscar o pedido.');
  } catch(e) {
    showToast('⚠️ Erro ao aceitar: ' + (e.message || e.code));
  }
}
// motorista.js é carregado como <script type="module">, então funções
// declaradas aqui ficam no escopo do módulo — não em window. O botão dessa
// tela é criado dinamicamente (innerHTML) com onclick="aceitarEntrega(...)",
// que roda no escopo global, então precisa dessa exposição explícita pra
// não dar "aceitarEntrega is not defined" ao clicar.
window.aceitarEntrega = aceitarEntrega;

document.getElementById('btn-entrega-coletei')?.addEventListener('click', async () => {
  if (!entregaAtualId) return;
  try {
    await fb.updateDoc(fb.doc(db, 'pedidos_food', entregaAtualId), {
      status: 'entrega_a_caminho',
      atualizadoEm: fb.serverTimestamp(),
    });
    document.getElementById('btn-entrega-coletei').hidden = true;
    document.getElementById('btn-entrega-entregue').hidden = false;
    document.getElementById('btn-entrega-devolver').hidden = false;
    showToast('🛵 Ótimo! Agora entregue ao cliente.');
  } catch(e) { showToast('⚠️ Erro: ' + e.message); }
});

document.getElementById('btn-entrega-entregue')?.addEventListener('click', async () => {
  if (!entregaAtualId) return;
  try {
    await fb.updateDoc(fb.doc(db, 'pedidos_food', entregaAtualId), {
      status: 'entregue',
      atualizadoEm: fb.serverTimestamp(),
    });
    showToast('🏠 Entrega concluída!');
    resetarEntregaAtual();
  } catch(e) { showToast('⚠️ Erro: ' + e.message); }
});

document.getElementById('btn-entrega-devolver')?.addEventListener('click', async () => {
  if (!entregaAtualId) return;
  const motivo = prompt('Motivo da devolução:\n1 - Cliente não encontrado\n2 - Cliente recusou o pedido\n3 - Endereço incorreto\n4 - Outro\n\nDigite o número ou descreva:');
  if (!motivo) return;
  try {
    await fb.updateDoc(fb.doc(db, 'pedidos_food', entregaAtualId), {
      status: 'devolvido',
      motivoDevolucao: motivo,
      atualizadoEm: fb.serverTimestamp(),
    });
    showToast('↩️ Devolução registrada — retorne ao restaurante.');
    resetarEntregaAtual();
  } catch(e) { showToast('⚠️ Erro: ' + e.message); }
});

function resetarEntregaAtual() {
  entregaAtualId = null;
  entregaAtualDados = null;
  document.getElementById('entrega-em-andamento').hidden = true;
  document.getElementById('btn-entrega-coletei').hidden = false;
  document.getElementById('btn-entrega-entregue').hidden = true;
  document.getElementById('btn-entrega-devolver').hidden = true;
}

function formatMoeda(v) { return 'R$ ' + Number(v||0).toFixed(2).replace('.', ','); }

function boot() {
  initFirebase(); // assíncrono — quando conectar, chama verificarCadastroMotorista() que decide a tela certa
  setTimeout(() => {
    // Rede de segurança: se o Firebase não respondeu em 6s (sem internet, erro etc.),
    // libera a Home mesmo assim, em vez de travar o motorista pra sempre no splash.
    const splash = document.getElementById('screen-splash');
    if (splash && splash.getAttribute('data-active') === 'true') {
      console.warn('[motorista] Firebase demorou pra responder — liberando Home em modo offline.');
      go('screen-home');
    }
  }, 6000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
