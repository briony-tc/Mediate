package com.mediate.app

import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.browser.trusted.TrustedWebActivityIntentBuilder
import com.google.androidbrowserhelper.trusted.QualityEnforcer
import com.google.androidbrowserhelper.trusted.TwaLauncher

/**
 * Doubles as onboarding, "change server" (reached via the app icon's static
 * shortcut - see shortcuts.xml), and the launcher: if a server URL is saved
 * and this wasn't opened via the settings shortcut, it hands off straight to
 * a Trusted Web Activity and finishes, so the native UI is never seen again
 * on a normal launch.
 */
class MainActivity : AppCompatActivity() {

	private var twaLauncher: TwaLauncher? = null

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)

		val savedUrl = ServerPrefs.getServerUrl(this)
		val forceSettings = intent?.getBooleanExtra(EXTRA_FORCE_SETTINGS, false) ?: false

		if (savedUrl != null && !forceSettings) {
			launchTwa(savedUrl)
			finish()
			return
		}

		setContentView(R.layout.activity_main)
		val input = findViewById<EditText>(R.id.input_server_url)
		val save = findViewById<Button>(R.id.button_save)
		input.setText(savedUrl.orEmpty())

		save.setOnClickListener {
			val url = input.text.toString().trim()
			if (!isValidServerUrl(url)) {
				Toast.makeText(this, R.string.error_invalid_url, Toast.LENGTH_SHORT).show()
				return@setOnClickListener
			}
			ServerPrefs.setServerUrl(this, url)
			launchTwa(url)
			finish()
		}
	}

	override fun onDestroy() {
		// Unbinds the Custom Tabs service connection launchTwa() opened -
		// harmless no-op if launchTwa() was never called (e.g. this activity
		// finishes from the settings form without a launch happening).
		twaLauncher?.destroy()
		super.onDestroy()
	}

	private fun isValidServerUrl(url: String): Boolean {
		val uri = Uri.parse(url)
		return (uri.scheme == "http" || uri.scheme == "https") && !uri.host.isNullOrBlank()
	}

	private fun launchTwa(url: String) {
		// Colors the status bar and gesture-nav bar to match the page (see
		// body's bg-white/dark:bg-gray-900 in layout.css) instead of leaving
		// them a mismatched near-black default. Confirmed on-device that a TWA
		// does NOT dynamically pick up the page's own <meta name="theme-color">
		// the way a regular Chrome tab does - without this, plain launch(Uri)
		// left the bars a fixed dark default regardless of page content, even
		// with a correct live theme-color value set. That in turn means this
		// can only follow the *phone's* system light/dark setting
		// (COLOR_SCHEME_SYSTEM), not this app's own independent in-page toggle
		// (see $lib/theme.ts) - there's no channel from JS back to this native
		// launch call to know that choice before the page has even loaded. In
		// practice the two agree unless someone's deliberately overridden the
		// in-app theme against their system setting.
		val lightColors =
			CustomTabColorSchemeParams.Builder()
				.setToolbarColor(Color.WHITE)
				.setNavigationBarColor(Color.WHITE)
				.build()
		val darkColors =
			CustomTabColorSchemeParams.Builder()
				.setToolbarColor(Color.parseColor("#111827"))
				.setNavigationBarColor(Color.parseColor("#111827"))
				.build()
		val builder =
			TrustedWebActivityIntentBuilder(Uri.parse(url))
				.setColorScheme(CustomTabsIntent.COLOR_SCHEME_SYSTEM)
				.setColorSchemeParams(CustomTabsIntent.COLOR_SCHEME_LIGHT, lightColors)
				.setColorSchemeParams(CustomTabsIntent.COLOR_SCHEME_DARK, darkColors)

		// Mirrors TwaLauncher.launch(Uri)'s own default (QualityEnforcer, plain
		// Custom Tab fallback if no TWA-capable browser is available) - just
		// with the color scheme params attached, which that shorthand doesn't
		// take.
		val launcher = TwaLauncher(this)
		twaLauncher = launcher
		launcher.launch(builder, QualityEnforcer(), null, null)
	}

	companion object {
		const val EXTRA_FORCE_SETTINGS = "force_settings"
	}
}
