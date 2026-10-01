# Clever Youtube Subtitle

Learn English with YouTube captions. Save words you know in **My Vocabulary**. The extension hides those words in YouTube's own captions, so you can focus on words you do not know. Hidden words still keep their place in each line.

## Install

1. Download this repository as a ZIP file and unzip it, or clone it with Git.
2. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
3. Click **Load unpacked** and choose the folder that contains `manifest.json`.
4. Open a YouTube video and turn on captions (CC).

The ready-to-use English word model is included. You do not need Node.js to use the extension.

## Use My Vocabulary

- Click the extension icon, then **Open My Vocabulary**.
- Import a TXT or one-column CSV file, or type words into the page. You can add to your saved words or replace all of them.
- Search, remove, and export words on the same page. The list shows 50 words at a time, even when you have thousands of words.
- Move your mouse over a shown word in a YouTube caption. Click the small **+** button just above it to add it to My Vocabulary.
- Move your mouse over a hidden word to see it faintly. Click the small **−** button just above it to remove it from My Vocabulary.
- Hover over either button to see the exact word that will be added or removed. For example, `likes` can use the base form `like`.

Changes to My Vocabulary update the open caption right away. Turning off YouTube captions also turns off the filtered caption.

## Review the previous caption

After captions move on, a small **↶ Previous caption** button appears at the top left of the video. Click it to pause the video and open the previous caption. You can reveal hidden words and use the same **+** and **−** word buttons there, without rewinding or trying to pause at the right moment.

On a touch screen, tap and release **Previous caption** to open it. Drag the text area to scroll a long caption. The review buttons work even when YouTube's player controls cover their touch area.

The previous caption stays open while you update My Vocabulary. Click **Continue playback**, click **Previous caption** again, or press **Esc** when you are ready to continue. If the video was already paused, the closing button says **Close** and keeps it paused.

The extension remembers the last distinct caption it saw on the current video. Line wrapping and words gradually added to a caption do not replace that history. Seeking, changing videos, or turning off CC clears it.

## Sync between devices

Create a **separate private Git repository** for your vocabulary. It can be on GitHub, GitLab, Gitea, Forgejo, or your own Git server. The server must support Git Smart HTTP for reading and pushing over HTTP or HTTPS. Do not use the Clever Youtube Subtitle code repository: its history may become public later.

1. Prepare a user name and token or password that can read and push to only that vocabulary repository. The credentials must work for Git over HTTP, not just for the website's API.
2. In **My Vocabulary**, under **Sync between devices**, paste the repository's **HTTPS clone URL**. You can include login details, such as `https://USERNAME:TOKEN@git.example.com/USERNAME/my-vocabulary.git`, or enter them in the separate fields. Use your real values only in the extension; never add the token to this code repository. Leave **Branch** empty to use the default branch. An empty repository starts with `main` unless you enter another branch.
3. Click **Save and sync** and allow the extension to connect to that server when the browser asks. Repeat on your other device with the same repository and branch. The page shows the repository address without login details after you save it.

The extension saves changes locally first, then syncs in the background after about 30 seconds and checks for changes every five minutes. When the browser starts or the extension updates, it restores the timer if needed and tries one sync if sync is enabled. **Sync now** checks immediately. If you are offline, your words stay on your device and sync when it can connect again. Turning off sync keeps your local words and removes the saved connection token. When two devices connect for the first time, their existing words are combined. To replace the shared vocabulary, connect and sync first, then use **Replace My Vocabulary**.

Changes to different words are kept. If two devices change the same word, the action with the later recorded time wins; equal times use a stable device ID. If another device pushes first, the extension reads the new version, merges words, and retries. It never force-pushes. Device clocks that are wrong can affect the order of offline changes. The repository stores `clever-subtitle-vocabulary.json.gz`, including removal records so older device copies cannot restore deleted words.

The bundled Git client runs inside the extension and connects directly to your server, without a proxy or a local service. Your local vocabulary remains in extension storage; a temporary Git checkout is recreated for each sync. SSH URLs and browser-only login pages are not supported. Use the final clone URL rather than a redirect. If you used GitHub sync in version 1.8.0, save its settings once after updating to allow access to `github.com`; the vocabulary file format is unchanged.

## Move your words with a file

Open **My Vocabulary** on your first browser and click **Export TXT**. Move the saved TXT file to your other device. In the other browser, open **My Vocabulary**, choose that file, select **Replace My Vocabulary**, and click **Import words**. Use **Add to My Vocabulary** instead if you want to keep words already saved on the other device.

This is a manual transfer. Keep the exported TXT file as a backup, even if you use Git sync.

### Kiwi Browser on Android

Use the **Kiwi ZIP**, which requests Git server access when it is installed. Kiwi may fail to show the later access prompt with the error "Could not find an active window". The default Kiwi ZIP requests HTTP/HTTPS host access so you can use any Git server. The desktop version requests access to each server when you save its settings.

Kiwi may install the ZIP without a separate permission prompt. The extension checks server access when you save the sync settings. To open My Vocabulary, choose **Clever Youtube Subtitle** from Kiwi's menu, then tap **Open My Vocabulary**. The page opens in a normal tab. If Kiwi's **Extension options** link does not open a visible page, use this menu button instead.

Kiwi can install a ZIP of the extension from its extensions page. Open **Extensions**, turn on **Developer mode**, tap **+ (from .zip/.crx/.user.js)**, and choose the Kiwi ZIP. Then open **My Vocabulary** in Kiwi and import the TXT file you moved from your computer.

On a touch screen, tap a caption word to pause the video and select the word. Lift your finger, then tap the **+** or **−** button to change My Vocabulary. The first tap does not change your saved words. The button stays open until you use it, tap outside the word, or resume playback. Updating My Vocabulary keeps the video paused; use YouTube's play button when you are ready to continue. If YouTube captions are not filtered on the mobile site, use Kiwi's **Desktop site** mode for YouTube and turn on CC there.

You can also tap **Previous caption** to pause and review the last caption, then tap **Continue playback** when you have finished.

[Kiwi Browser is archived](https://github.com/kiwibrowser/src.next/blob/kiwi/README.md), so support for this Manifest V3 extension may vary by Kiwi version.

## How words match

Matching ignores capital letters and marks at the start or end of a word. The extension also checks the sentence to find a word's base form. For example, saving `like` can hide `likes`, `liked`, and `liking`. The button shows the word that will be saved or removed.

The bundled [wink-nlp](https://github.com/winkjs/wink-nlp) model runs in your browser. It can make mistakes when a word has more than one meaning or when a caption is too short. You can edit My Vocabulary at any time.

## Privacy

My Vocabulary is saved in local extension storage. Git sync is optional. When you turn it on, the extension sends your vocabulary and change records to the Git repository you choose. Login details are saved only in that browser's extension storage, not in the source code or installation ZIP. Server access is requested for the host you enter. The extension cannot check repository visibility for every Git server, so choose a private repository. It works on YouTube pages and reads YouTube's own captions. If another extension adds captions on top of the video, turn off that other caption layer to see only the filtered YouTube captions.

## Build and test

Run `npm ci` and `npm test` for local tests. Git must be installed to run the sync integration tests, which use a temporary local Git HTTP server. Run `npm run build` if you change `lemma-entry.js` or the word-model packages. Run `npm run build:git` if you change `git-entry.js` or its packages. Commit the generated bundles and license notices so the extension remains ready to install.

On Windows, run `./package-kiwi.ps1` after committing a release to build its Kiwi ZIP. To allow only your Git host, use `./package-kiwi.ps1 -GitServers 'https://git.example.com/*'`. This script packages committed runtime files and changes only the ZIP's host-permission declaration; it does not include local vocabulary or credentials.

## License

This project is licensed under the [MIT License](LICENSE). The bundled word-model packages have their own MIT notices in [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt). Git client and filesystem dependency notices are included in [GIT_THIRD_PARTY_LICENSES.txt](GIT_THIRD_PARTY_LICENSES.txt).
