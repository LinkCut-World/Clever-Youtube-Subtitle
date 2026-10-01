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

## Sync between devices

Create a **separate private GitHub repository** for your vocabulary. Do not use the Clever Youtube Subtitle code repository: its history may become public later.

1. Give a fine-grained GitHub access token permission to read and write **Contents** of only that private vocabulary repository.
2. In **My Vocabulary**, under **Sync between devices**, paste the repository's HTTPS URL. You can include the token in the URL, such as `https://USERNAME:TOKEN@github.com/USERNAME/my-vocabulary.git`, or enter it in the separate token field. Use your real values only in the extension; never add the token to this code repository.
3. Click **Save and sync**. Repeat on your other device with the same repository and its own token. The page shows the repository address without the token after you save it.

The extension saves changes locally first, then syncs in the background after about 30 seconds and checks for changes every five minutes. **Sync now** checks immediately. If you are offline, your words stay on your device and sync when it can connect again. Turning off sync keeps your local words and removes the saved connection token. When two devices connect for the first time, their existing words are combined. To replace the shared vocabulary, connect and sync first, then use **Replace My Vocabulary**.

Changes to different words are kept. If two devices change the same word, the action with the later recorded time wins; equal times use a stable device ID. GitHub write conflicts are retried automatically. Device clocks that are wrong can affect the order of offline changes. The private repository stores a compressed vocabulary file, including removal records so older device copies cannot restore deleted words.

## Move your words with a file

Open **My Vocabulary** on your first browser and click **Export TXT**. Move the saved TXT file to your other device. In the other browser, open **My Vocabulary**, choose that file, select **Replace My Vocabulary**, and click **Import words**. Use **Add to My Vocabulary** instead if you want to keep words already saved on the other device.

This is a manual transfer. Keep the exported TXT file as a backup, even if you use GitHub sync.

### Kiwi Browser on Android

Kiwi can install a ZIP of the extension from its extensions page. Open **Extensions**, turn on **Developer mode**, tap **+ (from .zip/.crx/.user.js)**, and choose the extension ZIP. Then open **My Vocabulary** in Kiwi and import the TXT file you moved from your computer.

On a touch screen, tap a caption word, lift your finger, then tap the **+** or **−** button. The first tap only selects the word. The button stays open until you use it or tap outside the word. If YouTube captions are not filtered on the mobile site, use Kiwi's **Desktop site** mode for YouTube and turn on CC there.

[Kiwi Browser is archived](https://github.com/kiwibrowser/src.next/blob/kiwi/README.md), so support for this Manifest V3 extension may vary by Kiwi version.

## How words match

Matching ignores capital letters and marks at the start or end of a word. The extension also checks the sentence to find a word's base form. For example, saving `like` can hide `likes`, `liked`, and `liking`. The button shows the word that will be saved or removed.

The bundled [wink-nlp](https://github.com/winkjs/wink-nlp) model runs in your browser. It can make mistakes when a word has more than one meaning or when a caption is too short. You can edit My Vocabulary at any time.

## Privacy

My Vocabulary is saved in local extension storage. GitHub sync is optional. When you turn it on, the extension sends your vocabulary and change records to the private repository you choose through GitHub's API. The access token is saved only in that browser's extension storage, not in the source code or installation ZIP. It works on YouTube pages and reads YouTube's own captions. If another extension adds captions on top of the video, turn off that other caption layer to see only the filtered YouTube captions.

## Build and test

Run `npm ci` and `npm test` for local tests. Run `npm run build` only if you change `lemma-entry.js` or the word-model packages. Commit the new `lemma-bundle.js` after rebuilding so the Chrome extension remains ready to install.

## License

This project is licensed under the [MIT License](LICENSE). The bundled word-model packages have their own MIT notices in [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt).
