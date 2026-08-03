#!/usr/bin/env bash
# Triggered by udev (see 99-makemkv-autorip.rules) when a disc is inserted
# into /dev/sr0. Rips with the MakeMKV CLI (no GUI dialogs) - ripping only
# the longest title if the app says a movie is armed (see /api/armed),
# otherwise every title (TV, or nothing armed) - reports live progress to
# media-library-shelf while ripping, then tells it the rip is done via
# /api/rip-complete.
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
ARMED_URL="https://media-library-shelf.viki/api/armed"
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

# Ask the app what it's expecting next (set via "Start ripping" in the UI
# before the disc was inserted - see /api/arm). A movie gets narrowed down to
# just its single longest title below - unlike the app's own post-rip
# cleanup (promoteToJellyfin, which only deletes already-ripped extras after
# the fact), this actually saves the rip time itself. TV keeps ripping every
# title (a season needs every episode), and so does an unarmed/unknown disc
# or a failed lookup - both fall back to today's unchanged "all" behavior.
MEDIA_TYPE=$(curl -sf --max-time 10 -H "Authorization: Bearer $SECRET" "$ARMED_URL" 2>>"$LOG_FILE" \
	| sed -n 's/.*"mediaType":"\?\([a-z]*\)"\?.*/\1/p') || true
log "Armed media type: ${MEDIA_TYPE:-unknown}"

RIP_TARGET="all"
if [ "$MEDIA_TYPE" = "movie" ]; then
	# TOC-only scan (no saving) to compare title sizes before committing to a
	# rip. This duplicates the analysis pass `mkv` below does internally
	# anyway (the same tradeoff the old "wait until ready" probe made, which
	# got removed for doubling the wait with zero payoff) - but this time the
	# payoff is real: skipping every non-main title on a disc that pads
	# itself with several full-length duplicate/decoy titles (confirmed live:
	# Abduction (2011)'s first 3 titles were near-identical ~20GB copies of
	# each other) saves hours, not seconds.
	#
	# TINFO:<title_id>,<attribute_id>,<code>,"<value>" - attribute 11 is
	# "Disk Size (Bytes)" in MakeMKV's semi-documented robot protocol (not an
	# official spec). If parsing doesn't confidently find a title, this falls
	# back to ripping "all" rather than guessing.
	INFO_OUTPUT=$(docker exec "$CONTAINER" "$MAKEMKVCON" -r info disc:0 2>&1) || true
	LONGEST_ID=""
	LONGEST_SIZE=0
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
				if [ "$attr" = "11" ] && [ "$value" -eq "$value" ] 2>/dev/null; then
					if [ "$value" -gt "$LONGEST_SIZE" ]; then
						LONGEST_SIZE=$value
						LONGEST_ID=$id
					fi
				fi
				;;
		esac
	done <<<"$INFO_OUTPUT"

	if [ -n "$LONGEST_ID" ]; then
		log "Movie detected - ripping only title #$LONGEST_ID ($LONGEST_SIZE bytes), skipping the rest"
		RIP_TARGET="$LONGEST_ID"
	else
		log "Movie detected but couldn't confidently parse title sizes - falling back to ripping all titles"
	fi
fi

# -r = robot mode (machine-readable output, no interactive prompts).
# "all" (the fallback/TV case) rips every title MakeMKV's own minlength
# setting would already have pre-checked in the GUI - this mirrors current
# manual behavior, not a new heuristic, since it reads the same
# settings.conf the GUI does. A movie with a confidently-detected longest
# title rips just that one instead (see above).
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
