# v1.9.6

## Downloads

- **Chrome ZIP:** unzip it and use **Load unpacked** in Chrome.
- **Kiwi ZIP:** import it from Kiwi's **Extensions** page on Android.
- **SHA256SUMS.txt:** file hashes for both installation ZIPs.

The word model is included. Installation packages do not include personal
vocabulary or login details.

## Changes

- Hovering over a hidden word on a computer shows all hidden words faintly,
  including words in the Previous caption panel. Hovering does not affect playback.
- Clicking a word on a computer pauses the video and keeps its word button
  visible after the mouse leaves. Clicking a hidden word also keeps all hidden
  words faintly visible until playback resumes.
- On a phone, the first tap on a hidden word pauses the video and reveals all
  hidden words at 35% opacity, without showing a word button. Tap a visible or
  faint word to show its + / − button, then tap the button to change My Vocabulary.
- A held reveal stays visible while choosing other words or saving vocabulary.
  Playing the video again clears held word buttons and hides the revealed words.
- Previous caption keeps its existing pause, close, and drag behavior. Opening
  it does not start a reveal.
- Prevent duplicate touch events and touch-generated hover events from treating
  one tap as both a reveal and a word selection.

This version uses the original MorphoDiTa English model in local WASM, introduced
in v1.9.0. No Python service is needed.

Project code is MIT; the MorphoDiTa engine is MPL 2.0 and the English model is
CC BY-NC-SA 3.0 Unported. The full notices are included in both packages.
