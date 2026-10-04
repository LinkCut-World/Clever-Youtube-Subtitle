# v1.9.4

## Downloads

- **Chrome ZIP:** unzip it and use **Load unpacked** in Chrome.
- **Kiwi ZIP:** import it from Kiwi's **Extensions** page on Android.
- **SHA256SUMS.txt:** file hashes for both installation ZIPs.

The word model is included. Installation packages do not include personal
vocabulary or login details.

## Changes

- Native caption text is hidden by default; only the extension's processed output can appear.
- Hide captions until both the saved vocabulary and word matching are ready.
- Keep reused YouTube nodes hidden when native text replaces processed output.
- Register the caption styles at document start.
- Previous caption keeps the last two lines that left the screen, with line breaks preserved.
- Ready words and their buttons still stay available as automatic captions grow.

This version uses the original MorphoDiTa English model in local WASM, introduced
in v1.9.0. No Python service is needed.

Project code is MIT; the MorphoDiTa engine is MPL 2.0 and the English model is
CC BY-NC-SA 3.0 Unported. The full notices are included in both packages.
