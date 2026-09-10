# Mediate — Android app

A thin native Android wrapper around the web app: a [Trusted Web
Activity](https://developer.chrome.com/docs/android/trusted-web-activity)
(TWA), not an embedded `WebView`. That distinction matters: Android's
embedded `WebView` doesn't support the Push API at all, so a plain WebView
shell would silently break notifications. A TWA instead launches your
phone's real, already-installed Chrome in a chromeless window, so the site's
existing Web Push code (VAPID keys, `notifyAll()`, `src/service-worker.ts`)
works completely unchanged — no Firebase, no Google account, no server-side
notification code.

No server address is baked in anywhere — this repo is public, so the
"connection string" (your Mediate server's URL) is something you type into
the app on your own device, once, the first time you open it. It's stored
in the app's local `SharedPreferences`, never in the repo.

## What's here

- `MainActivity` — onboarding form (first launch) and launcher. If a server
  URL is already saved, it hands off straight to the TWA and finishes; you
  never see native UI again on a normal launch.
- A home-screen widget (`widget/RipStatusWidgetProvider` +
  `widget/WidgetUpdateWorker`) showing whichever disc is currently armed or
  ripping (with title-progress, e.g. "Alien (2/4)"), polling
  `GET /api/widget/status` roughly every 30 minutes via WorkManager —
  Android doesn't guarantee anything tighter for background work, widget or
  not.
- A static app shortcut ("Settings", long-press the app icon) to change the
  server address later without uninstalling.

## Prerequisites

- [Android Studio](https://developer.android.com/studio) (bundles the SDK
  and Gradle — nothing else to install separately).
- A Pixel (or any Android 8.0+ / API 26+ device) with
  [USB debugging](https://developer.android.com/studio/debug/dev-options)
  enabled, connected over USB — or build a release APK and sideload it.
- Chrome installed on the phone (virtually guaranteed on a Pixel) — TWAs
  render through it.

## Building & running

1. Open the `android/` folder in Android Studio (`File → Open`, pick this
   directory — not the repo root).
2. Let it sync. There's no `gradlew` wrapper jar checked in (it's a binary
   this environment couldn't generate without Gradle installed); Android
   Studio detects that and offers to generate/download it on first sync —
   accept that prompt. If it doesn't offer, run `gradle wrapper` once
   yourself if you have a standalone Gradle install, or use
   `Tools → ... → Generate Gradle Wrapper`.
3. With your phone connected, click **Run** (▶) targeting your device.
4. On first launch, the app shows a plain "Server address" form. Enter your
   Mediate server's URL exactly as you'd type it in a browser (e.g.
   `https://mediate.example.com` or `http://192.168.1.50:3000`) and tap
   **Save and open**.

Changing servers later: long-press the app icon → **Settings**.

## Adding the widget

Long-press an empty spot on the home screen → **Widgets** → **Mediate** →
drag the "Rip status" widget onto the home screen. It shows the placeholder
text immediately and refreshes with real data within a few seconds (it
kicks off an immediate background fetch as soon as it's placed), then every
~30 minutes after that. If the phone isn't on your home network when it
tries to refresh, it just keeps showing whatever it last knew — no error
shown, this is expected.

## Enabling notifications

Open the app once (it'll be showing the normal web page in the TWA), then
use the existing **Enable notifications** button on the rip queue page and
grant the permission when prompted. This is the same Web Push subscription
flow as using the site in a regular browser — nothing Android-specific
about it.

## Optional: a fully chromeless window

Without any extra setup, the TWA shows a slim Chrome toolbar the first time
(and briefly on each cold start) while it verifies your site. To make that
verification succeed and get a completely chromeless window every time,
host a [Digital Asset Links](https://developer.android.com/training/app-links/verify-android-applinks#web-assoc)
file at `https://<your-server>/.well-known/assetlinks.json` declaring this
app's package (`com.mediate.app`) and your signing key's SHA-256
fingerprint, matching
[Google's TWA quickstart](https://developer.chrome.com/docs/android/trusted-web-activity/quick-start#creating_your_asset_link_file).

This is inherently specific to _your_ domain and _your_ signing key, so
it's not something this repo can ship generically — it's a one-time file
you host yourself if you want the fully chromeless look. Everything else
(the app itself, push, the widget) works identically with or without it.

## If you fork this for your own server

`applicationId`/`namespace` in `app/build.gradle.kts` is `com.mediate.app`.
If you might ever install your fork alongside someone else's build (e.g.
via a shared APK release), change that to something unique to you first —
Android treats the applicationId as the app's identity, and two different
builds sharing one will conflict on the same device.
