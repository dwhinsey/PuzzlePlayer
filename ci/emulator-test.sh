#!/usr/bin/env bash
# Runs inside reactivecircus/android-emulator-runner once the emulator is up.
# Installs the APK, checks the app starts without crashing, then drives it
# through the WebView's DevTools connection (see emulator-test.js).
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
  grep -a -E "AndroidRuntime|FATAL|$PKG|chromium|Console|PuzzlePlayer" "$OUT/logcat.txt" | tail -150
}

forward_devtools() {
  local sock
  sock=$(adb shell cat /proc/net/unix | grep -a -o "webview_devtools_remote_[0-9]*" | head -1)
  echo "DevTools socket: $sock"
  [ -n "$sock" ] || return 1
  adb forward --remove-all
  adb forward tcp:9222 "localabstract:$sock"
}

launch
adb exec-out screencap -p > "$OUT/launch.png"
if ! check_alive || [ -s <(adb logcat -d -b crash) ]; then
  dump_logs
  exit 1
fi

forward_devtools || { dump_logs; exit 1; }
node ci/emulator-test.js phase1 || { dump_logs; exit 1; }

# Kill the app outright, as Android does to apps in the background, and
# check the progress survives.
adb shell am force-stop "$PKG"
sleep 2
launch
check_alive || { dump_logs; exit 1; }
forward_devtools || { dump_logs; exit 1; }
node ci/emulator-test.js phase2 || { dump_logs; exit 1; }

adb exec-out screencap -p > "$OUT/final.png"
dump_logs
echo "EMULATOR TEST PASSED"
