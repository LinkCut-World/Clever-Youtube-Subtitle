# v1.9.5

## Downloads

- **Chrome ZIP:** unzip it and use **Load unpacked** in Chrome.
- **Kiwi ZIP:** import it from Kiwi's **Extensions** page on Android.
- **SHA256SUMS.txt:** file hashes for both installation ZIPs.

The word model is included. Installation packages do not include personal
vocabulary or login details.

## Changes

- Restore the full YouTube caption background when known words are hidden.
- Keep the background visible while word matching is loading.
- Preserve YouTube's background color, transparency, and rounded corners.
- Keep native text hidden by default to prevent a full-text flash.
- The background layer does not intercept word or player clicks.

This version uses the original MorphoDiTa English model in local WASM, introduced
in v1.9.0. No Python service is needed.

Project code is MIT; the MorphoDiTa engine is MPL 2.0 and the English model is
CC BY-NC-SA 3.0 Unported. The full notices are included in both packages.
