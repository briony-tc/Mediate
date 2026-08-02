import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { pushSubscriptions } from '$lib/server/db/schema';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const endpoint: string | undefined = body?.endpoint;
	const p256dh: string | undefined = body?.keys?.p256dh;
	const auth: string | undefined = body?.keys?.auth;

	if (!endpoint || !p256dh || !auth) {
		return json({ error: 'endpoint and keys.p256dh/keys.auth are required' }, { status: 400 });
	}

	const existing = db
		.select()
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.endpoint, endpoint))
		.get();

	if (!existing) {
		db.insert(pushSubscriptions).values({ endpoint, p256dh, auth }).run();
	}

	return json({ ok: true }, { status: 201 });
};
