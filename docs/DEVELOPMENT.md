# Development and releases

## Local checks

The repository includes the generated Git bundle and the MorphoDiTa runtime.
Users can install the extension without a build step.

For development:

```powershell
npm ci
npm run build
npm test
```

`npm run build` verifies the runtime hashes and license files. Tests use the
original MorphoDiTa model, and the Git integration tests use a temporary local
HTTP server; Git must be installed. Run `npm run build:git` after changing
`git-entry.js` or its dependencies, and commit the resulting bundle and notices.

## MorphoDiTa WASM

The model runs on demand in the extension background service worker. YouTube
tabs share that worker's model, and each tab keeps a small caption-result cache.
The browser can stop an idle worker; the next uncached caption reloads the model.
No keep-alive loop or external NLP service is required.

`caption-stream.js` tracks each word occurrence through appended text, native
visual rows, and row rolls. It keeps one active analysis plus the latest waiting
snapshot. Snapshots reference their original word objects, so late results can
finish retained words and frozen history without overwriting a new caption.
The most recently removed row supplies context for the current rows. Original
model lemmas can change as that context grows; ready words stay rendered while
new analysis runs. If a frozen row's waiting analysis was dropped, opening it
finishes its saved context. Whitespace is kept exactly in the page.

Native caption segments always have hidden text visibility. An empty pseudo-element
paints their inherited background and rounded corners without revealing native
text or intercepting input. Only classified token
spans restore visibility; unprocessed text in the segment or its output wrapper
stays hidden even when the ready flag is stale. Styles are registered at
document start, separately from the DOM
script. The ready gate hides only the output text and also waits for the saved vocabulary. Rolling history
retains the last two removed rows and preserves their line break.

`caption-interaction.js` stores separate hovered, selected, and mobile reveal-only
word occurrences. The button follows the hovered word if present, otherwise the
selected word; the dictionary card always follows the selected word. Leaving a
hover restores the selection. A click replaces the selection and its reveal
intent, so choosing a fully visible word cancels an earlier known-word reveal.
A mobile reveal-only tap has no button or dictionary request; tapping a faint
word then selects it. Vocabulary saves update membership and symbols without
inventing another word gesture or dismissing the selected word. Each occurrence
is independently rebound after caption reflow; losing one does not lose the
other. The play event and caption history resets clear all interaction state.
Previous caption controls retain their own pause/close behavior and do not start
a reveal. Closing review clears only its word occurrences unless it also resumes
playback. Duplicate pointer and
touch events from the same press are consumed before interpreting a new word
action, and touch-generated mouse hover events are ignored.
On touch screens, the first tap on a hidden word pauses and holds the shared
reveal without selecting a button. A later tap on any visible or revealed word
selects its button. Changing that selection or saving vocabulary does not clear
the held reveal.

- Engine: MorphoDiTa 1.11.3, unmodified upstream source.
- Source commit: `d1617496b2ae7fcb031d5a2e38511d7401c74afc`.
- Compiler: Emscripten 3.1.73.
- Model: `english-morphium-wsj-140407-no_negation.tagger`, unmodified.
- Wrapper: `morphodita/bridge.cpp` and `morphodita/engine.js` handle transport and
  Unicode offsets. `word-utils.js` maps those original annotations to caption
  segments. There are no added linguistic rules or lemma overrides.

The model file is about 5.4 MiB. The desktop experiment allocated 83.75 MiB of
WASM linear memory. File size, allocated memory, page-memory estimates, and
complete process RSS are different measurements; mobile results can differ.

To rebuild, obtain the [pinned engine source](https://github.com/ufal/morphodita/tree/d1617496b2ae7fcb031d5a2e38511d7401c74afc),
the [official English model](https://ufal.mff.cuni.cz/morphodita/users-manual#english-morphium-wsj),
and an activated Emscripten 3.1.73 SDK. Keep the model distribution's LICENSE and
README beside the original tagger file, then run:

```powershell
./build-morphodita.ps1 -SourceRoot C:\path\to\morphodita -SdkRoot C:\path\to\emsdk -ModelPath C:\path\to\english-morphium-wsj-140407-no_negation.tagger
npm run build
npm test
```

Python is needed by the compiler only. The installed extension runs WASM directly.
The build script updates provenance hashes and copies the original license notices.

## Installation packages

### Optional offline dictionaries

`dictionary.js` performs exact dictionary lookups with the existing contextual
lemma first and the surface word as a fallback. It adds no lemmatization rules.
The background worker reads installed IndexedDB shards, caches at most four
shards, and shares them across tabs. `word-meaning.js` discards old responses
when another word or language is selected, or playback/selection clears the card.
The word card does not run on hover or on a mobile reveal-only tap.

No dictionaries are bundled or auto-downloaded. `dictionary-manager.js` runs
downloads/imports in a visible extension page. `dictionary-packs.js` verifies
official SQLite size, SHA-256, and the SQLite header against `dictionary-catalog.js`.
`wikdict-client.js` transfers the bytes to a short-lived worker. `wikdict-worker.js`
loads the bundled sql.js runtime, adapts the original SQLite data using
`wikdict-sqlite.js`, and writes to IndexedDB. It posts progress/metadata only and
is terminated when it finishes, releasing the SQL heap. Normal caption lookup
never loads SQLite. `dictionary-store.js` installs or removes all 128 shards
and metadata in a single IndexedDB transaction. A failed replacement retains the
old version. A nonsecret storage marker refreshes live cards; the background also
checks installed metadata before using cached shards. The catalog is delivered
with extension updates. Nothing adds a dictionary background update alarm.

Regenerate the official download catalog with `npm run build:dictionaries`.
Pinned original SQLite URLs, sizes, hashes, and word counts live in
`dictionary-sources.json`. No data file is created, hosted by this project, or
attached to its release. Download and Get file both use `download.wikdict.com`.
Imports accept the same official `.sqlite3` files. The manager and included
notices provide attribution and the CC BY-SA 4.0 terms. Python is not required.
Use `npm run build:sqlite` to copy the pinned sql.js 1.14.2 JS/WASM assets and
MIT license from the npm dependency. Preserve their bytes; `npm run build`
verifies the hashes in `sqlite/provenance.json`.
All English-source pairs in the pinned upstream directory are represented in
`dictionary-sources.json`. Offline languages are derived from the generated
catalog, so the manager and settings cannot drift into separate five-language
lists. The manager searches English/native names, language codes, and the
browser's localized language name, with accent and case folding.
Raw databases are cached under ignored `dist/dictionary-source/`.
The conversion prefers rows linked to an English lexical entry. Unlinked reverse
translations are a fallback only when no linked row is available for a headword.
No particular word or translation is overridden. Grammar labels use the chosen
dictionary language. Source and license details stay in settings and notices,
without a footer in the small word card.

### Microsoft Dictionary Lookup

`microsoft-dictionary.js` calls only the official international v3.0
`dictionary/lookup` endpoint. It queries the contextual lemma first and uses
the surface as a fallback when the lemma is absent. It normalizes POS tags,
sorts by Microsoft's confidence field, deduplicates display translations,
and returns at most three. It requests no examples or sentence translations.
The 49 target language codes in `dictionary.js` come from Microsoft's public
`languages?api-version=3.0&scope=dictionary` response on 2026-10-08.

`dictionary-service.js` selects the provider in the background. A bounded
512-item, 12-hour memory cache shares duplicate queries between tabs while the
worker is alive; it is not a dictionary download and is lost when the worker
is discarded. Errors are not cached. The HTTP request has a 12-second timeout,
omits cookies, rejects redirects, and sends the key only in an authentication
header. Key or region changes invalidate the cache. Save checks bypass the cache.

`dictionary-settings.js` obtains no saved secret from the background status
message. It requests Microsoft host access on the save button's user gesture,
checks a real word before committing settings, and clears a newly entered key
after success. Credentials live only in `chrome.storage.local`, under
`microsoftDictionaryConfig`; Git and TXT vocabulary operations never read that
key. Settings messages are allowed only from the extension's settings/manager
pages; key removal is restricted to `options.html`. Stored language/provider/key
and pack changes refresh a selected card and discard its old response. The
Azure guide switches the portal to English before naming menus. The Kiwi
package includes Microsoft and dictionary download origins even when Git server
permissions are restricted.

To package the current files without making a commit, run
`./package-release.ps1 -WorkingTree`. These ZIPs have `-local` in their names
and are for local testing; this command does not commit, push, or publish.

On Windows, package a committed version:

```powershell
./package-release.ps1 -Ref HEAD
```

This creates Chrome and Kiwi ZIPs plus `SHA256SUMS.txt` under `dist/`. Both ZIPs
contain committed runtime files, documentation, and required licenses. They do
not include private vocabulary, credentials, development dependencies, or lab
experiments. The package script verifies model and runtime hashes inside each ZIP.

The Chrome manifest keeps servers as optional host permissions. The Kiwi
manifest requests HTTP/HTTPS host permissions at installation. To limit the
Kiwi package to your own server:

```powershell
./package-release.ps1 -GitServers 'https://git.example.com/*'
```

`package-kiwi.ps1` remains a convenience entry point to the same packaging process.

## Publish a version

Update `manifest.json`, `package.json`, and `package-lock.json` together, and write
the version's notes in `RELEASE_NOTES.md`. Commit the changes, then push a matching
tag, such as `v1.9.2`. Push the branch first, then push the tag.

The **Release** GitHub Actions workflow checks out that tag, installs development
dependencies, regenerates the official dictionary catalog and SQLite reader,
checks that the catalog matches the committed one, verifies the word model, and
runs all tests. It builds both installation ZIPs and attaches them and their
checksum file to a draft release, then publishes it. Dictionary data comes
directly from WikDict and is not uploaded by this workflow.
It uses GitHub's temporary workflow token;
no personal access token needs to be stored in the repository.

To publish an existing tag again after an interrupted run, open the **Release**
workflow in GitHub Actions, choose **Run workflow**, and enter that version tag.
Already published releases are kept unchanged.

Installation ZIPs belong in **Releases**, while source and packaging scripts
belong in Git. `dist/` stays ignored. GitHub's automatic source archive can also
install the desktop extension, but it does not include the Kiwi-specific manifest.
