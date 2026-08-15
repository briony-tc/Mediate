# Mediate

A self-hosted tracker for migrating a physical DVD/Blu-ray collection onto a [Jellyfin](https://jellyfin.org/) server: scan a disc's barcode, confirm the title, and watch its status move from *not started* to *staged* to *complete* as it gets ripped and filed — no manual bookkeeping in a spreadsheet.

## How it works

1. Scan a disc's barcode (a USB HID 2D scanner works out of the box — it types the digits like a keyboard, no driver needed).
2. The app looks up the barcode via [UPCitemdb](https://www.upcitemdb.com/), then searches [Watchmode](https://api.watchmode.com/) for a matching title, and you confirm which result is correct.
3. The confirmed title is saved as a disc with status `not_started`.
4. Two filesystem watchers (one for your rip-staging folder, one for your Jellyfin library folder) reconcile filenames against your discs as you rip and file them, updating status live in the browser over SSE — no page refresh needed.

Statuses: **not_started** (not yet ripped) → **staged** (ripped, not yet in Jellyfin) → **complete** (ripped, filed, and in Jellyfin).

## Prerequisites

- Node.js 22+
- A [Watchmode](https://api.watchmode.com/) API key (required — no key-less trial tier)
- A [UPCitemdb](https://www.upcitemdb.com/) API key (optional — falls back to their rate-limited anonymous trial endpoint if unset)
- A running Jellyfin server, plus a rip-staging folder your rip process writes into
- Both folders must follow this layout — it's how the watchers match files to discs:
  ```
  movies/<Title>/*.mkv
  tv/<Title>/<Season #>/*.mkv
  ```

## Local development

```bash
npm install
cp .env.example .env   # fill in WATCHMODE_API_KEY at minimum
npm run db:migrate
npm run dev
```

Run `npm run check` (typecheck) and `npm test` (unit tests) before opening a PR.

## Deploying with Docker

```bash
cp .env.example .env
# set WATCHMODE_API_KEY, RIP_WEBHOOK_SECRET, VAPID_* keys, and
# STAGING_HOST_PATH / JELLYFIN_HOST_PATH (real host paths to your
# staging and Jellyfin library folders)
docker compose up -d --build
```

`docker compose up -d` alone does **not** rebuild the image after you change the Dockerfile or pull new commits — use `--build`, or run `docker compose build` first.

See `.env.example` for the full list of variables and what each one is for.

## Rip automation (optional)

`scripts/auto-rip.sh` is a reference implementation of an automated rip pipeline: a udev rule fires it when a disc is inserted, it rips with the MakeMKV CLI (skipping anything under 10 minutes — trailers, menu loops, ad clips), reports live progress to the app via a bearer-token-authenticated webhook, and tells the app when the rip is done so it can file the disc and (optionally) trigger a Jellyfin library refresh.

It was built against one specific homelab setup (MakeMKV running in a Docker container, Jellyfin on the same host) and is **not** a drop-in tool — every host-specific value (URLs, paths, drive/container names) is a config variable read from `scripts/auto-rip.conf` (copy `scripts/auto-rip.conf.example` and fill it in) rather than hardcoded, but you'll still need your own udev rule to trigger it and to adjust it for your own rip setup. The "arm a disc before inserting it, then match ripped output to it unconditionally" workflow (`POST /api/arm`) is the part worth reusing even if your rip pipeline looks nothing like this one.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) — free to use, modify, and share for any noncommercial purpose. Get in touch if you want to discuss commercial use.
