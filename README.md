# Submitify CF

Paste your solution straight into the Codeforces problem sidebar and submit it, instead of saving it to a file and uploading it through "Choose file".

<img width="485" height="793" alt="image" src="https://github.com/user-attachments/assets/279ef822-fa64-4ee5-904f-b5db84d2910d" />


Works in Firefox and in Chromium browsers (Vivaldi, Chrome, Brave, Edge, Arc).

## Features

- **Editor in the sidebar.** The "Choose file" row becomes an editor with line numbers, a resizable height and the selected language shown on top.
- **Editing keys.**
  - Tab and Shift+Tab indent and outdent, including multi-line selections.
  - Enter keeps your indentation.
  - Cmd+Enter (Ctrl+Enter on Windows/Linux) submits.
  - Esc leaves the editor.
- **Files and drafts.** Open a file or drag one in. Your code is saved per problem, so it's still there when you come back.
- **Status in a new tab.** Submitting opens Codeforces' "My submissions" page in a new tab and leaves the problem page alone.
- **Live verdict.** Under the Submit button you see "Running on test 7", "Wrong answer on pretest 3" or "Accepted" in Codeforces' colours, with time, memory and a link. The tab title follows along too.
- **Resubmitting identical code.** Codeforces rejects code you've already sent. "Submit again anyway" adds a one-line comment so it goes through, and your editor text stays as it was.

## Install

Get the zips from the [Releases](../../releases) page, or build them yourself (see [Building](#building)).

### Vivaldi / Chrome / Brave / Edge / Arc

1. Unzip `submitify-cf-chromium-v*.zip` into a folder you'll keep. The browser loads the extension from that folder.
2. Open `vivaldi://extensions` (or `chrome://extensions`, `brave://extensions`, `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the folder.

### Firefox

**Quick test.** Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and pick `manifest.json` from the unzipped `submitify-cf-firefox-v*.zip`. Firefox removes it when you restart.

**Permanent install.** Firefox release builds only run signed add-ons. You can sign it for free as an unlisted add-on with [AMO API keys](https://addons.mozilla.org/developers/addon/api/key/):

```sh
./build.sh
npx web-ext sign --source-dir dist/firefox --channel=unlisted \
  --api-key=$AMO_JWT_ISSUER --api-secret=$AMO_JWT_SECRET
```

Then open the `.xpi` from `web-ext-artifacts/` in Firefox.

## Usage

1. Open any Codeforces problem while logged in.
2. Pick the language in the **Submit?** box as usual.
3. Paste your code and press **Cmd+Enter** (or click **Submit**).

The status page opens in a new tab, and the verdict also shows up under the Submit button on the problem page.

## Building

The source lives in `src/`, and each browser gets its own manifest in `manifests/`.

```sh
./build.sh
```

This creates `dist/firefox/` and `dist/chromium/`, which you can load as unpacked extensions, plus a zip of each.

While developing, load the matching `dist/` folder. After you edit something in `src/`, run `./build.sh` again, then click the extension's reload button and refresh the Codeforces tab.

## How it works

- `Submitify.js` is a content script. It finds the sidebar submit form (`input[name="sourceFile"]`) and swaps that input for a textarea with the same name, which Codeforces accepts as pasted source.
- The form posts with `target="_blank"`, so the response opens in a new tab and redirects to "My submissions".
- The verdict comes from the public [`user.status`](https://codeforces.com/apiHelp/methods#user.status) API, polled every 2 seconds. That matches the API's rate limit, and it backs off when there are errors.
- Drafts are kept in `storage.local`.

## Project layout

```
src/                 shared extension code
  Submitify.js       content script: editor, submit, verdict tracking
  submitify.css      styles matched to the Codeforces sidebar
  icons/
manifests/
  firefox.json       MV3 + browser_specific_settings.gecko
  chromium.json      MV3 for Chrome 111+ / Vivaldi
build.sh             produces dist/firefox and dist/chromium
```

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Credits

Inspired by [Submity CF](https://github.com/ashrafulX/Submity-CF-Firefox) by Ashraful Islam ([announcement on Codeforces](https://codeforces.com/blog/entry/151811)), which brought back textarea submission on Codeforces. This project is a separate rewrite and contains none of its code.

## License

[MIT](LICENSE)
