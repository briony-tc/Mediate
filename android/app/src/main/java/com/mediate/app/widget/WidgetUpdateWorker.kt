package com.mediate.app.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.util.Log
import android.widget.RemoteViews
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.mediate.app.R
import com.mediate.app.ServerPrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Polls GET /api/widget/status on the configured server and updates every
 * placed instance of the widget. Scheduled by RipStatusWidgetProvider as a
 * ~30-minute periodic WorkManager job (Android doesn't guarantee anything
 * tighter for background work) plus an immediate one-off right after the
 * widget is added.
 */
class WidgetUpdateWorker(appContext: Context, params: WorkerParameters) :
	CoroutineWorker(appContext, params) {

	override suspend fun doWork(): Result {
		val appWidgetManager = AppWidgetManager.getInstance(applicationContext)
		val widgetIds =
			appWidgetManager.getAppWidgetIds(RipStatusWidgetProvider.componentName(applicationContext))
		Log.d(TAG, "doWork: ${widgetIds.size} widget(s) placed")
		if (widgetIds.isEmpty()) return Result.success()

		val serverUrl = ServerPrefs.getServerUrl(applicationContext)
		val statusText =
			if (serverUrl == null) {
				applicationContext.getString(R.string.widget_not_configured)
			} else {
				fetchStatusText(serverUrl)
			}

		for (id in widgetIds) {
			val views = RemoteViews(applicationContext.packageName, R.layout.widget_rip_status)
			views.setTextViewText(R.id.widget_status_text, statusText)
			views.setOnClickPendingIntent(
				R.id.widget_root,
				RipStatusWidgetProvider.openAppPendingIntent(applicationContext)
			)
			appWidgetManager.updateAppWidget(id, views)
		}
		return Result.success()
	}

	private suspend fun fetchStatusText(serverUrl: String): String =
		withContext(Dispatchers.IO) {
			val requestUrl = "$serverUrl/api/widget/status"
			try {
				Log.d(TAG, "fetching $requestUrl")
				val connection = URL(requestUrl).openConnection() as HttpURLConnection
				connection.connectTimeout = 10_000
				connection.readTimeout = 10_000
				connection.requestMethod = "GET"

				val responseCode = connection.responseCode
				if (responseCode !in 200..299) {
					Log.e(TAG, "fetch failed: HTTP $responseCode from $requestUrl")
					connection.disconnect()
					return@withContext "Can't reach server (HTTP $responseCode)"
				}

				val body = connection.inputStream.bufferedReader().use(BufferedReader::readText)
				connection.disconnect()
				Log.d(TAG, "fetch succeeded: $body")
				parseStatusText(body)
			} catch (e: Exception) {
				// Distinct from the genuine "server said nothing's happening" text
				// below - this is "the request itself failed" (off the home
				// network, DNS, timeout, etc.), which used to render identically
				// to a real idle state, making failures silently indistinguishable
				// from success.
				Log.e(TAG, "fetch failed for $requestUrl", e)
				"Can't reach server"
			}
		}

	private fun parseStatusText(body: String): String {
		val json = JSONObject(body)

		val ripping = json.optJSONObject("ripping")
		if (ripping != null) {
			val title = ripping.getString("title")
			val completed = ripping.optInt("ripTitlesCompleted", 0)
			val total = ripping.optInt("ripTitlesTotal", 0)
			return if (total > 0) "$title ($completed/$total)" else title
		}

		val armed = json.optJSONObject("armed")
		if (armed != null) {
			return "Armed: ${armed.getString("title")}"
		}

		return applicationContext.getString(R.string.widget_nothing_in_progress)
	}

	companion object {
		const val REFRESH_INTERVAL_MINUTES = 30L
		const val UNIQUE_WORK_NAME = "widget_status_refresh"
		private const val TAG = "WidgetUpdateWorker"
	}
}
