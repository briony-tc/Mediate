package com.mediate.app.widget

import android.appwidget.AppWidgetManager
import android.content.Context
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
			try {
				val connection = URL("$serverUrl/api/widget/status").openConnection() as HttpURLConnection
				connection.connectTimeout = 10_000
				connection.readTimeout = 10_000
				connection.requestMethod = "GET"

				val body = connection.inputStream.bufferedReader().use(BufferedReader::readText)
				connection.disconnect()
				parseStatusText(body)
			} catch (e: Exception) {
				// Most likely just "not on the home network right now" - not worth
				// surfacing as an error, the widget just keeps its last-known text.
				applicationContext.getString(R.string.widget_nothing_in_progress)
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
	}
}
