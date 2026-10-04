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

Native caption segments always have hidden visibility. Only classified token
spans restore visibility; unprocessed text in the segment or its output wrapper
stays hidden even when the ready flag is stale. Styles are registered at
document start, separately from the DOM
script. The ready gate also waits for the saved vocabulary. Rolling history
retains the last two removed rows and preserves their line break.

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

On Windows, package a committed version:

```powershell
./package-release.ps1 -Ref HEAD
```

This creates Chrome and Kiwi ZIPs plus `SHA256SUMS.txt` under `dist/`. Both ZIPs
contain committed runtime files, documentation, and required licenses. They do
not include private vocabulary, credentials, development dependencies, or lab
experiments. The package script verifies model and runtime hashes inside each ZIP.

The Chrome manifest keeps Git servers as optional host permissions. The Kiwi
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

The **Release** GitHub Actions workflow checks out that tag, verifies the bundled
runtime, builds both packages, attaches them and their checksums to a draft
GitHub Release, and then publishes it. It uses GitHub's temporary workflow token;
no personal access token needs to be stored in the repository.

To publish an existing tag again after an interrupted run, open the **Release**
workflow in GitHub Actions, choose **Run workflow**, and enter that version tag.
Already published releases are kept unchanged.

Installation ZIPs belong in **Releases**, while source and packaging scripts
belong in Git. `dist/` stays ignored. GitHub's automatic source archive can also
install the desktop extension, but it does not include the Kiwi-specific manifest.
