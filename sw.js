// sw.js — منصة موثوق
// يستقبل إشعارات Push من المتصفح ويعرضها كإشعار حقيقي على مستوى النظام،
// حتى لو كان تبويب الموقع غير مفتوح حاليًا (بشرط أن يكون المتصفح نفسه شغّالًا،
// أو أن يكون الموقع مثبّتًا كتطبيق على الشاشة الرئيسية على آيفون).

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(data.title || 'رسالة جديدة على منصة موثوق', {
      body: data.body || '',
      dir: 'rtl',
      lang: 'ar',
      tag: 'mawthouq-message',
      data: { url: data.url || '/messages.html' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/messages.html';

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('messages.html') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
