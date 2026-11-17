# puzPlayer

A modern-looking, snappy-feeling Android app for solving crosswords from local **.puz**, **.ipuz** and **.jpz**
files.

## How it's built

The app is a small native Android shell (plain Java, no libraries) around a
WebView. The library and solver are HTML/CSS/JS in
`app/src/main/assets/www/`:

## Building

- **GitHub Actions:** every push builds a debug APK. Open the run under the
  repository's *Actions* tab and download the `puzPlayer-debug-apk` artifact.
  The same run installs it on Android 15 and 16 emulators, checks that it
  starts, and runs a short import / solve / force-close / reopen test
  (`ci/`); screenshots from it are in the `emulator-output-*` artifacts.
- **Android Studio:** open the project folder and press Run.
- **Command line:** with the Android SDK installed (`ANDROID_HOME` set),
  run `./gradlew assembleDebug`. The APK is written to
  `app/build/outputs/apk/debug/app-debug.apk`.

To install the APK on a phone, copy it over and open it; Android will ask you
to allow installs from that source the first time.

Requires Android 8.0 or newer.
