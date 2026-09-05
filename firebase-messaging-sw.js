/* Interfood · homologação · Firebase Cloud Messaging */
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

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

messaging.onBackgroundMessage(payload => {
  const d = payload && payload.data ? payload.data : {};
  const title = d.title || 'Interfood';
  const base = self.registration.scope;
  const options = {
    body: d.body || 'Há uma atualização no seu pedido.',
    icon: resolverUrl(d.icon || './icon-192.png'),
    badge: resolverUrl(d.badge || './icon-192.png'),
    tag: d.tag || 'interfood-push',
    renotify: true,
    data: { url: resolverUrl(d.url || './') }
  };
  return self.registration.showNotification(title, options);
});

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
