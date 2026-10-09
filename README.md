# Clever Youtube Subtitle

Hide words you know in YouTube captions, and focus on listening.

Save your known words in **My Vocabulary**, then turn on YouTube captions (CC).
Words you know become invisible but keep their place. Words you do not know stay
visible. You can reveal a hidden word and change your vocabulary while watching.

## Is it right for you?

### Good points

- **Less text to read.** Familiar words stay hidden, so you can focus more on
  listening.
- **Help with words you do not know.** Words outside your list stay visible.
  You can reveal hidden words whenever you need them.
- **Uses YouTube's own captions.** Caption filtering needs no translation API
  or API key. Online word meanings are optional.
- **Private by default.** Word matching runs locally. Your vocabulary stays on
  your device unless you choose to use Git sync.

### Limits

- **Bring your own word list.** This extension works best if you already have a
  list of English words you know. Import that list into My Vocabulary before
  you start watching. If you do not have one, building a useful list from
  scratch can take a lot of time and effort. Usually, saving the base form is
  enough: save `like` to cover `likes` and `liked`, without listing each form
  separately.

**[Download the latest release](https://github.com/LinkCut-World/Clever-Youtube-Subtitle/releases/latest)**

## Install

Choose an installation ZIP under **Assets** on the release page:

| Browser | Download |
| --- | --- |
| Chrome on a computer | `Clever-Youtube-Subtitle-Chrome-v….zip` |
| Kiwi on Android | `Clever-Youtube-Subtitle-Kiwi-v….zip` |

The word model is included. You do not need Node.js, Python, or a local server to
use the extension. No offline word dictionaries are included; download only
the languages you want if you choose WikDict for word meanings.

### Chrome

1. Download the **Chrome ZIP** and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Click the extension icon, then **Open Settings**, and add your words under **My Vocabulary**.
5. Open a YouTube video and turn on captions (CC).

To update, replace the files in the same extension folder, click **Reload** on
the extensions page, and refresh your YouTube tabs.

### Kiwi on Android

1. Download the **Kiwi ZIP** to your phone.
2. Open Kiwi's **Extensions** page and turn on **Developer mode**.
3. Tap **+ (from .zip/.crx/.user.js)** and choose the ZIP.
4. Open **Clever Youtube Subtitle** from Kiwi's menu, then tap **Open Settings**.
5. Add or import words under **My Vocabulary**, open YouTube, and turn on captions (CC).

The Kiwi ZIP includes access to HTTP and HTTPS servers at installation, so Git
sync and online word meanings do not need a later permission prompt. Chrome
asks for access to the chosen server when you set up either feature.

## Settings

Click the extension icon, then **Open Settings**. The page has two main sections:

- **My Vocabulary:** import, add, browse, and export words you know.
  **Sync between devices** is inside this section and connects a private Git
  repository for your vocabulary.
- **Dictionary:** choose Microsoft or WikDict, select a language, and manage dictionaries.

## My Vocabulary

My Vocabulary is the list of English words you already know. Open **Settings → My Vocabulary** to manage it.

- **Import words:** choose a TXT or one-column CSV file. Separate words with a
  new line, space, comma, or semicolon.
- **Add to My Vocabulary:** keep your saved words and add the imported words.
- **Replace My Vocabulary:** replace your saved words with the imported words.
- **Add words:** type a word or paste several words.
- **Browse words:** search the whole list and remove words. Each page shows 50 words.
- **Export TXT:** save a copy for backup or transfer to another device.

Duplicates are skipped, and matching ignores capital letters. Changes update
open captions right away.

## While watching

These actions work in both the current captions and the **Previous caption**
panel. Revealed words appear faintly, at **35% opacity**, and keep their space.

### Mouse

- **Hover over a word:** show its **+ / −** button. If the word is hidden, show
  **all hidden words** faintly, including words in the Previous caption panel.
  Hovering does not play or pause the video.
- **Click a word:** pause the video and keep its button in place, even after you
  move the mouse away. Hovering another word temporarily shows its button;
  moving away restores the clicked word's button. The word card stays with the
  clicked word. Clicking a hidden or faint word keeps all hidden words faintly
  visible. Clicking a fully visible word hides them again.
- **Click + or −:** add or remove the word in My Vocabulary. It acts on the word
  under that button and keeps the current selection. The button changes after saving.

### Touch screen

- **Tap a hidden word:** pause the video and show **all hidden words** faintly,
  including words in the Previous caption panel. This first tap does not show
  a word button.
- **Tap a visible or faint word:** pause the video and show its **+ / −** button.
  Choosing a fully visible word hides the faint words again. Choosing a faint
  word keeps them shown.
- **Lift your finger, then tap + or −:** add or remove the word in My Vocabulary.

Changing My Vocabulary keeps the selected word, its card, and its button.
Play the video again to hide the faint words and clear the selection on either
device. Use YouTube's play button to continue.

The word button shows **…** while saving a word. **!** means the
save failed; tap again to retry. Hover over the button to see the word it will
add or remove.

New captions stay invisible, with their space kept, until word matching is
ready. Captions that add words one by one keep the words already matched;
only new words wait. Moving a line up keeps its words and your selected word.
Later words can give the model more context and change an earlier word's match.

### Dictionary

In **Settings → Dictionary**, choose a **Source** and **Translate to**.
Click a word with a mouse, or tap a visible or faint word on a phone, to show
its meanings beside the selected word. Hovering does not open the word card.
The card shows the base form only and at most three different entries.
The first tap on a hidden word only reveals the faint words, as before.
Play the video again to close the card. The same actions work in Previous caption.

Lookup uses the existing word model's base form, with the original word as a
fallback. These are dictionary meanings, not a translation of the sentence.

**Microsoft Translator (online):** use a key from an Azure Translator resource
in the international Azure portal. The **F0** tier offers a monthly free amount.
First set the Azure portal language to **English** so its menu names match
the [Microsoft setup guide](docs/MICROSOFT_TRANSLATOR.md).
Paste the key, choose a target language, and leave **Translator region** empty if
your resource is **Global**. For a regional resource, enter its region code,
such as `eastus`. Use the Translator service's region, separate from the resource
group's region. Choose **Save and check** to look up the **Try a word** field
and see a real result on this page. A failed check leaves the last working
settings intact. The saved key is never filled back into the key box; an empty
box keeps it. **Remove saved key** removes it from this browser.

This uses Microsoft's official
[Dictionary Lookup API](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/dictionary-lookup).
It supports 49 English-to-target dictionary pairs in this version.
Translations are sorted by Microsoft's score, deduplicated, and limited to
three. No sentence, video title, examples, or vocabulary list is submitted.
A small memory cache shares repeated word queries across tabs. Each
**Save and check** makes a fresh request to verify the key.

**WikDict (offline):** no dictionary is installed by default. In Dictionary,
choose **WikDict (offline)** and open **Manage dictionaries**. Download only the
languages you need. All 25 available English-to-target WikDict exports are
listed. **Search languages** accepts an English name, native name, or language
code and ignores accents and letter case. The manager shows
download size, data size, word count, and installed version. It offers **Update**
when this extension's catalog has a newer file, **Download again** for the
current file, and **Delete** to remove a language. Use **Use** to select an
installed language, or choose it under **Translate to** and click **Save**.

**Download** gets the official `.sqlite3` file directly from WikDict. The
extension reads it on your device and saves the entries for offline use.
Downloading does not depend on this project's GitHub releases.
If downloading does not work, use **Get file** to save the official file,
then **Import file**. You can move the
same file to a phone and import it there. Once installed, lookup needs no key
or connection. Files are checked before saving; a failed update keeps the old
dictionary. Downloads stay in this browser across restarts and extension
updates. They are not part of Git vocabulary sync. See the
[offline dictionary guide](docs/OFFLINE_DICTIONARIES.md).

Some words or meanings are missing, and Chinese entries may contain simplified
or traditional characters. Data comes from
[WikDict / Wiktionary](https://www.wikdict.com/page/download); see the
[dictionary notice](third-party/WikDict-NOTICE.txt).

### Previous caption

Click or tap **↶ Previous caption** to pause and read the last caption. You can
reveal words and use the same **+ / −** buttons there. Choose **Continue playback**
when you are ready, or **Close** if the video was already paused.
Opening the panel does not reveal hidden words. Click or tap **Previous caption**
again to close it; playback resumes only if opening the panel paused it.

For captions that add words one by one and scroll, Previous caption shows the
last two lines that left the screen. It shows one line until two are available.
Adding words does not change this history. A line may be part of a sentence.

Drag the **Previous caption** button to move it. After you release it, it moves
to the closer left or right edge of the video. Seeking, changing videos, or
turning off CC clears the caption history.

### How words match

The extension checks a word's base form in its sentence. For example, `like` can
hide `likes` and `liked`, and `give` can hide `gives`. In `on understanding what
happens`, `understand` can hide `understanding`. In `My understanding is different`,
the model keeps the noun `understanding`.

The original MorphoDiTa English model runs locally in your browser. It can still
make mistakes, especially with short captions. Loading the model for the first
caption can take a moment.

## Use your words on another device

### Transfer with a TXT file

On the first device, open **Settings → My Vocabulary** and click **Export TXT**. Move the
file to the other device and import it there. Choose **Add to My Vocabulary**
to combine the lists, or **Replace My Vocabulary** to use only the imported list.
This is a manual transfer, not automatic sync.

### Optional Git sync

1. Create a **separate private Git repository** for your vocabulary.
2. Open **Settings → My Vocabulary → Sync between devices**.
3. Enter its HTTPS clone URL and a user name and token or password that can read
   and push to that repository. A URL containing login details is also accepted.
4. Leave **Branch** empty to use the default branch, then click **Save and sync**.
5. Use the same repository and branch on your other device.

Changes are saved locally first. Sync starts about 30 seconds after a change and
checks every five minutes while the browser is running. It resumes when you
reopen the browser. **Sync now** runs a check immediately.

The first sync combines the devices' existing words. If two devices change the
same word, the action with the later recorded time wins. Keep device clocks
correct. Your words remain available offline.

The server must support Git over HTTP or HTTPS. SSH addresses and website-only
login are not supported. See [Git sync details](docs/GIT_SYNC.md) for server
requirements and how changes merge.

## Help

- **No filtered captions:** turn on YouTube's own CC. If another extension shows
  captions on top of the video, turn off that caption layer.
- **Kiwi mobile page does not work:** try YouTube in **Desktop site** mode.
- **Settings does not open in Kiwi:** open the extension from Kiwi's menu
  and use **Open Settings** instead of the **Extension options** link.
- **Git server access prompt fails in Kiwi:** install the **Kiwi ZIP** from Releases.
- **Offline Save asks you to reload:** reload the extension and reopen Settings.
  A page opened after a file update can have a newer language list than the
  running background. Choose a language under **Translate to**, then save again.

Kiwi support can vary by browser version.

## Privacy

Your vocabulary and login details stay in this browser's extension storage.
Caption analysis runs locally. If you enable Git sync, your vocabulary and its
change records are sent to the repository you choose. Use a separate private
repository; installation ZIPs do not include your words or login details.

Online word meanings send only the queried word, its target language, and the
required authentication headers to Microsoft. Your Microsoft key and word
meaning settings stay in this browser's local extension storage; they are not
included in Git vocabulary sync, TXT export, or installation ZIPs. Configure
the key separately on each device. Caption matching still runs locally.

Offline dictionary downloads go directly to `download.wikdict.com` without a
Microsoft key or Git login details. Downloaded and imported files are processed locally.
Installed dictionary data stays in this extension's local database, separate
from your vocabulary. It is removed when you delete a language or uninstall
the extension.

## Development and license

See the [development guide](docs/DEVELOPMENT.md) for local checks, WASM builds,
and the release process.

Project code is [MIT](LICENSE). The bundled MorphoDiTa engine is MPL 2.0, and its
English model is CC BY-NC-SA 3.0 Unported, for noncommercial use under that license.
The full package includes these additional terms. See
[word-model notices](THIRD_PARTY_LICENSES.txt) and
[Git dependency notices](GIT_THIRD_PARTY_LICENSES.txt).
