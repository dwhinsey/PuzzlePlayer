#!/usr/bin/env bash
# Runs inside reactivecircus/android-emulator-runner once the emulator is up.
# Installs the APK, checks the app starts without crashing, then drives it
# through its WebView with Playwright's Android support (see emulator-test.js).
set -u
PKG=com.hinseypuzzles.puzzleplayer
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
  grep -a -E "AndroidRuntime|FATAL|$PKG|chromium|Console|PuzzlePlayer" "$OUT/logcat.txt" | grep -a -v -E "AppsFilter|dns_config|ShortcutService" | tail -80
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

adb exec-out screencap -p > "$OUT/final.png"
dump_logs
echo "EMULATOR TEST PASSED"
