# Simple GCS: bug proofs

Verdicts for the Simple GCS rows of [`../upstream-bugs.md`](../upstream-bugs.md), under the
[standard](README.md). Reproductions: `proofs/simple-gcs/simple-gcs.test.ts` (harness
`proofs/simple-gcs/_harness.ts`, which runs the original `SimpleGCS` sources and
`modules/MAVLink/mavlink.js` unchanged in `node:vm`, cutting single functions or class methods out by
brace matching where the file is a page script).

| #   | Bug                                                                  | Verdict    |
| --- | -------------------------------------------------------------------- | ---------- |
| 66  | `MAV_RESULT_CANCELLED` is not in the bundled dialect                 | NOT PROVEN |
| 67  | Video settings check a trimmed host and path but save them untrimmed | NOT PROVEN |
| 122 | A rejected Google Maps load is cached for the page's lifetime        | NOT PROVEN |
| 123 | WHEP session DELETE result is never observed                         | NOT PROVEN |

PROVEN: 0. NOT PROVEN: 4.

## 66. `MAV_RESULT_CANCELLED` is not in the bundled dialect

Row: `SimpleGCS/app.js` `mavResultName` (`case mavlink20.MAV_RESULT_CANCELLED`). "The case compares
with `undefined`, so a COMMAND_ACK with result 6 is reported as `CMD …: RESULT 6` instead of
`CANCELLED`."

**Verdict: NOT PROVEN.** Mis-described: no reference in the repository defines result 6 as
`CANCELLED`.

Test: `Simple GCS #66: MAV_RESULT_CANCELLED is not in the bundled dialect > reports result 6 as
"RESULT 6"; the CANCELLED case compares with undefined`. With the original `mavResultName` and the
original `mavlink.js`: `mavlink20.MAV_RESULT_CANCELLED` is `undefined`; results 0-8 read `ACCEPTED`,
`TEMPORARILY_REJECTED`, `DENIED`, `UNSUPPORTED`, `FAILED`, `IN_PROGRESS`, `RESULT 6`, `RESULT 7`,
`RESULT 8`. The dialect's `MAV_RESULT_*` values are `[0, 1, 2, 3, 4, 5, 7, 8]`, and so are the
`value`s of `<enum name="MAV_RESULT">` in the vendored `common.xml`.

Evidence:

- `upstream/SimpleGCS/app.js:68`: `case mavlink20.MAV_RESULT_CANCELLED: return "CANCELLED";` — a case
  whose label is `undefined`, so it can never match a numeric result (dead branch).
- `upstream/SimpleGCS/index.html:23`: `<script src="../modules/MAVLink/mavlink.js"></script>`, the
  dialect SimpleGCS uses; `upstream/modules/MAVLink/mavlink.js:2014` `MAV_RESULT_IN_PROGRESS = 5`, then
  `:2028` `MAV_RESULT_COMMAND_LONG_ONLY = 7` — there is no value 6.
- `packages/mavlink/definitions/common.xml:2345-2371` (`<enum name="MAV_RESULT">`): entries 0-5, then
  `:2365` `<entry value="7" name="MAV_RESULT_COMMAND_LONG_ONLY">` and value 8; no entry with value 6.
- The firmware tree's MAVLink submodule (`upstream/modules/ardupilot/modules/mavlink`) is empty, and
  no ArduPilot source at `f3836cf` references `MAV_RESULT_CANCELLED`.

The `CANCELLED` branch is unreachable, but the output it is said to lose cannot be shown to be right:
the dialect the original was generated from has no `MAV_RESULT` with value 6, so for that dialect
`RESULT 6` (an unknown value) is consistent. Stays reproduced.

## 67. Video settings check a trimmed host and path but save them untrimmed

Row: `SimpleGCS/video.js` `openSettings`. "Entering `cam` passes the blank check and is stored with
the spaces, giving `http:// cam :8889/...` URLs that fail to load."

**Verdict: NOT PROVEN.**

Test: `Simple GCS #67: video settings checked trimmed, saved untrimmed > rejects a blank host but
stores " cam " with its spaces`. The original `openSettings` stores nothing for a host of three
spaces; for `cam` it stores `video.host = " cam "`, and the original `_webRTCOptions` / `_hlsUrl`
give `http:// cam :8889/stream/whep` and `http:// cam :8888/stream/index.m3u8`, which the WHATWG
`URL` parser rejects (`TypeError`).

Evidence: `upstream/SimpleGCS/video.js:373`: `if (!host.trim() || !path.trim()) return;`, then
`:375` `this.host = host;` and `:379` `localStorage.setItem("video.host", host);`.

The check only rejects entries that are entirely blank, and the code then stores what the user typed.
Nothing in the page says surrounding spaces are to be removed; a host with spaces is invalid input
that the original passes through unchanged. The failure is on user input the code never claims to
accept. Stays reproduced.

## 122. A rejected Google Maps load is cached for the page's lifetime

Row: `SimpleGCS/util.js` `GMapsLoader.load` (`loadPromise` kept on rejection). "A Google provider
applied with no key caches the "GMAPS_API_KEY missing" rejection; a key entered later is ignored
until reload."

**Verdict: NOT PROVEN.**

Tests: `Simple GCS #122: a rejected Google Maps load is cached > load('') then load('k1') both reject
with the missing-key error; no script is added` and `... > the key dialog tells the user to refresh
the page to apply a new key`.

Evidence:

- `upstream/SimpleGCS/util.js:85-92`: `if (loadPromise) { return loadPromise; }` and
  `return reject(new Error('GMAPS_API_KEY missing'));` (only the script `onerror`, `:109`, clears
  `loadPromise`).
- `upstream/SimpleGCS/app.js:556-558`: saving a key does `localStorage.setItem('gcs.gmaps.apikey',
newKey);` / `window.GMAPS_API_KEY = newKey;` /
  `window.GCSUtils.toast("API key saved. Refresh page to apply.");`.

The page itself tells the user that a new key takes effect only after a reload, which is exactly what
the cached rejection produces. The behaviour matches the stated intent; stays reproduced.

## 123. WHEP session DELETE result is never observed

Row: `SimpleGCS/vendor/mediamtx/reader.js` `#handleError` (DELETE `fetch`). "A failed DELETE while
handling a reader error (session URL set) is an unhandled promise rejection."

**Verdict: NOT PROVEN.**

Test: `Simple GCS #123: WHEP session DELETE result is never observed > calls fetch(DELETE) and never
attaches then/catch/finally to its result`. The original reader with fake peer connections and WHEP
server (OPTIONS 204, POST 201 with `Location: /stream/whep/abc`, answer rejected) requests `OPTIONS`,
`POST`, then `DELETE https://cam.example:8889/stream/whep/abc`, reports
`Error: Failed to set remote answer sdp, retrying in some seconds`, and never calls `then`, `catch` or
`finally` on the DELETE result.

Evidence: `upstream/SimpleGCS/vendor/mediamtx/reader.js:419-424`:
`if (this.#sessionUrl !== null) { fetch(this.#sessionUrl, { method: "DELETE", }); this.#sessionUrl =
null; }`. The file is vendored unchanged from MediaMTX v1.21.0
(`upstream/SimpleGCS/vendor/mediamtx/README.md:1-2`).

The DELETE is fire-and-forget: the reader goes on to the same restart whatever the DELETE does, and
no output of the tool depends on its result. A failed DELETE surfaces only as an unhandled-rejection
console report; nothing states that the result was meant to be awaited or reported. Stays
reproduced.
