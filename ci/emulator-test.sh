#!/usr/bin/env bash
# Runs inside reactivecircus/android-emulator-runner once the emulator is up.
# Installs the APK, checks the app starts without crashing, then drives it
# through its WebView with Playwright's Android support (see emulator-test.js).
set -u
PKG=com.puzplayer.app
APK=${APK:-apk/app-debug.apk}
OUT=emulator-output
mkdir -p "$OUT"

adb install -r "$APK" || exit 1
adb logcat -c

launch() {
  adb shell am start -W -n "$PKG/.MainActivity"
  sleep 8
}

check_alive() {
  if adb shell pidof "$PKG" > /dev/null; then
    echo "APP RUNNING (pid $(adb shell pidof $PKG))"
    return 0
  fi
  echo "APP NOT RUNNING"
  return 1
}

dump_logs() {
  adb logcat -d > "$OUT/logcat.txt"
  adb logcat -d -b crash > "$OUT/crash.txt"
  echo "===== crash buffer ====="
  cat "$OUT/crash.txt"
  echo "===== app / WebView log ====="
  grep -a -E "AndroidRuntime|FATAL|$PKG|chromium|Console|puzPlayer" "$OUT/logcat.txt" | grep -a -v -E "AppsFilter|dns_config|ShortcutService" | tail -80
}

app_crashed() {
  # The crash buffer holds every app's crashes; only ours count.
  adb logcat -d -b crash | grep -a -q "Process: $PKG"
}

launch
adb exec-out screencap -p > "$OUT/launch.png"
if ! check_alive || app_crashed; then
  echo "STEP FAILED: launch"
  dump_logs
  exit 1
fi
echo "STEP OK: launch"

node ci/emulator-test.js phase1 || { echo "STEP FAILED: phase1"; dump_logs; exit 1; }

# Kill the app outright, as Android does to apps in the background, and
# check the progress survives.
adb shell am force-stop "$PKG"
sleep 2
launch
check_alive || { echo "STEP FAILED: relaunch"; dump_logs; exit 1; }
node ci/emulator-test.js phase2 || { echo "STEP FAILED: phase2"; dump_logs; exit 1; }
if app_crashed; then echo "STEP FAILED: crash during test"; dump_logs; exit 1; fi

# ----- "Open with puzPlayer" -----

echo "Apps offered for a generic attachment:"
adb shell cmd package query-activities --brief -a android.intent.action.VIEW \
  -d content://com.example.mail/attachment/1 -t application/octet-stream | tee "$OUT/open-with.txt"
grep -q "$PKG" "$OUT/open-with.txt" || { echo "STEP FAILED: not offered for application/octet-stream"; exit 1; }
# Downloads opened by their media-library address (no file name), with the
# type the website gave them: .jpz as zip or XML, .ipuz as JSON.
for t in application/zip application/x-zip-compressed application/xml text/xml application/json \
    binary/octet-stream application/unknown application/force-download; do
  adb shell cmd package query-activities --brief -a android.intent.action.VIEW \
    -d content://media/external/file/1234 -t "$t" | grep -q "$PKG" \
    || { echo "STEP FAILED: not offered for $t"; exit 1; }
done
# Apps that ask by type alone, with no address (Samsung's My Files).
for t in application/octet-stream binary/octet-stream; do
  adb shell cmd package query-activities --brief -a android.intent.action.VIEW -t "$t" | grep -q "$PKG" \
    || { echo "STEP FAILED: not offered for type-only $t"; exit 1; }
done
# A file manager that sends no type at all: matched by the name.
for f in puzzle.jpz puzzle.puz puzzle.ipuz; do
  adb shell cmd package query-activities --brief -a android.intent.action.VIEW \
    -d "content://com.example.files/root/Download/$f" | grep -q "$PKG" \
    || { echo "STEP FAILED: not offered for untyped $f"; exit 1; }
done
# For the record: the type Android's media library gives each extension.
for f in tiny.ipuz jolly.jpz big-sample.puz; do adb push "ci/fixtures/$f" "/sdcard/Download/$f" >/dev/null; done
adb shell content call --uri content://media --method scan_volume --arg external_primary >/dev/null 2>&1 || true
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/jolly.jpz >/dev/null 2>&1 || true
sleep 3
adb shell content query --uri content://media/external/file --projection _display_name:mime_type \
  --where "_display_name LIKE '%puz' OR _display_name LIKE '%jpz'" | tee -a "$OUT/open-with.txt" || true
echo "Apps offered for a .puz file by name:"
adb shell cmd package query-activities --brief -a android.intent.action.VIEW \
  -d content://com.example.files/root/Download/puzzle.puz -t text/plain | tee -a "$OUT/open-with.txt"
adb shell cmd package query-activities --brief -a android.intent.action.VIEW \
  -d content://com.example.files/root/Download/puzzle.puz -t text/plain | grep -q "$PKG" \
  || { echo "STEP FAILED: not offered for a .puz file by name"; exit 1; }
echo "STEP OK: offered in Open with"

send_file() {
  # $1 = fixture name. Sent as an email app would: a VIEW intent for a
  # generic binary, limited to this app so no chooser appears.
  adb push "ci/fixtures/$1" "/data/local/tmp/$1" > /dev/null
  adb shell chmod 644 "/data/local/tmp/$1"
  adb shell am start -W -a android.intent.action.VIEW -p "$PKG" \
    -d "file:///data/local/tmp/$1" -t application/octet-stream
  sleep 6
}

# While the app is running (it is still open from phase 2).
send_file jolly.jpz
check_alive || { echo "STEP FAILED: open-with (running)"; dump_logs; exit 1; }
node ci/emulator-test.js open-with "Jolly JPZ" || { echo "STEP FAILED: open-with (running)"; dump_logs; exit 1; }

# From cold: the file arrives before the page has loaded.
adb shell am force-stop "$PKG"
sleep 2
send_file tiny.ipuz
check_alive || { echo "STEP FAILED: open-with (cold start)"; dump_logs; exit 1; }
node ci/emulator-test.js open-with "Tiny iPuz" || { echo "STEP FAILED: open-with (cold start)"; dump_logs; exit 1; }
if app_crashed; then echo "STEP FAILED: crash during open-with"; dump_logs; exit 1; fi
echo "STEP OK: open-with"

adb exec-out screencap -p > "$OUT/final.png"

# ----- Diagnostic: grid line widths at a 2.625 pixel ratio (a Galaxy S24
# Ultra at its default resolution). Reports only; never fails the run.
adb shell wm density 420
adb shell am force-stop "$PKG"
launch
if node ci/emulator-test.js gridlines; then
  adb exec-out screencap -p > "$OUT/gridlines.png"
  python3 -m pip install --quiet pillow >/dev/null 2>&1 || true
  python3 ci/gridline-check.py "$OUT" || true
fi
adb shell wm density reset
dump_logs
echo "EMULATOR TEST PASSED"
