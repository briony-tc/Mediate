import { timingSafeEqual } from 'node:crypto';
import { serverEnv } from './env';

/** Shared bearer-token check for the rip-automation webhooks (rip-complete, rip-progress). */
export function isAuthorizedRipWebhook(request: Request): boolean {
	const header = request.headers.get('authorization') ?? '';
	const provided = Buffer.from(header.replace(/^Bearer\s+/i, ''));
	const expected = Buffer.from(serverEnv.RIP_WEBHOOK_SECRET);
	return provided.length === expected.length && timingSafeEqual(provided, expected);
}
