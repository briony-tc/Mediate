import { env } from '$env/dynamic/private';

function required(name: string): string {
	const value = env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

export const serverEnv = {
	get DB_PATH() {
		return required('DB_PATH');
	},
	get STAGING_PATH() {
		return required('STAGING_PATH');
	},
	get JELLYFIN_PATH() {
		return required('JELLYFIN_PATH');
	},
	get WATCHMODE_API_KEY() {
		return required('WATCHMODE_API_KEY');
	},
	get UPCITEMDB_API_KEY() {
		return env.UPCITEMDB_API_KEY;
	},
	get RIP_WEBHOOK_SECRET() {
		return required('RIP_WEBHOOK_SECRET');
	},
	get VAPID_PUBLIC_KEY() {
		return required('VAPID_PUBLIC_KEY');
	},
	get VAPID_PRIVATE_KEY() {
		return required('VAPID_PRIVATE_KEY');
	},
	get VAPID_SUBJECT() {
		return required('VAPID_SUBJECT');
	}
};

export function assertServerEnv() {
	serverEnv.DB_PATH;
	serverEnv.STAGING_PATH;
	serverEnv.JELLYFIN_PATH;
	serverEnv.WATCHMODE_API_KEY;
	serverEnv.RIP_WEBHOOK_SECRET;
	serverEnv.VAPID_PUBLIC_KEY;
	serverEnv.VAPID_PRIVATE_KEY;
	serverEnv.VAPID_SUBJECT;
}
