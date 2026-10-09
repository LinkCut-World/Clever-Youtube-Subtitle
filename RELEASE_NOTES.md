# v1.10.0

## Downloads

- **Chrome ZIP:** unzip it and use **Load unpacked** in Chrome.
- **Kiwi ZIP:** import it from Kiwi's **Extensions** page on Android.
- **SHA256SUMS.txt:** file hashes for both installation ZIPs.

Optional dictionaries download directly from WikDict's official server.
They do not require extra attachments in this project's release.

The English word model is included. **No word-meaning dictionary is included
in either installation ZIP.** Packages contain no personal vocabulary or keys.

## Dictionary

- **Settings** contains two sections: **My Vocabulary** and **Dictionary**.
  **Sync between devices** is under **My Vocabulary** because it syncs that word
  list. Direct navigation links jump to either main section.

- Click a word on a computer, or tap a visible or faint word on a phone, to see
  its base form and up to three meanings. This also works in Previous caption.
- **Microsoft Translator (online)** uses the official international Dictionary
  Lookup API and your own Azure key. Choose one of 49 target languages. Results
  are sorted and deduplicated. No sentence or examples are requested.
- **Save and check** shows a real word lookup before saving. A failed check keeps
  the last working settings. The key stays on this device and is not part of
  vocabulary sync or TXT export.
- The Azure guide starts by changing the portal language to **English**, so the
  menu and button names match the instructions.
- **WikDict (offline)** is a second option. Manage all 25 available English-to-target
  dictionaries: download, import, update, select, or delete languages. Search by
  English name, native name, or language code, ignoring accents and case.
  Official SQLite files are downloaded directly from WikDict and checked before
  saving. A separate thread reads them on the device and releases the reader
  afterward. Get file and Import file use the same official files.
  Installed data survives browser restarts and extension updates.

## Word selection

- On a computer, clicking A selects its word button and meaning card. Hovering
  B temporarily shows B's button while A's card stays open. Leaving B restores
  A's button.
- Hovering a hidden word reveals all hidden words at 35% opacity, including
  those in Previous caption. Clicking a fully visible word clears an earlier
  held reveal. Hover alone does not change playback.
- On a phone, the first tap on a hidden word pauses and reveals all hidden words
  faintly, without a button or meaning card. Tap a visible or faint word to select
  it. Selecting a fully visible word hides the previously revealed words again.
- Saving through + / − keeps the selected word and meaning card. Hovering or
  changing another word does not replace the clicked word's card.
- Playback, seeking, changing videos, and turning off CC clear the selection.
  Previous caption retains its open, close, pause, and drag behavior.

## Setup and license

Caption filtering still runs locally with the original MorphoDiTa model.
No Python service is required. Online word meanings are optional.

Project code is MIT. MorphoDiTa is MPL 2.0, and its English model is
CC BY-NC-SA 3.0 Unported. Optional WikDict data is CC BY-SA 4.0. Full notices are
included. The manager provides attribution and source details for downloaded
data. The bundled SQLite reader uses sql.js (MIT) and SQLite (public domain).
