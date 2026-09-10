package com.mediate.app

import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
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
		// launch(Uri) already falls back to a plain Custom Tab if no
		// TWA-capable browser is available, so no manual fallback is needed.
		val launcher = TwaLauncher(this)
		twaLauncher = launcher
		launcher.launch(Uri.parse(url))
	}

	companion object {
		const val EXTRA_FORCE_SETTINGS = "force_settings"
	}
}
