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
		// Colors the status bar and gesture-nav bar to match the page's own
		// background (see body's bg-white/dark:bg-gray-900 in layout.css and the
		// #111827 theme-color already used in manifest.webmanifest/app.html) so
		// they blend into the content instead of showing as a plain black bar
		// above and below it. COLOR_SCHEME_SYSTEM follows the phone's system
		// theme - it can't see the page's own in-app dark-mode toggle, since
		// that's a click-time JS/localStorage choice the native side has no way
		// to know about before the page has even loaded.
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
