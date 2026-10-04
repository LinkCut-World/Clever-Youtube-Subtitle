# v1.9.3

## Downloads

- **Chrome ZIP:** unzip it and use **Load unpacked** in Chrome.
- **Kiwi ZIP:** import it from Kiwi's **Extensions** page on Android.
- **SHA256SUMS.txt:** file hashes for both installation ZIPs.

The word model is included. Installation packages do not include personal
vocabulary or login details.

## Changes

- New captions stay invisible while word matching is loading, keeping their space.
- Captions that add words one by one keep ready words visible while new words wait.
- Rolling a line up keeps its word matches and the selected word's button.
- Previous caption records the last full line that left the screen.
- Later context can update earlier matches using the original MorphoDiTa model.
- Analysis requests share one active job and one latest waiting snapshot per caption stream.
- Failed analysis falls back to exact-word matching.

This version uses the original MorphoDiTa English model in local WASM, introduced
in v1.9.0. No Python service is needed.

Project code is MIT; the MorphoDiTa engine is MPL 2.0 and the English model is
CC BY-NC-SA 3.0 Unported. The full notices are included in both packages.
