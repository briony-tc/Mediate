#!/usr/bin/env bash
# Triggered by udev (see 99-makemkv-autorip.rules) when a disc is inserted
# into /dev/sr0. Rips with the MakeMKV CLI (no GUI dialogs), skipping any
# title under 10 minutes (trailers, menu loops, ad clips) and ripping
# everything else - reports live progress to media-library-shelf while
# ripping, then tells it the rip is done via /api/rip-complete.
#
# Deploying a change to this file: this repo copy is the source of truth -
# copy it onto VIKI (replacing the currently-deployed script) after editing.
# Editing this file alone has no effect on the live system.
set -euo pipefail

LOCK_FILE="/opt/data/scripts/.auto-rip.lock"
LOG_FILE="/opt/data/scripts/autorip.log"
STAGING_DIR="/mnt/storage/media/staging"
WEBHOOK_URL="https://media-library-shelf.viki/api/rip-complete"
PROGRESS_WEBHOOK_URL="https://media-library-shelf.viki/api/rip-progress"
WEBHOOK_SECRET_FILE="/opt/data/scripts/rip-webhook-secret"
DRIVE="/dev/sr0"
CONTAINER="makemkv"
# /opt/makemkv/bin isn't on the container's $PATH for `docker exec` sessions
# (confirmed: exec fails with "executable file not found in $PATH" otherwise) -
# must use the full path.
MAKEMKVCON="/opt/makemkv/bin/makemkvcon"

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
# and it's what media-library-shelf's watcher expects as the top-level
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
# skipped, everything else gets ripped. media-library-shelf then sorts out
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
# "all" (the fallback case above) rips every title MakeMKV's own minlength
# setting would already have pre-checked in the GUI - this mirrors current
# manual behavior, not a new heuristic, since it reads the same
# settings.conf the GUI does. A comma-separated title list (the normal case
# above) rips just those instead.
#
# Run in the background (rather than blocking, as before) so the progress
# reporter below can tail its robot-mode output while it runs. Output goes to
# a temp file instead of straight to $LOG_FILE so it can be parsed for
# PRGV: lines as they arrive; the temp file's full contents still get
# appended into $LOG_FILE once the rip finishes, preserving today's
# everything-is-logged behavior. Wrapped in a generous outer timeout purely
# as a safety net against a truly-hung invocation, not as an expected normal
# duration - raised from 2h to 6h after a real 45-title Blu-ray rip
# (Abduction, 2011) was still legitimately progressing past the 2h mark and
# got killed by this timeout. Note that killing the `timeout`-wrapped docker
# exec client does NOT reliably kill the process it started inside the
# container (confirmed live: makemkvcon kept running and writing files for
# a long time after this fired) - so a too-short timeout here doesn't even
# stop the rip, it just orphans it from this script's ability to notice
# completion and call the webhook.
#
# `-t` allocates a pseudo-TTY for the exec session - confirmed necessary via
# a live rip on VIKI: without it, makemkvcon's stdio is fully block-buffered
# once it isn't attached to a real terminal, so the redirected output file
# saw zero new bytes for 80+ minutes despite the rip actively progressing the
# whole time. `isatty()` returning true via the pty is what keeps it flushing
# incrementally so the tail below actually has something to read.
RIP_OUTPUT=$(mktemp)
log "Starting rip into $DEST_HOST..."
timeout 21600 docker exec -t "$CONTAINER" "$MAKEMKVCON" -r mkv disc:0 "$RIP_TARGET" "$DEST_CONTAINER" >"$RIP_OUTPUT" 2>&1 &
RIP_PID=$!

# MakeMKV's robot-mode PRGV:current,total,max lines give overall job progress
# via total/max (this is what the GUI's own progress bar is driven by) - no
# explicit "time remaining" field exists, media-library-shelf estimates that
# itself from percent + elapsed time. Reports at most once per percentage
# point, roughly every 30s, to media-library-shelf's /api/rip-progress so the
# UI can show a live estimate. Best-effort only: a failed or missed report
# here must never abort the rip - mirrors this script's existing philosophy
# of treating peripheral failures (e.g. eject) as non-fatal.
report_progress() {
	local last_sent=-1
	while kill -0 "$RIP_PID" 2>/dev/null; do
		sleep 30
		local line
		line=$(grep -a '^PRGV:' "$RIP_OUTPUT" | tail -1)
		[ -z "$line" ] && continue
		local total max percent
		IFS=',' read -r _ total max <<<"${line#PRGV:}"
		[ -z "${max:-}" ] || [ "$max" -eq 0 ] && continue
		percent=$((total * 100 / max))
		[ "$percent" -eq "$last_sent" ] && continue
		last_sent=$percent
		curl -sf -X POST "$PROGRESS_WEBHOOK_URL" \
			-H "Authorization: Bearer $SECRET" \
			-H "Content-Type: application/json" \
			-d "{\"stagingFolderName\": \"$ESCAPED_FOLDER\", \"percent\": $percent}" \
			>>"$LOG_FILE" 2>&1 || true
	done
}
report_progress &
REPORT_PID=$!

RIP_STATUS=0
wait "$RIP_PID" || RIP_STATUS=$?
kill "$REPORT_PID" 2>/dev/null || true
wait "$REPORT_PID" 2>/dev/null || true
cat "$RIP_OUTPUT" >>"$LOG_FILE"
rm -f "$RIP_OUTPUT"

if [ "$RIP_STATUS" -ne 0 ]; then
	log "makemkvcon exited non-zero (or timed out), aborting (no webhook call)"
	exit 1
fi

log "Rip finished: $LABEL"

if curl -sf -X POST "$WEBHOOK_URL" \
	-H "Authorization: Bearer $SECRET" \
	-H "Content-Type: application/json" \
	-d "{\"stagingFolderName\": \"$ESCAPED_FOLDER\"}" \
	>>"$LOG_FILE" 2>&1; then
	log "Webhook call succeeded"
else
	log "Webhook call failed - disc is ripped but not yet filed/notified, check manually"
fi

eject "$DRIVE" 2>>"$LOG_FILE" || log "Eject failed (non-fatal)"

log "=== auto-rip complete ==="
