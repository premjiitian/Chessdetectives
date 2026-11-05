#!/usr/bin/env bash
# Runs the iOS app on a simulator, lets its built-in self-test drive the app
# (src/lib/selftest.ts), takes a screenshot whenever the app asks for one,
# and fails if any check fails.
#   scripts/ios-sim-test.sh "<device name regex>" <app path> <output dir>
set -uo pipefail
DEVICE_RE="$1"; APP="$2"; OUT="$3"
BUNDLE=com.chessdetectives.app
mkdir -p "$OUT"

UDID=$(xcrun simctl list devices available -j | python3 -c "
import json, re, sys
d = json.load(sys.stdin)['devices']
best = None
for rt, devs in d.items():
    if 'iOS' not in rt: continue
    for x in devs:
        if re.search(r'''$DEVICE_RE''', x['name']):
            best = (rt, x['udid'], x['name'])
print(best[1] if best else '')
")
if [ -z "$UDID" ]; then echo "No simulator matching $DEVICE_RE"; xcrun simctl list devices available; exit 1; fi
NAME=$(xcrun simctl list devices | grep "$UDID" | sed 's/ (.*//' | xargs)
echo "== $NAME ($UDID)"
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP"
# Where the installed app's web files live: the screenshot handshake file goes there.
APPDIR=$(xcrun simctl get_app_container "$UDID" "$BUNDLE" app)
ACK="$APPDIR/public/shot-ack.txt"
: > "$ACK"
# The first screenshot after boot takes ~30 s; take a throw-away one now so
# the real ones happen while the app still shows the screen it asked for.
xcrun simctl io "$UDID" screenshot "$OUT/.warmup.png" >/dev/null 2>&1; rm -f "$OUT/.warmup.png"

LOG="$OUT/console.log"
: > "$LOG"
# --console-pty: the app's output (Capacitor prints the web console) goes to the log.
xcrun simctl launch --console-pty --terminate-running-process "$UDID" "$BUNDLE" > "$LOG" 2>&1 &
LAUNCH_PID=$!

seen=0
deadline=$((SECONDS + 900))
result=""
while [ $SECONDS -lt $deadline ]; do
  sleep 1
  total=$(wc -l < "$LOG" | tr -d ' ')
  if [ "$total" -gt "$seen" ]; then
    sed -n "$((seen + 1)),${total}p" "$LOG" | while IFS= read -r line; do
      case "$line" in
        *CD-CHECK*) echo "${line#*CD-CHECK }" ;;
        *CD-SHOT*)
          shot=$(echo "${line#*CD-SHOT }" | tr -cd 'a-z0-9-')
          # Take it, then tell the app (it waits for this before moving on).
          if xcrun simctl io "$UDID" screenshot "$OUT/$shot.png" >/dev/null 2>&1; then echo "  📸 $shot"; else echo "  ⚠️ screenshot $shot failed"; fi
          echo "$shot" >> "$ACK" ;;
        *CD-SELFTEST*) echo "$line" ;;
      esac
    done
    seen=$total
  fi
  result=$(grep -o 'CD-SELFTEST [A-Z]* [0-9/]*' "$LOG" | tail -1)
  [ -n "$result" ] && break
done
# Print any check lines that arrived together with the final result.
total=$(wc -l < "$LOG" | tr -d ' ')
[ "$total" -gt "$seen" ] && sed -n "$((seen + 1)),${total}p" "$LOG" | grep -o 'CD-CHECK.*' | sed 's/^CD-CHECK //'
kill "$LAUNCH_PID" 2>/dev/null || true
xcrun simctl shutdown "$UDID" 2>/dev/null || true

if [ -z "$result" ]; then
  echo "❌ $NAME: the self-test did not finish. Last app output:"
  tail -40 "$LOG"
  exit 1
fi
echo "$NAME: $result"
case "$result" in *PASS*) exit 0 ;; *) exit 1 ;; esac
