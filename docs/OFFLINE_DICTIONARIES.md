# Offline dictionaries

WikDict is the optional offline source for word meanings. The extension starts
with **zero installed dictionaries**. The English word model used for caption
filtering is included and is separate from these meaning dictionaries.

## Download and use a language

1. Open **Settings → Dictionary**.
2. Set **Source** to **WikDict (offline)** and open **Manage dictionaries**.
3. Select **Download** for the languages you want. Allow download access if asked.
4. Keep the manager page open until it says the dictionary is ready.
5. Select **Use** beside the installed language. You can also choose that
   language under **Translate to** in Dictionary, then select **Save**.

Once a dictionary is installed, lookup works without a connection or API key.
The manager shows the download size, data size, word count, and installed
version. Installed dictionaries stay on the device across browser restarts and
extension updates. You need to install your chosen dictionaries on each device.

Use **Search languages** to find a language by its English name, native name,
or code. For example, `Russian`, `Русский`, and `ru` find Russian; `francais`
also finds `Français`. Search does not change your installed dictionaries.

## Import a file or move it to a phone

Download goes directly to WikDict's official server. The extension reads the
SQLite file on this device and saves the entries in its local database.
It does not require dictionary files from this project's GitHub release.

If Download does not work, select **Get file** beside the language. This opens
the official `.sqlite3` download on `download.wikdict.com`. Save the file, then
choose it under **Import a dictionary file** and select **Import file**.

You can send that same file to a phone and import it in the phone's dictionary
manager. No login or API key is needed for importing. Use files from this
official WikDict downloads; the manager checks their size, hash, and format.

## Update or delete

- **Update** appears when your extension's dictionary catalog lists a different
  file from the installed one. New catalog entries are provided with extension
  updates; the manager does not run a background update timer.
- **Download again** installs the current listed file again.
- A failed or damaged download leaves the old dictionary available. The old
  version is replaced only after the whole new file is checked and saved.
- **Delete** removes the chosen language and frees its dictionary storage.
  Your vocabulary, Git settings, and Microsoft key are kept. If you delete
  your selected language, download it again or select another word-meaning source.
- Uninstalling the extension removes its local dictionaries and settings.

## Available languages and data

The catalog includes all **25 English-to-target dictionaries** available in
WikDict's current SQLite snapshot (`2_2026-06`): Bulgarian, Catalan, Chinese,
Czech, Danish, Dutch, Finnish, French, German, Greek, Indonesian, Irish, Italian,
Japanese, Kurdish, Latin, Lithuanian, Malagasy, Norwegian, Polish, Portuguese,
Russian, Spanish, Swedish, and Turkish.

They contain general translations; they do not choose a word's meaning
in the current sentence. Some words or meanings are missing, and Chinese data
may include simplified and traditional forms.

Data is from [WikDict](https://www.wikdict.com/page/download), based on
Wiktionary contributors through DBnary. The data uses
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The manager
provides attribution and source details; the extension includes the adaptation
notice and full license. See the
[full notice](../third-party/WikDict-NOTICE.txt).

## Help with Save

Choose a language under **Settings → Dictionary → Translate to** before saving.
If Save asks you to reload, reload Clever Youtube Subtitle on the browser's
Extensions page, then close and reopen Settings. This updates the background's
language list after a manual extension update. The selected dictionary must
also be downloaded or imported before you can use it.

## Reading a dictionary

The first installation downloads the original SQLite database and reads it in
a separate thread. Keep the manager page open until saving finishes. The reader
is released afterward; normal word lookup uses only the installed entries.
Previously installed dictionaries remain available after an extension update.
The old custom `.json.gz` preview files are not official SQLite files; for new
imports, use **Get file** and import the `.sqlite3` file.
