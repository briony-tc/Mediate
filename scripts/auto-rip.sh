#!/usr/bin/env bash
# Triggered by udev (see 99-makemkv-autorip.rules) when a disc is inserted
# into the optical drive. Rips with the MakeMKV CLI (no GUI dialogs),
# skipping any title under 10 minutes (trailers, menu loops, ad clips) and
# ripping everything else - reports live progress to mediate
# while ripping, then tells it the rip is done via /api/rip-complete.
#
# This is a reference implementation of the "arm before inserting" +
# webhook-progress design, built against one specific homelab (a udev rule
# firing this on disc insert, MakeMKV running in a Docker container, Jellyfin
# on the same host). Every host-specific value below is a config variable
# with a generic-but-plausible default - copy scripts/auto-rip.conf.example
# to the CONFIG_FILE path (or export the same names before running) and
# adjust for your own setup rather than editing the constants in place.
#
# Deploying a change to this file: whichever host actually runs it needs its
# own up-to-date copy - editing a checked-out copy of this repo alone has no
# effect on a live system elsewhere.
set -euo pipefail

CONFIG_FILE="${AUTO_RIP_CONFIG_FILE:-/opt/data/scripts/auto-rip.conf}"
if [ -f "$CONFIG_FILE" ]; then
	# shellcheck source=/dev/null
	source "$CONFIG_FILE"
fi

LOCK_FILE="${LOCK_FILE:-/opt/data/scripts/.auto-rip.lock}"
LOG_FILE="${LOG_FILE:-/opt/data/scripts/autorip.log}"
STAGING_DIR="${STAGING_DIR:-/mnt/storage/media/staging}"
APP_URL="${APP_URL:-https://mediate.example.com}"
WEBHOOK_URL="${WEBHOOK_URL:-$APP_URL/api/rip-complete}"
PROGRESS_WEBHOOK_URL="${PROGRESS_WEBHOOK_URL:-$APP_URL/api/rip-progress}"
WEBHOOK_SECRET_FILE="${WEBHOOK_SECRET_FILE:-/opt/data/scripts/rip-webhook-secret}"
# Triggers a Jellyfin library scan for whichever library (movies/tvshows) a
# rip actually landed in, once mediate confirms it filed the
# disc - so new content shows up without waiting for Jellyfin's own scheduled
# scan or a manual "Scan Library" click. Needs a Jellyfin API key the user
# generates themselves (Dashboard > Administration > API Keys) and saves to
# JELLYFIN_API_KEY_FILE - missing/unreadable just skips the refresh (logged,
# non-fatal), since the rip itself has already fully succeeded by this point.
JELLYFIN_URL="${JELLYFIN_URL:-https://jellyfin.example.com}"
JELLYFIN_API_KEY_FILE="${JELLYFIN_API_KEY_FILE:-/opt/data/scripts/jellyfin-api-key}"
DRIVE="${DRIVE:-/dev/sr0}"
CONTAINER="${CONTAINER:-makemkv}"
# This script runs as root (udev runs RUN+= scripts as root), so anything it
# rips ends up root-owned - harmless for the app's own automated promotion
# (which runs inside its own container, unaffected by host file ownership),
# but blocks manual intervention over Samba whenever a rip doesn't get
# auto-filed (confirmed live: macOS Finder refused to move a root-owned
# staging folder - "you don't have permission to access some of the items" -
# even though the files inside were world-readable/writable, because moving
# requires write access to the *directory*, which was root-only). Chowned to
# STAGING_OWNER right after every successful rip below - set this to the
# non-root user that needs write access to the staging folder afterward
# (e.g. for a Samba share), or leave unset to skip the chown entirely.
STAGING_OWNER="${STAGING_OWNER:-}"
# Full path to makemkvcon *inside* the container - needed because it isn't
# necessarily on $PATH for `docker exec` sessions (confirmed on at least one
# real image: exec fails with "executable file not found in $PATH" without
# it).
MAKEMKVCON="${MAKEMKVCON:-/opt/makemkv/bin/makemkvcon}"

log() {
	echo "$(date -Iseconds) $*" >>"$LOG_FILE"
}

mkdir -p "$(dirname "$LOG_FILE")"

# Debounce: udev can fire more than one event for a single physical
# insertion. flock on a fixed lock file makes a concurrent second run exit
# immediately instead of racing the first.
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
	log "Already running, exiting (duplicate udev trigger)"
	exit 0
fi

log "=== auto-rip triggered for $DRIVE ==="

# No "wait until ready" probe here on purpose: an earlier version ran
# `makemkvcon info disc:0` first to check readiness, but that's a full TOC
# scan in its own right (~50s+ on real media) - identical work to what `mkv`
# below does as its own first step. Doing it twice just doubled the wait for
# no benefit. udev only fires once ID_CDROM_MEDIA=1 (i.e. the kernel already
# confirmed the TOC is readable), so a few seconds of margin for drive
# spin-up is enough.
sleep 3

# The disc's own volume label is what the manual GUI workflow has always
# named the per-disc staging folder after (e.g. "THE_VICAR_OF_DIBLEY_XMAS_SPECIAL"),
# and it's what mediate's watcher expects as the top-level
# staging folder name. blkid reads it directly at the block-device level -
# near-instant, no MakeMKV scan needed just for this.
LABEL=$(blkid -o value -s LABEL "$DRIVE" 2>/dev/null)
if [ -z "$LABEL" ]; then
	log "Could not read a volume label from $DRIVE, aborting"
	exit 1
fi
log "Disc label: $LABEL"

# Computed up front (rather than just before the completion webhook, as in
# the pre-progress-reporting version of this script) since the progress
# reporter below needs them while the rip is still running.
SECRET=$(cat "$WEBHOOK_SECRET_FILE")
ESCAPED_FOLDER=$(printf '%s' "$LABEL" | sed 's/\\/\\\\/g; s/"/\\"/g')

# Real-world finding: unlike the GUI (which auto-creates a per-disc folder
# under its configured destination), `makemkvcon mkv ... <dest>` writes
# files straight into <dest> with no subfolder of its own - confirmed by a
# live test where files landed loose in the staging root. So the subfolder
# has to be created explicitly here, named after the disc label, matching
# the convention the app's watcher (parseStagingPath) requires.
DEST_HOST="$STAGING_DIR/$LABEL"
DEST_CONTAINER="/output/staging/$LABEL"
mkdir -p "$DEST_HOST"

# TOC-only scan (no saving) to find which titles are actually worth ripping,
# before committing to a rip. This duplicates the analysis pass `mkv` below
# does internally anyway (the same tradeoff the old "wait until ready" probe
# made, which got removed for doubling the wait with zero payoff) - but this
# time the payoff is real: a disc can have several long, legitimate titles
# beyond the main feature (e.g. Abduction (2011)'s scene-by-scene
# behind-the-scenes documentary, nearly as long as the film itself) that are
# worth keeping, alongside genuine junk (trailers, menu loops, ad clips) that
# MakeMKV's own ~2-minute minlength setting doesn't filter out. Length is a
# reasonable enough proxy for "worth keeping" - anything under 10 minutes is
# skipped, everything else gets ripped. mediate then sorts out
# which surviving file is the main feature vs. an extra once ripped (see
# promoteToJellyfin) - this script only decides what's worth ripping at all.
#
# TINFO:<title_id>,<attribute_id>,<code>,"<value>" - attribute 9 is Duration
# ("H:MM:SS") in MakeMKV's semi-documented robot protocol (not an official
# spec). If parsing doesn't confidently find anything, this falls back to
# ripping "all" rather than guessing or ripping nothing.
INFO_OUTPUT=$(docker exec "$CONTAINER" "$MAKEMKVCON" -r info disc:0 2>&1) || true
INCLUDE_IDS=""
while IFS= read -r line; do
	case "$line" in
		TINFO:*)
			rest="${line#TINFO:}"
			id="${rest%%,*}"
			rest="${rest#*,}"
			attr="${rest%%,*}"
			value="${rest##*,}"
			value="${value%\"}"
			value="${value#\"}"
			if [ "$attr" = "9" ]; then
				IFS=':' read -r h m s <<<"$value"
				if [ -n "${h:-}" ] && [ -n "${m:-}" ] && [ -n "${s:-}" ]; then
					# 10#$x forces decimal - a leading-zero value like "08"
					# would otherwise be parsed as an invalid octal digit
					# and error out.
					total=$((10#$h * 3600 + 10#$m * 60 + 10#$s))
					if [ "$total" -ge 600 ]; then
						INCLUDE_IDS="${INCLUDE_IDS:+$INCLUDE_IDS,}$id"
					fi
				fi
			fi
			;;
	esac
done <<<"$INFO_OUTPUT"

RIP_TARGET="all"
if [ -n "$INCLUDE_IDS" ]; then
	log "Titles >= 10 min: $INCLUDE_IDS (ripping only these, skipping anything shorter)"
	RIP_TARGET="$INCLUDE_IDS"
else
	log "Couldn't confidently parse title durations - falling back to ripping all titles"
fi

# -r = robot mode (machine-readable output, no interactive prompts).
#
# Real bug found the hard way: MakeMKV's `mkv` command only accepts ONE title
# id per invocation, or the literal "all" - confirmed via its own usage text
# ("saves a single title to mkv file"), captured in this log after a rip
# passed "0,2,5" as one argument. It ran its full (slow) disc analysis first
# regardless, THEN choked trying to interpret the comma-separated list as a
# single title selector, printed its own help text, and exited non-zero -
# having never actually ripped anything. So a comma-separated INCLUDE_IDS
# list becomes one `mkv` invocation *per title*, run sequentially (never in
# parallel - they'd be fighting over the same physical disc read). "all"
# stays a single invocation exactly as before, since it's already one keyword
# MakeMKV itself understands.
#
# Each invocation runs in the background (rather than blocking) so `wait` can
# capture its exit status per title. Output goes to a temp file instead of
# straight to $LOG_FILE, whose full contents get appended into $LOG_FILE once
# each title finishes, preserving today's everything-is-logged behavior.
# Wrapped in a generous outer timeout purely as a safety net against a truly-
# hung invocation, not as an expected normal duration - raised from 2h to 6h
# after a real 45-title Blu-ray rip (Abduction, 2011) was still legitimately
# progressing past the 2h mark and got killed by this timeout. Note that
# killing the `timeout`-wrapped docker exec client does NOT reliably kill the
# process it started inside the container (confirmed live: makemkvcon kept
# running and writing files for a long time after this fired) - so a
# too-short timeout here doesn't even stop the rip, it just orphans it from
# this script's ability to notice completion and call the webhook.
#
# `-t` allocates a pseudo-TTY for the exec session - confirmed necessary via
# a live rip on VIKI: without it, makemkvcon's stdio is fully block-buffered
# once it isn't attached to a real terminal, so the redirected output file
# saw zero new bytes for 80+ minutes despite the rip actively progressing the
# whole time. `isatty()` returning true via the pty is what keeps it flushing
# incrementally so the log still captures everything for troubleshooting.
#
# Progress reporting used to tail MakeMKV's own PRGV: lines for a live
# in-title percent - dropped after confirming live that they never reach the
# captured output during the actual save phase even with -t (the analysis
# phase streams fine, the save phase doesn't - some internal buffering `-t`
# doesn't reach). Reporting "title i+1 of N" at each loop boundary instead is
# strictly more reliable: it's driven by this script's own loop counters, not
# by anything MakeMKV chooses to print. Best-effort only, same as every other
# peripheral call in this script (e.g. the ownership fix below) - a failed or
# missed report must never abort the rip.
IFS=',' read -ra TITLE_LIST <<<"$RIP_TARGET"
TOTAL_TITLES=${#TITLE_LIST[@]}

RIP_STATUS=0
for i in "${!TITLE_LIST[@]}"; do
	TITLE_ID="${TITLE_LIST[$i]}"
	log "Ripping title $TITLE_ID ($((i + 1))/$TOTAL_TITLES) into $DEST_HOST..."

	curl -sf -X POST "$PROGRESS_WEBHOOK_URL" \
		-H "Authorization: Bearer $SECRET" \
		-H "Content-Type: application/json" \
		-d "{\"stagingFolderName\": \"$ESCAPED_FOLDER\", \"titlesCompleted\": $i, \"titlesTotal\": $TOTAL_TITLES}" \
		>>"$LOG_FILE" 2>&1 || true

	RIP_OUTPUT=$(mktemp)
	timeout 21600 docker exec -t "$CONTAINER" "$MAKEMKVCON" -r mkv disc:0 "$TITLE_ID" "$DEST_CONTAINER" >"$RIP_OUTPUT" 2>&1 &
	RIP_PID=$!

	TITLE_STATUS=0
	wait "$RIP_PID" || TITLE_STATUS=$?
	cat "$RIP_OUTPUT" >>"$LOG_FILE"
	rm -f "$RIP_OUTPUT"

	if [ "$TITLE_STATUS" -ne 0 ]; then
		RIP_STATUS=$TITLE_STATUS
		log "Title $TITLE_ID failed (status $TITLE_STATUS) - aborting remaining titles"
		break
	fi
done

if [ "$RIP_STATUS" -eq 0 ]; then
	curl -sf -X POST "$PROGRESS_WEBHOOK_URL" \
		-H "Authorization: Bearer $SECRET" \
		-H "Content-Type: application/json" \
		-d "{\"stagingFolderName\": \"$ESCAPED_FOLDER\", \"titlesCompleted\": $TOTAL_TITLES, \"titlesTotal\": $TOTAL_TITLES}" \
		>>"$LOG_FILE" 2>&1 || true
fi

if [ "$RIP_STATUS" -ne 0 ]; then
	log "makemkvcon exited non-zero (or timed out), aborting (no webhook call)"
	exit 1
fi

log "Rip finished: $LABEL"

# Non-fatal - a failed chown shouldn't stop the disc from being filed, it
# would just mean the same Samba permission issue resurfaces if this
# particular rip ever needs manual attention later. Skipped entirely when
# STAGING_OWNER isn't set (e.g. no shared-folder permission issue on your
# host to work around).
if [ -n "$STAGING_OWNER" ]; then
	chown -R "$STAGING_OWNER" "$DEST_HOST" 2>>"$LOG_FILE" \
		|| log "Could not fix ownership on $DEST_HOST (non-fatal)"
fi

# Captured (rather than piped straight to $LOG_FILE, as before) so the
# outcome/mediaType it returns can drive the Jellyfin library refresh below -
# still logged in full either way. WEBHOOK_STATUS is set via the `||`
# fallback (not a bare assignment) deliberately - under `set -e`, a plain
# `VAR=$(cmd)` whose cmd fails aborts the whole script right there (confirmed
# live), the same way a bare failing command would; this is the same guard
# pattern already used for `wait "$RIP_PID"` above.
WEBHOOK_STATUS=0
WEBHOOK_RESPONSE=$(curl -sf -X POST "$WEBHOOK_URL" \
	-H "Authorization: Bearer $SECRET" \
	-H "Content-Type: application/json" \
	-d "{\"stagingFolderName\": \"$ESCAPED_FOLDER\"}" 2>>"$LOG_FILE") || WEBHOOK_STATUS=$?
echo "$WEBHOOK_RESPONSE" >>"$LOG_FILE"

if [ "$WEBHOOK_STATUS" -eq 0 ]; then
	log "Webhook call succeeded"
else
	log "Webhook call failed - disc is ripped but not yet filed/notified, check manually"
fi

# Only refresh Jellyfin when the disc was actually filed ('promoted') - the
# other outcomes (needs_attention/needs_review) mean nothing new landed in
# Jellyfin's folders yet, so there's nothing for a scan to pick up. Looks the
# library up by CollectionType via /Library/VirtualFolders rather than
# hardcoding an id, so this keeps working if the user ever recreates/renames
# their Jellyfin libraries. Every step here is non-fatal - the rip itself has
# already fully succeeded by this point regardless of what happens next.
OUTCOME=$(echo "$WEBHOOK_RESPONSE" | jq -r '.outcome // empty')
MEDIA_TYPE=$(echo "$WEBHOOK_RESPONSE" | jq -r '.mediaType // empty')

if [ "$OUTCOME" = "promoted" ] && [ -n "$MEDIA_TYPE" ]; then
	COLLECTION_TYPE="movies"
	[ "$MEDIA_TYPE" = "tv" ] && COLLECTION_TYPE="tvshows"

	JELLYFIN_API_KEY=$(cat "$JELLYFIN_API_KEY_FILE" 2>/dev/null) || true
	if [ -n "$JELLYFIN_API_KEY" ]; then
		# `|| true` guards against two things under `set -euo pipefail`: a
		# failed curl (e.g. bad/missing API key) would otherwise abort the
		# whole script right here rather than falling through to the "could
		# not find library id" log line below (confirmed live - a bare
		# `VAR=$(cmd)` assignment is NOT exempt from `set -e` the way an
		# `if cmd; then` is); and `| head -1` closing the pipe early can make
		# pipefail report the upstream curl/jq as "failed" via SIGPIPE even
		# when they produced the right output first.
		LIBRARY_ID=$(curl -sf "$JELLYFIN_URL/Library/VirtualFolders" \
			-H "X-Emby-Token: $JELLYFIN_API_KEY" 2>>"$LOG_FILE" \
			| jq -r --arg t "$COLLECTION_TYPE" '.[] | select(.CollectionType == $t) | .ItemId' \
			| head -1) || true

		if [ -n "$LIBRARY_ID" ]; then
			curl -sf -X POST \
				"$JELLYFIN_URL/Items/$LIBRARY_ID/Refresh?Recursive=true&ImageRefreshMode=Default&MetadataRefreshMode=Default" \
				-H "X-Emby-Token: $JELLYFIN_API_KEY" \
				>>"$LOG_FILE" 2>&1 \
				&& log "Triggered Jellyfin $COLLECTION_TYPE library refresh" \
				|| log "Jellyfin library refresh failed (non-fatal)"
		else
			log "Could not find Jellyfin $COLLECTION_TYPE library id (non-fatal, skipping refresh)"
		fi
	else
		log "No Jellyfin API key at $JELLYFIN_API_KEY_FILE - skipping library refresh"
	fi
fi

# No auto-eject. The optical drive and /mnt/storage are both USB-attached on
# this host, and ejecting destabilizes something shared between them badly
# enough that every other container relying on /mnt/storage stops
# responding - a delayed auto-close (`eject -t`) was tried as a mitigation
# but the instability during that window was still an unacceptable tradeoff.
# The disc is left in the drive; eject it manually when ready.
log "Disc ripped and filed - eject manually when ready"

log "=== auto-rip complete ==="
