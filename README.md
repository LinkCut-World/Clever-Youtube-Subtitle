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
- Move your mouse over a shown word in a YouTube caption to add it. The button says, for example, **Add “like” to My Vocabulary**.
- Move your mouse over a hidden word to see it faintly. You can click the button to remove it from My Vocabulary.

Changes to My Vocabulary update the open caption right away. Turning off YouTube captions also turns off the filtered caption.

## How words match

Matching ignores capital letters and marks at the start or end of a word. The extension also checks the sentence to find a word's base form. For example, saving `like` can hide `likes`, `liked`, and `liking`. The button shows the word that will be saved or removed.

The bundled [wink-nlp](https://github.com/winkjs/wink-nlp) model runs in your browser. It can make mistakes when a word has more than one meaning or when a caption is too short. You can edit My Vocabulary at any time.

## Privacy

My Vocabulary is saved in Chrome's local extension storage. The extension does not send your words to a server. It works on YouTube pages and reads YouTube's own captions. If another extension adds captions on top of the video, turn off that other caption layer to see only the filtered YouTube captions.

## Build and test

Run `npm ci` and `npm test` for local tests. Run `npm run build` only if you change `lemma-entry.js` or the word-model packages. Commit the new `lemma-bundle.js` after rebuilding so the Chrome extension remains ready to install.

## License

This project is licensed under the [MIT License](LICENSE). The bundled word-model packages have their own MIT notices in [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt).
