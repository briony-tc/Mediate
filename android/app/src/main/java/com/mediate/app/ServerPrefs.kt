package com.mediate.app

import android.content.Context

/**
 * The "connection string" - the server address, entered once on-device via
 * MainActivity's form and never checked into the repo. Shared by the
 * launcher activity and the widget's background worker.
 */
object ServerPrefs {
	private const val PREFS_NAME = "mediate_prefs"
	private const val KEY_SERVER_URL = "server_url"

	fun getServerUrl(context: Context): String? {
		val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
		return prefs.getString(KEY_SERVER_URL, null)?.takeIf { it.isNotBlank() }
	}

	fun setServerUrl(context: Context, url: String) {
		// Trimmed so callers can always build "$serverUrl/api/..." without
		// risking a double slash.
		val trimmed = url.trimEnd('/')
		context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
			.edit()
			.putString(KEY_SERVER_URL, trimmed)
			.apply()
	}
}
