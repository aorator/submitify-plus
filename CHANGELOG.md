# Changelog

## 2.2.0

- Submitting opens the Codeforces status page ("My submissions") in a new tab. The problem page no longer changes.
- The sidebar verdict panel now finds the new submission through the `user.status` API, matching the problem and an id newer than the one seen at page load.
- If no new submission appears within 30 s, the panel says so and offers "Submit again anyway". The usual cause is identical code. Codeforces shows any other error in the new tab.
- A 3 s lock prevents accidental double submits.

## 2.1.0

- Rewrote the extension with a UI styled to match the Codeforces sidebar.
- Editor:
  - line numbers and a resizable height
  - a language tag
  - Tab and Shift+Tab indent and outdent, Enter keeps the indentation, Cmd/Ctrl+Enter submits
  - Open file and drag-and-drop, plus an undoable Clear
- Drafts are saved per problem in `storage.local`.
- Live verdicts in Codeforces colours, including pretests, with time, memory and a link to the submission. The tab title shows the verdict too.
- Fixed a race where the "last submission id" was fetched after posting.
- The tracking comment is no longer appended to every submission.
- Polling uses `setTimeout` with backoff, and the DOM observer now disconnects once the editor is set up.
- Added icons and a Gecko add-on id. Added a Chromium build for Vivaldi, Chrome, Brave, Edge and Arc.

## 2.0.0

- A textarea replaces the file input, submissions post into a hidden iframe, and a basic verdict poller shows the result.
