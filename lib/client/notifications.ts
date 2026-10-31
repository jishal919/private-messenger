const SERVICE_WORKER_PATH = "/sw.js";

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    throw new Error(
      "This browser does not support service workers."
    );
  }

  return navigator.serviceWorker.register(
    SERVICE_WORKER_PATH
  );
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  const registration =
    await registerPushServiceWorker();

  return registration.pushManager.getSubscription();
}

export async function subscribeToPush(): Promise<PushSubscription> {
  if (!("PushManager" in window)) {
    throw new Error(
      "This browser does not support push notifications."
    );
  }

  const publicKey =
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  if (!publicKey) {
    throw new Error(
      "NEXT_PUBLIC_VAPID_PUBLIC_KEY is not configured."
    );
  }

  const registration =
    await registerPushServiceWorker();

  const existing =
    await registration.pushManager.getSubscription();

  if (existing) {
    return existing;
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(
      publicKey
    ) as BufferSource,
  });
}

export async function unsubscribeFromPush(): Promise<PushSubscription | null> {
  const registration =
    await registerPushServiceWorker();

  const subscription =
    await registration.pushManager.getSubscription();

  if (!subscription) {
    return null;
  }

  await subscription.unsubscribe();

  return subscription;
}

function urlBase64ToUint8Array(
  value: string
): Uint8Array {
  const padding =
    "=".repeat((4 - (value.length % 4)) % 4);

  const base64 =
    (value + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");

  const rawData = window.atob(base64);

  return Uint8Array.from(
    [...rawData].map((char) =>
      char.charCodeAt(0)
    )
  );
}