/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('push', (event: PushEvent) => {
	const data = event.data?.json() as { title: string; body: string } | undefined;
	if (!data) return;

	event.waitUntil(sw.registration.showNotification(data.title, { body: data.body }));
});

sw.addEventListener('notificationclick', (event: NotificationEvent) => {
	event.notification.close();
	event.waitUntil(
		sw.clients.matchAll({ type: 'window' }).then((clients) => {
			const existing = clients.find((client) => 'focus' in client);
			if (existing) return (existing as WindowClient).focus();
			return sw.clients.openWindow('/');
		})
	);
});
