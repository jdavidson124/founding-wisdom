const CACHE_NAME = 'american-gazette-v2';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// Handle push from server (Vercel cron)
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'American Gazette', body: e.data?.text() || 'New dispatch available.' }; }

  e.waitUntil(
    self.registration.showNotification(data.title || 'American Gazette', {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      tag: 'daily-quote',
      renotify: true,
      data: data.data || {}
    })
  );
});

// Handle notification click — open app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow('./');
    })
  );
});

// Legacy: handle messages from main thread (fallback)
self.addEventListener('message', e => {
  if (e.data?.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(e.data.title, {
      body: e.data.body,
      icon: '/icon-192.png',
      tag: 'daily-quote',
      renotify: true,
      vibrate: [200, 100, 200]
    });
  }
});
