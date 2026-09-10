package com.mediate.app

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.trusted.TrustedWebActivityIntentBuilder

/**
 * Doubles as onboarding, "change server" (reached via the app icon's static
 * shortcut - see shortcuts.xml), and the launcher: if a server URL is saved
 * and this wasn't opened via the settings shortcut, it hands off straight to
 * a Trusted Web Activity and finishes, so the native UI is never seen again
 * on a normal launch.
 */
class MainActivity : AppCompatActivity() {

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

	private fun isValidServerUrl(url: String): Boolean {
		val uri = Uri.parse(url)
		return (uri.scheme == "http" || uri.scheme == "https") && !uri.host.isNullOrBlank()
	}

	private fun launchTwa(url: String) {
		val uri = Uri.parse(url)
		try {
			TrustedWebActivityIntentBuilder(uri).build().launchTrustedWebActivity(this)
		} catch (e: ActivityNotFoundException) {
			// No Chrome (or nothing that supports TWAs) installed - fall back to
			// whatever the phone's default browser handler is rather than dying.
			startActivity(Intent(Intent.ACTION_VIEW, uri))
		}
	}

	companion object {
		const val EXTRA_FORCE_SETTINGS = "force_settings"
	}
}
