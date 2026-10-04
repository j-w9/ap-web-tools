# Video Overlay: bug proofs

Verdicts for the Video Overlay rows of [`../upstream-bugs.md`](../upstream-bugs.md), under the
[standard](README.md). Reproductions: `proofs/video-overlay/video-overlay.test.ts` (harness
`proofs/video-overlay/_harness.ts`, which cuts the original functions out of
`upstream/VideoOverlay/VideoOverlay.js` and runs them in `node:vm`, loads both original `SandBox.js`
files into one context, and imports the original `JsDataflashParser`).

| #   | Bug                                                                    | Verdict       |
| --- | ---------------------------------------------------------------------- | ------------- |
| 118 | Overlay file with neither `widgets` nor `widget` shows `[object File]` | NOT PROVEN    |
| 119 | Widget scripts reading an instanced message without an instance throw  | PROVEN, FIXED |
| 120 | A video without an audio track stops the video panel part way          | PROVEN, FIXED |
| 121 | Log duration and default offset from first/last records by position    | NOT PROVEN    |
| 165 | Sandbox widgets run their script twice when the frame loads            | NOT PROVEN    |
| 166 | A log that fails to parse is still sent to widgets later               | NOT PROVEN    |

PROVEN: 2. NOT PROVEN: 4.

## 118. Overlay file with neither `widgets` nor `widget` reports `Unable to load from: [object File]`

Row: `VideoOverlay/VideoOverlay.js`, overlay input handler. "The `File` object is concatenated into
the alert text. Reproduce: load `{"header":{"tool":"videoOverlay"}}`."

**Verdict: NOT PROVEN.**

Test: `Video Overlay #118: overlay file with neither widgets nor widget > alerts "Unable to load
from: [object File]"`. The original handler, given a `File` holding
`{"header":{"tool":"videoOverlay"}}`, alerts exactly `Unable to load from: [object File]` and calls
neither `load_layout` nor `add_widget`.

Evidence:

- `upstream/VideoOverlay/VideoOverlay.js:572`: `alert("Unable to load from: " + file)`.

The reproduction is exact, but no allowed reference says what text should follow "from:". The alert
fires and does its job (the file is refused); nothing in the page states that the file name (or any
other property) was meant to be shown, so naming one would be a preference. Cosmetic text only;
stays reproduced.

## 119. Widget scripts reading an instanced message without an instance throw

Row: `modules/JsDataflashParser/parser.js`, `checkNumberOfInstances` deletes `OffsetArray`.
"`log.get('IMU', 'GyrX')` in a sandbox script throws a TypeError."

**Verdict: PROVEN** (it fails; it contradicts itself).

Test: `Video Overlay #119: instanced message read without an instance > get() throws a TypeError
where get_instance() and missing data return values`. With the original parser on
`packages/dataflash/test-fixtures/copter-sitl.bin`: `messageTypes.IMU.instances` is
`{"0":"IMU[0]","1":"IMU[1]"}`, the IMU FMT entry has no `OffsetArray`, and `log.get('IMU', 'GyrX')`
throws `TypeError: Cannot read properties of undefined (reading 'length')`. In the same function,
`get('NOSUCH', 'GyrX')`, `get_instance('IMU', 7, 'GyrX')` and `get('ATT', 'NoSuchField')` all return
`undefined`, and `get_instance('IMU', 0, 'GyrX')` returns data.

Evidence:

- `upstream/modules/JsDataflashParser/parser.js:463`: `// Log name, optional instance name, optional field`
  — the instance is documented as optional; `get(name, field)` (`:541-542`) passes `null` for it.
- `parser.js:676`: `delete msg.OffsetArray` — done for every message with an instance field.
- `parser.js:538`: `return parse(msg_FMT.OffsetArray)` → `parse(undefined)`, and `parser.js:478`:
  `const len = offsets.length` throws.
- The function's own contract for missing data is to return `undefined`: `parser.js:468`
  `// no such message`, `:473` `// instance given but no instances or don't have the given instance`,
  `:480` `// no data`, `:511` `// no such field`, each followed by `return`.
- The callers rely on that contract: the shipped widget scripts in
  `upstream/VideoOverlay/Default_Palette.json:470` and `:886` call `logData.log.get(name, field)` when
  no instance is given, then
  ``if (timeUS == null || value == null) { throw new Error(`Unknown log message: ${options.logItem}`) }``. The TypeError bypasses that and is shown instead.

The `TypeError` is a crash reading `.length` of `undefined`, not a designed result: every other
missing-data case of the same function returns `undefined`.

**Minimal correct behaviour:** `get(name, field)` / `get_instance(name, null, field)` on a message
that has instances does not throw; it returns `undefined` like the function's other no-data paths,
so a script's `== null` check reports `Unknown log message: IMU.GyrX`.

**Smallest port change:** in `apps/video-overlay/src/widgets/parser-facade.ts` `get_instance`, return
`undefined` instead of throwing when `instance` is `null`/`undefined` and the message is instanced
(and drop the matching "throws like upstream" expectation in `parser-facade.test.ts`).

**Status: FIXED.** `apps/video-overlay/src/widgets/parser-facade.ts` `get_instance`
returns `undefined` for an instanced message read without an instance (`get('IMU', 'GyrX')`,
`get('IMU')`, `get_instance('IMU', undefined, 'GyrX')`): before, a thrown
`TypeError: Cannot read properties of undefined (reading 'length')`; after, `undefined`. Test:
`apps/video-overlay/src/widgets/parser-facade.test.ts` "returns undefined where upstream throws for an
instanced message read without an instance (proven bug #119)", which asserts upstream's throw and the
port's `undefined` side by side for all three logs; every other comparison with upstream is unchanged.

## 120. A video without an audio track stops the video panel part way

Row: `VideoOverlay/VideoOverlay.js`, `vid-upload` change handler (`audioTrack.codec`). "FPS is shown;
resolution, duration, codec and export size/range are not updated."

**Verdict: PROVEN** (it fails: the original throws and never produces the output its own UI offers).

Tests: `Video Overlay #120: a video without an audio track > with an audio track, fills every info
and export field` and `... > without one (Mediabunny returns null), throws after the FPS and leaves
the rest`. The original handler with a fake Mediabunny input (video track avc 1920x1080 at
29.97 fps, 75 s, format MP4):

- audio track `aac`: FPS `29.97`, codec `avc + aac`, resolution `1920x1080px`, duration `1:15`,
  start 0, end 75, export 1920x1080, `MatchExportFormatToInput("MP4", "avc", "aac", "29.97")`;
- audio track `null`: rejects with `TypeError: Cannot read properties of null (reading 'codec')`; FPS
  `29.97` is shown, every other field is left empty, `MatchExportFormatToInput` is not called.

Evidence:

- `upstream/VideoOverlay/index.html:234`: `<input ... type="file" id="vid-upload" accept="video/*">`
  — any video is offered, with info fields `Resolution` (`:239`), `Duration` (`:242`), `FPS`
  (`:245`), `Codec` (`:248`).
- `upstream/VideoOverlay/VideoOverlay.js:357`: `const audioTrack = await MBInput.getPrimaryAudioTrack()`
  and `:370`: ``codecInfo.textContent = `${vidTrack.codec} + ${audioTrack.codec}` ``.
- Mediabunny 1.40.1 (the version `index.html:8` loads; `node_modules/mediabunny/dist/modules/src/input.d.ts:63-64`):
  `/** Returns the primary audio track of this input file, or null if there are no audio tracks. */`
  `getPrimaryAudioTrack(): Promise<... | null>;`

**Minimal correct behaviour:** for a video with no audio track the handler completes: resolution,
duration, start/end time, export width/height and the format/video-codec/FPS matching are all set as
for a video with audio; only the audio part (audio codec text and audio codec matching) is skipped.

**Smallest port change:** in `apps/video-overlay/src/App.tsx` `openVideo`, remove the early return for
`info.audioCodec === undefined` (and its synthetic error); build the codec text from the video codec
alone when there is no audio track, and skip the audio codec in `matchSelectionToInput` in that case.

**Status: FIXED.** `apps/video-overlay/src/App.tsx` `openVideo` no longer stops for a
video without an audio track; `apps/video-overlay/src/analysis/export-formats.ts` adds
`inputCodecText` (the video codec alone when there is no audio track, upstream's `video + audio`
otherwise) and `matchSelectionToInput` skips the audio codec when `audioCodec` is `undefined`. For the
reproduction input (avc 1920x1080, 29.97 fps, 75 s, MP4, no audio): before, FPS `29.97` and the error
`Cannot read properties of null (reading 'codec')`, nothing else; after, FPS `29.97`, codec `avc`,
resolution `1920x1080px`, duration `1:15`, start 0, end 75, export 1920x1080, and format, video codec
and frame rate matched as for a video with audio. Tests: `apps/video-overlay/src/analysis/export-formats.test.ts`
"matches a video without an audio track except for the audio codec (proven upstream bug #120)" and
"writes the codec info as upstream, and the video codec alone without an audio track (proven bug
#120)"; upstream's result is asserted by the proofs test above.

## 121. Log duration and default offset come from the first and last records by file position

Row: `VideoOverlay/VideoOverlay.js`, `getLogDurationUS`, `setDefaultOffset`. "Logs whose records are
not in time order get a duration/offset from whichever records sit first and last in the file."

**Verdict: NOT PROVEN.**

Test: `Video Overlay #121: log duration and default offset by file position > returns
last-minus-first by position (-4 s) and offsets by the first record (-5 s)`. On a log whose single
timed message has TimeUS 5 000 000 then 1 000 000 in file order, the original `getLogDurationUS`
returns `-4000000` and `setDefaultOffset` writes `-5`.

Evidence: the behaviour is the stated design. `upstream/VideoOverlay/VideoOverlay.js:191` and `:261`:
`// Offset of message, only check first, assume time never goes backwards`. The code
documents its assumption; no allowed reference says out-of-order logs must be handled. Stays
reproduced.

## 165. Sandbox widgets run their script twice when the frame loads

Row: `TelemetryDashboard/Widgets/SandBox.js` and `VideoOverlay/Widgets/SandBox.js` both listen for
`load` and call `init()`. "The script and options are posted twice, so the user script is loaded
twice."

**Verdict: NOT PROVEN.**

Test: `Video Overlay #165: sandbox widget posts its script twice on load > both load listeners call
init()`. Both original files loaded in page order; the iframe of a `WidgetSandBoxVideoOverlay` has two
`load` listeners and firing them posts `{script, options}` twice, identically.

Evidence:

- `upstream/TelemetryDashboard/Widgets/SandBox.js:51-53`: `// Send over user config as soon as iframe
is loaded` / `this.iframe.addEventListener("load", (e) => {` / `this.init()`.
- `upstream/VideoOverlay/Widgets/SandBox.js:43-46`: the same comment and listener, inside the
  `initDone` promise.

Both listeners state the same intent (send the config once the frame has loaded), and the result
meets it. Each script message makes `SandBox.html` start from a fresh div
(`upstream/VideoOverlay/Widgets/SandBox.html:79` `document.body.replaceChildren(user_div)`, from
`load_user_script` at `:155`), so the second post replaces the first. Nothing allowed says the script
must run exactly once. Redundant, but not shown to be wrong; stays reproduced.

## 166. A log that fails to parse is still sent to widgets later

Row: `VideoOverlay/VideoOverlay.js` log input (`log = new DataflashParser()` before `processData`).
"If parsing throws, later `loadLog()` calls (a form change, a dropped widget) send the new file's
buffer. ... neither parser throws for garbage in practice."

**Verdict: NOT PROVEN.**

Test: `Video Overlay #166: a log that fails to parse > stays assigned to the global log, and a later
loadLog() sends its buffer`. With a stand-in parser whose `processData` stores the buffer and
throws, the original log handler rejects, calls no widget `loadLog`, and leaves the global `log` set
to that parser; a later sandbox widget `loadLog()` (original `SandBox.js`) posts
`{ logData: <that buffer> }`.

Evidence: `upstream/VideoOverlay/VideoOverlay.js:514-515` (`log = new DataflashParser()` /
`log.processData(reader.result, [])`); `upstream/VideoOverlay/Widgets/SandBox.js:70`
(`const data = { logData: log.buffer }`).

The trigger needs a stand-in: the row itself notes that the original parser does not throw for
garbage, and no input making it throw is known. Nor does any reference say what should happen to a
log that fails to parse. Unreachable as described; stays reproduced.
