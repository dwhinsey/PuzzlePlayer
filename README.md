# puzPlayer

A simple Android app for solving crosswords from local **.puz**, **.ipuz** and **.jpz**
files.

<p>
  <img src="docs/screenshots/library-light.jpg" width="24%" alt="Home page, light mode">
  <img src="docs/screenshots/solver-light.jpg" width="24%" alt="Solving a puzzle, light mode">
  <img src="docs/screenshots/library-dark.jpg" width="24%" alt="Home page, dark mode">
  <img src="docs/screenshots/solver-dark.jpg" width="24%" alt="Solving a puzzle, dark mode">
</p>

## How it's built

The app is a small native Android shell (plain Java, no libraries) around a
WebView. The library and solver are HTML/CSS/JS in
`app/src/main/assets/www/`.

## Building

- **GitHub Actions:** every push builds a debug APK. Open the run under the
  repository's *Actions* tab and download the `puzPlayer-debug-apk` artifact.

To install the APK on a phone, download it and open it; Android will ask you
to allow installs from that source the first time.

Requires Android 8.0 or newer.

## License

MIT License

Copyright (c) 2026 dwhinsey

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The bundled Public Sans font (`app/src/main/assets/www/fonts/`) is under the
SIL Open Font License; see `OFL.txt` in that folder.
