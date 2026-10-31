self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      title: "New message",
      body: event.data ? event.data.text() : "You have a new message.",
    };
  }

  const title = data.title || "New message";

  const options = {
    body: data.body || "You have a new message.",
    icon: data.icon || "/icon-192.png",
    badge: data.badge || "/icon-192.png",

    // Keep notifications from unrelated conversations separate.
    tag: data.tag || "messenger-message",

    // Play/show the notification again when a new message
    // arrives in the same conversation.
    renotify: true,

    // WhatsApp-like notification behavior.
    requireInteraction: false,
    silent: false,

    data: {
        url: data.url || "/chat",
        conversationId: data.conversationId || null,
    },

    actions: [
        {
        action: "open",
        title: "Open",
        },
    ],
    };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl =
    event.notification?.data?.url || "/chat";

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();

          if ("navigate" in client) {
            return client.navigate(targetUrl);
          }

          return;
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }

      return undefined;
    })
  );
});