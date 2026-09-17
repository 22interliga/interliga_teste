/* Interfood · homologação · Web Push/FCM
   Service worker enxuto: recebe o evento Web Push diretamente e exibe a notificação.
   Não depende do Firebase Messaging dentro do service worker. */

const BUILD='2026.09.06.3';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

function resolverUrl(valor) {
  try {
    return new URL(valor || './', self.registration.scope).href;
  } catch (_) {
    return self.registration.scope;
  }
}

function extrairPayload(event) {
  try {
    if (!event.data) return {};
    const p = event.data.json();
    return p && typeof p === 'object' ? p : {};
  } catch (_) {
    try {
      return { data: { body: event.data ? event.data.text() : '' } };
    } catch (_) {
      return {};
    }
  }
}

self.addEventListener('push', event => {
  const payload = extrairPayload(event);
  const d = payload.data || {};
  const n = payload.notification || {};
  const wo = payload.webpush || {};
  const wn = wo.notification || {};
  const fcm = payload.fcmOptions || wo.fcmOptions || {};

  const title = d.title || n.title || wn.title || 'Interfood';
  const body = d.body || n.body || wn.body || 'Há uma atualização no seu pedido.';
  const icon = resolverUrl(d.icon || n.icon || wn.icon || './icon-192.png');
  const badge = resolverUrl(d.badge || n.badge || wn.badge || './icon-192.png');
  const tag = d.tag || n.tag || wn.tag || ('interfood-push-' + BUILD);
  const url = resolverUrl(d.url || fcm.link || './');

  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon,
    badge,
    tag,
    renotify: true,
    data: { url }
  }));
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
