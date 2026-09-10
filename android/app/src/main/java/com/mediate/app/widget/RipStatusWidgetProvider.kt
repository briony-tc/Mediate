package com.mediate.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.mediate.app.MainActivity
import com.mediate.app.R
import com.mediate.app.ServerPrefs
import java.util.concurrent.TimeUnit

class RipStatusWidgetProvider : AppWidgetProvider() {

	override fun onUpdate(
		context: Context,
		appWidgetManager: AppWidgetManager,
		appWidgetIds: IntArray
	) {
		for (id in appWidgetIds) {
			renderPlaceholder(context, appWidgetManager, id)
		}
		// Refresh right away instead of leaving the widget showing the
		// placeholder until the next periodic run, up to REFRESH_INTERVAL_MINUTES
		// later.
		WorkManager.getInstance(context)
			.enqueue(OneTimeWorkRequestBuilder<WidgetUpdateWorker>().build())
		schedulePeriodicRefresh(context)
	}

	override fun onEnabled(context: Context) {
		schedulePeriodicRefresh(context)
	}

	override fun onDisabled(context: Context) {
		WorkManager.getInstance(context).cancelUniqueWork(WidgetUpdateWorker.UNIQUE_WORK_NAME)
	}

	private fun schedulePeriodicRefresh(context: Context) {
		val request =
			PeriodicWorkRequestBuilder<WidgetUpdateWorker>(
				WidgetUpdateWorker.REFRESH_INTERVAL_MINUTES,
				TimeUnit.MINUTES
			).build()
		WorkManager.getInstance(context).enqueueUniquePeriodicWork(
			WidgetUpdateWorker.UNIQUE_WORK_NAME,
			ExistingPeriodicWorkPolicy.KEEP,
			request
		)
	}

	private fun renderPlaceholder(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
		val views = RemoteViews(context.packageName, R.layout.widget_rip_status)
		val configured = ServerPrefs.getServerUrl(context) != null
		views.setTextViewText(
			R.id.widget_status_text,
			context.getString(
				if (configured) R.string.widget_nothing_in_progress else R.string.widget_not_configured
			)
		)
		views.setOnClickPendingIntent(R.id.widget_root, openAppPendingIntent(context))
		appWidgetManager.updateAppWidget(appWidgetId, views)
	}

	companion object {
		fun openAppPendingIntent(context: Context): PendingIntent {
			val intent = Intent(context, MainActivity::class.java)
			return PendingIntent.getActivity(
				context,
				0,
				intent,
				PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
			)
		}

		fun componentName(context: Context) = ComponentName(context, RipStatusWidgetProvider::class.java)
	}
}
