plugins {
	id("com.android.application")
	id("org.jetbrains.kotlin.android")
}

android {
	namespace = "com.mediate.app"
	compileSdk = 36

	defaultConfig {
		applicationId = "com.mediate.app"
		minSdk = 26
		targetSdk = 35
		versionCode = 1
		versionName = "1.0"
	}

	buildTypes {
		release {
			isMinifyEnabled = false
			proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
		}
	}

	compileOptions {
		sourceCompatibility = JavaVersion.VERSION_17
		targetCompatibility = JavaVersion.VERSION_17
	}
	kotlinOptions {
		jvmTarget = "17"
	}
}

dependencies {
	implementation("androidx.core:core-ktx:1.13.1")
	implementation("androidx.appcompat:appcompat:1.7.0")
	implementation("com.google.android.material:material:1.12.0")

	// Trusted Web Activity support - launches real Chrome (not a WebView) so
	// the site's existing Web Push / service worker code works unchanged.
	implementation("androidx.browser:browser:1.8.0")
	implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.6.1")

	// Background refresh for the home-screen widget.
	implementation("androidx.work:work-runtime-ktx:2.9.1")
	implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
