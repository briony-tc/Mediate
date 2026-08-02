import webPush from 'web-push';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { pushSubscriptions } from './db/schema';
import { serverEnv } from './env';

webPush.setVapidDetails(
	serverEnv.VAPID_SUBJECT,
	serverEnv.VAPID_PUBLIC_KEY,
	serverEnv.VAPID_PRIVATE_KEY
);

/**
 * Sends a push notification to every subscribed browser. A subscription that
 * comes back 404/410 means the browser/OS has dropped it (uninstall, cleared
 * data, etc.) - those are pruned rather than retried forever.
 */
export async function notifyAll(title: string, body: string): Promise<void> {
	const subscriptions = db.select().from(pushSubscriptions).all();

	await Promise.all(
		subscriptions.map(async (sub) => {
			try {
				await webPush.sendNotification(
					{
						endpoint: sub.endpoint,
						keys: { p256dh: sub.p256dh, auth: sub.auth }
					},
					JSON.stringify({ title, body })
				);
			} catch (err) {
				const statusCode = (err as { statusCode?: number }).statusCode;
				if (statusCode === 404 || statusCode === 410) {
					db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run();
				} else {
					console.error(`[push] failed to notify subscription ${sub.id}:`, err);
				}
			}
		})
	);
}
