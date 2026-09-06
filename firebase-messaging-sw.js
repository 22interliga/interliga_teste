/* Interfood · homologacao · Firebase Cloud Messaging */
const INTERFOOD_SW_VERSION='2026.09.06.2';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
  if(event.data && event.data.type==='INTERFOOD_SW_VERSION'){
    event.source && event.source.postMessage({type:'INTERFOOD_SW_VERSION',version:INTERFOOD_SW_VERSION});
  }
  if(event.data && event.data.type==='SKIP_WAITING') self.skipWaiting();
});

importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBwMMsff1hV-6vDuQb3EK-EvSkkhYVBRFE',
  authDomain: 'interliga-homologacao-eb0f2.firebaseapp.com',
  projectId: 'interliga-homologacao-eb0f2',
  storageBucket: 'interliga-homologacao-eb0f2.firebasestorage.app',
  messagingSenderId: '997118774501',
  appId: '1:997118774501:web:59f56ea39ed070986d180c'
});

const messaging = firebase.messaging();

function resolverUrl(valor) {
  try {
    return new URL(valor || './', self.registration.scope).href;
  } catch (_) {
    return self.registration.scope;
  }
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destino = resolverUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const abertas = await clients.matchAll({type: 'window', includeUncontrolled: true});
    for (const c of abertas) {
      if (c.url === destino && 'focus' in c) return c.focus();
    }
    return clients.openWindow(destino);
  })());
});

messaging.onBackgroundMessage(payload => {
  const d = payload && payload.data ? payload.data : {};
  const n = payload && payload.notification ? payload.notification : {};
  const title = n.title || d.title || 'Interfood';
  const options = {
    body: n.body || d.body || 'Ha uma atualizacao no seu pedido.',
    icon: n.icon || resolverUrl(d.icon || './icon-192.png'),
    badge: resolverUrl(d.badge || './icon-192.png'),
    tag: d.tag || 'interfood-push',
    renotify: true,
    data: { url: resolverUrl(d.url || './') }
  };
  return self.registration.showNotification(title, options);
});
