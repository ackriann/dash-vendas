/* Service worker do painel: recebe as notificações push de venda. */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: "Painel", body: event.data && event.data.text() }; }
  var title = data.title || "Nova notificação";
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag,
      renotify: !!data.tag,
      vibrate: data.sound === "alert" ? [300, 100, 300] : [100, 50, 100, 50, 200],
      data: { url: data.url || "/" }
    }),
    // Painel aberto: pede para a tela tocar o som de caixa (a notificação usa o som do aparelho)
    data.sound === "sale" ? playOnOpenPanel() : null
  ]));
});

function playOnOpenPanel() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    if (!list.length) return;
    var target = list.find(function (c) { return c.focused; }) || list.find(function (c) { return c.visibilityState === "visible"; }) || list[0];
    target.postMessage({ type: "sale-sound" });
  });
}

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if ("focus" in c) { c.navigate(url); return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
