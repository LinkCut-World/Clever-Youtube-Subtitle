# Git sync details

## Server and login

Use a separate private repository for My Vocabulary. Do not use the extension's
code repository: its source history and releases may later be public.

The extension uses Git Smart HTTP directly from the browser, with read and push
access. GitHub, GitLab, Gitea, Forgejo, and other servers can work if they support
that protocol and accept the supplied credentials for Git operations. API-only
tokens, SSH clone URLs, and login pages that need browser cookies are not supported.
Use the final clone URL rather than a redirect.

Enter the clone URL, user name, token or password, and optional branch in
**My Vocabulary → Sync between devices**. Credentials can also be in the URL.
After saving, the page shows the repository URL without login details. An empty
repository starts on `main` unless you choose a different branch.

Chrome requests access to the server when you save these settings. The default
Kiwi package includes HTTP/HTTPS server access at installation because Kiwi may
fail to show the later prompt. A maintainer can build a Kiwi package limited to
specific server origins; see [the development guide](DEVELOPMENT.md).

## Local saves and timing

Words are saved to local extension storage before syncing. Adding or removing a
caption word does not wait for a network request.

- After a change, sync is scheduled for about 30 seconds later.
- A background check runs every five minutes while the browser is running.
- Browser startup or an extension update restores the timer and tries a sync
  when sync is enabled.
- **Sync now** starts immediately.
- Offline changes stay local and are sent when a later sync can connect.

Browser scheduling can delay background checks. Turning off sync keeps the local
vocabulary and removes the saved connection settings and credentials.

## How changes merge

A legacy local list with no sync state is imported as initial words, without
invented addition times. The devices' initial lists are combined. Explicit add
and remove actions carry a recorded time and device ID, even while remote sync
is turned off.

Changes to different words are kept. For the same word, the later action wins;
equal times use a stable device ID. Correct device clocks matter for offline edits.
Removal records stop an older device copy from restoring a deleted word.

If another device pushes first, the extension reads the new state, merges the
word changes, and retries. It does not force-push. No manual Git text merge is
needed for vocabulary changes handled by the extension.

To replace a shared vocabulary, connect and sync first, then import with
**Replace My Vocabulary**. That produces the needed removal records.

The repository stores `clever-subtitle-vocabulary.json.gz`. The local vocabulary
remains in extension storage; the Git client creates a temporary checkout for
each sync. The server and repository are user-selected; the extension cannot
check repository visibility on every Git platform.
