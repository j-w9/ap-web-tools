# DFU Loader: bug proofs

Verdicts for every DFU Loader row in [`../upstream-bugs.md`](../upstream-bugs.md) (and the matching
"Upstream bugs reproduced" list in [`../audit/dfu-loader.md`](../audit/dfu-loader.md), which names the
same bugs). Reproductions: `proofs/dfu-loader/dfu-loader.test.ts`, which runs `upstream/DFULoader`
(`dfu.js`, `dfuse.js`, `dfu-util.js`) in `node:vm` on a fake DOM and a scripted DfuSe device
(`proofs/dfu-loader/_harness.ts`). Line numbers are for the files under `upstream/DFULoader/`.

No USB DFU 1.1, DfuSe or Intel HEX specification text is available locally, so no verdict here rests
on one. Browser behaviour is cited only where `node_modules/typescript/lib/lib.dom.d.ts` (MDN text)
states it.

| Row (`upstream-bugs.md` line) | Bug                                                  | Verdict                                                          |
| ----------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| 51                            | Intel HEX extended linear address records ignored    | **PROVEN** (512 KiB clause mis-described); FIXED                 |
| 52                            | Start address change leaves upload size above max    | NOT PROVEN                                                       |
| 53                            | "Converted Hex to bin" never shown                   | **PROVEN** (presentation); FIXED                                 |
| 54                            | Functional descriptor properties line overwritten    | **PROVEN** (presentation; successful connects); FIXED, no change |
| 55                            | Undefined `dnloadButton` and `commandName`           | **PROVEN** (both); FIXED                                         |
| 143                           | Properties line stays after a failed connect         | NOT PROVEN                                                       |
| 144                           | Start address verdict survives a reconnect           | **PROVEN**; FIXED                                                |
| 145                           | Enter in a DfuSe field starts flashing               | NOT PROVEN                                                       |
| 146                           | Flash Bootloader can be pressed again during a flash | NOT PROVEN (stays a deliberate fix, by policy)                   |
| 147                           | `abortToIdle` prints `state.state` of a number       | **PROVEN** (unreachable from the page); FIXED                    |
| 148                           | `waitDisconnected` timeout passes `reject`           | **PROVEN**; FIXED                                                |
| 149                           | Crashes on unusual devices (five sites)              | 3 sites **PROVEN** (FIXED, no change needed), 2 NOT PROVEN       |

Counts: 12 rows; 7 PROVEN, 4 NOT PROVEN, row 149 split (parseSubDescriptors, erase, autoConnect
PROVEN; open, fixInterfaceNames NOT PROVEN).

---

## Row 51: Intel HEX extended linear address records ignored

> `DFULoader/dfu-util.js` `parseIntelHex` (`baseAddr` computed, never used; 512 KiB buffer). A HEX
> file crossing a 64 KiB boundary has its segments overlaid; bytes beyond 512 KiB are dropped; the
> start address always comes from the DfuSe field. Reproduced.

**Verdict: PROVEN** for the overlay. The "bytes beyond 512 KiB are dropped" clause is mis-described,
and the start-address clause is not a bug claim that can be proven.

**Status: FIXED.** Port: `apps/dfu-loader/src/dfu/util.ts` `parseIntelHex` applies
type 4 records (offset `baseAddr + addr - origin`, origin the lowest base used by a data record). Test:
`apps/dfu-loader/src/dfu/util.test.ts` › `parseIntelHex` › `places 8 KiB at 0x0800F000 contiguously
across the 64 KiB boundary (upstream overlays it)` (and the 64 bytes at 0x0807FFF0 case); every file
inside one segment still converts exactly as upstream.

**Tests:** `R51: parseIntelHex places data records at their 16-bit address and never applies type 4
records`; `R51: offsets never pass 0xFFFF + 255, so nothing is ever written near the 512 KiB end of the
buffer`.

**Reproduction:** 8 KiB at absolute 0x0800F000 (type 4 record 0x0800, 4 KiB of data, type 4 record
0x0801, 4 KiB of data) converts to a 0x10000-byte image: the upper 4 KiB at offset 0x0000, the lower
4 KiB at 0xF000, zeros between. The two halves are swapped and separated by 56 KiB of zeros.

**Evidence (contradicts itself):** the code reads the extended linear address into a variable named for
the base address and then places data at a variable named "absolute address" computed from the 16-bit
offset alone; `baseAddr` is never read:

- `dfu-util.js:492` `let baseAddr = 0;`
- `dfu-util.js:501-502` `if (type === 0) { // data record` / `const absAddr = addr;`
- `dfu-util.js:507-508` `} else if (type === 4) { // extended linear address` /
  `baseAddr = parseInt(bytes, 16) << 16;`

**512 KiB clause (mis-described):** `addr` is `parseInt(line.substr(3, 4), 16)` (`dfu-util.js:497`),
at most 0xFFFF, and `len` is two hex digits (`dfu-util.js:496`), at most 0xFF, so no write ever lands
past offset 0x100FE of the 512 KiB buffer (`dfu-util.js:490`). Nothing is dropped at 512 KiB; data
beyond 64 KiB is overlaid instead (second test: 128 KiB in converts to 64 KiB out). The comment
`// Allocate up to 512KB` (`dfu-util.js:490`) states the cap as intended.

**Start address clause:** the page offers the DfuSe Start Address field for this
(`index.html:89-90`); nothing in the original says a HEX file should override it. Not a proven bug.

**Minimal correct behaviour:** every data record lands at an offset equal to its absolute address
(`baseAddr + addr`) minus a single origin, so the image is contiguous in absolute-address order. To keep
upstream's result for every file it already handles (a file inside one 64 KiB segment comes out at its
segment-relative offset, see the test), the origin is the lowest extended linear base in effect for any
data record. The 512 KiB cap and the start address field stay as they are.

**Smallest port change:** in `apps/dfu-loader/src/dfu/util.ts` `parseIntelHex`, track `baseAddr` from
type 4 records and, in a first pass, the lowest base used by a data record; write each byte at
`baseAddr + addr - origin`.

---

## Row 52: Start address change leaves the upload size above its new max

> `DFULoader/dfu-util.js` start address `change` handler (sets `dfuseUploadSize.max` only). Choosing a
> higher start address (e.g. 0x08020000 on an F4) makes the form invalid and Flash Bootloader refuses
> until the upload size is edited. Reproduced.

**Verdict: NOT PROVEN.**

**Test:** `R52: a start address change lowers the upload size max but not its value`.

**Reproduction (certain):** on an F4 map, connecting sets value and max to 1048576; changing the start
address to `0x08020000` leaves value 1048576 and sets max to 917504 (`dfu-util.js:450`
`dfuseUploadSize.max = device.getMaxReadSize(address);`).

**Why not proven:** the effect claimed (form invalid, Flash refuses) depends on the browser treating a
script-set number above `max` as a range overflow. That cannot be run in `node:vm`, and the only local
description of the constraint qualifies it with user editing:
`lib.dom.d.ts:37725` "The read-only **`rangeOverflow`** property of the ValidityState interface
indicates if the value of an <input>, after having been edited by the user, does not conform to the
constraints set by the element's max attribute." The value here was set by script
(`dfu-util.js:396`). Nothing in the original states what the upload size (a field for uploads the page
never performs) should do on a start address change. Stays reproduced.

---

## Row 53: "Converted Hex to bin" never shown

> `DFULoader/dfu-util.js` firmware `change` handler (`logInfo` with no log context). Message is
> dropped. Reproduced.

**Verdict: PROVEN** (presentation only; no computed value changes).

**Status: FIXED.** Port: `apps/dfu-loader/src/dfu/session.ts` `chooseFile` adds the
entry whether or not a flash is running. Tests: `apps/dfu-loader/src/dfu/session.test.ts` ›
`flashes a converted .hex to a manifestation tolerant device` (upstream log `[]`, port log
`[Converted Hex to bin]`; after the flash both logs are identical) and `logs nothing when a .bin file
is chosen, as upstream`.

**Test:** `R53: "Converted Hex to bin" is dropped when no flash is running`. Choosing `bootloader.hex`
converts the file (the flash writes the 4 decoded bytes, `[1, 2, 3, 4]`) and the download log stays
empty.

**Evidence (contradicts itself):** the handler's only purpose for this line is to show the message, but
the logger drops everything while no flash is running, and choosing a file is not part of a flash:

- `dfu-util.js:521-523` `if (file.name.endsWith('.hex')) {` / `firmwareFile = parseIntelHex(firmwareFile);`
  / `logInfo("Converted Hex to bin");`
- `dfu-util.js:178-179` `function logInfo(msg) {` / `if (logContext) {`
- `logContext` starts `null` (`dfu-util.js:159`) and is set only for a flash: `setLogContext(downloadLog);`
  (`dfu-util.js:539`), reset by `setLogContext(null);` (`dfu-util.js:552`, `dfu-util.js:568`).

So the call can take effect only if a file is chosen while a flash is running; in the flow it was
written for (choose a file, then flash) it never does, like a condition that can never be true.

**Minimal correct behaviour:** after a `.hex` file is converted, "Converted Hex to bin" appears in the
download log (it is cleared by the next flash, `dfu-util.js:540`, as every log entry is).

**Smallest port change:** `apps/dfu-loader/src/dfu/session.ts:491` appends through `appendLog`, which
is gated by `this.logging` (`session.ts:220`); append this one entry regardless of `logging`.

---

## Row 54: Functional descriptor properties line overwritten

> `DFULoader/dfu-util.js` `connect` (`dfuDisplay.textContent +=`, then `=`). The `WillDetach=...,
Version=...` line is computed but never visible. Port shows it (presentation).

**Verdict: PROVEN** for successful connects (presentation only). "Never visible" is mis-described for
failed connects: row 143 shows the line staying visible when connecting stops.

**Status: FIXED (no port change needed).** The port already shows the line
(`apps/dfu-loader/src/ui/DeviceInfo.tsx:28`), pinned by `session.test.ts` › `connect` tests reading
`connected.properties`.

**Test:** `R54: on a successful connect the properties line is appended, then overwritten`. After a
successful F4 connect `#dfuInfo` is exactly the summary line and the memory summary; it contains no
`WillDetach`.

**Evidence (contradicts itself):** the line is appended to the display, then the display is replaced
unconditionally on the only path that continues past it:

- `dfu-util.js:306-307` `let info = \`WillDetach=${desc.WillDetach}, ...\`;`/`dfuDisplay.textContent += "\n" + info;`
- `dfu-util.js:373` `dfuDisplay.textContent = formatDFUSummary(device) + "\n" + memorySummary;`

A write to the page that a later unconditional write always replaces before the page can show it is a
dead store: the `+=` exists only to display the line.

**Minimal correct behaviour:** after a successful connect the properties line is shown with the device
info.

**Smallest port change:** none; the port already shows it
(`apps/dfu-loader/src/ui/DeviceInfo.tsx:28`).

---

## Row 55: Undefined `dnloadButton` and `commandName`

> `DFULoader/dfu-util.js` `connect`; `dfuse.js` `dfuseCommand`. A DFU interface without CanDnload, or a
> failed DfuSe command, throws a ReferenceError whose text is shown. Port shows a descriptive error
> (crash clause).

**Verdict: PROVEN** (both).

**Status: FIXED.** `dnloadButton`: `apps/dfu-loader/src/dfu/session.ts` `connect`
finishes connecting and sets `flashEnabled: false` for a DFU-mode interface with CanDnload=false
(it used to refuse with an error). Test: `apps/dfu-loader/src/dfu/session.test.ts` › `connect` ›
`connects a DFU interface that cannot download with Flash Bootloader disabled (upstream throws)`.
`commandName`: no port change needed (`apps/dfu-loader/src/dfu/dfuse.ts:132`), pinned by
`dfu.test.ts` (upstream `ReferenceError: commandName is not defined`).

**Tests:** `R55: a DFU interface without CanDnload throws ReferenceError: dnloadButton is not defined`
(status shows `ReferenceError: dnloadButton is not defined`, the page stays disconnected);
`R55: a failed DfuSe command throws ReferenceError: commandName is not defined` (an ERASE_SECTOR whose
GETSTATUS reports status 0x0B rejects with `ReferenceError: commandName is not defined`).

**Evidence (fails: the original throws):**

- `dfu-util.js:317-318` `if (!desc.CanDnload) {` / `dnloadButton.disabled = true;`. No `dnloadButton`
  is declared anywhere in `upstream/DFULoader`; the button is `let downloadButton =
document.querySelector("#download");` (`dfu-util.js:224`).
- `dfuse.js:99` `throw "Special DfuSe command " + commandName + " failed";`. No `commandName` is
  declared; the table is `const commandNames = {` (`dfuse.js:74`), used as intended three lines earlier:
  `throw "Error during special DfuSe command " + commandNames[command] + ":" + error;` (`dfuse.js:94`).

**Minimal correct behaviour:**

- `dnloadButton`: no ReferenceError; for a DFU-mode interface reporting CanDnload=false, Flash
  Bootloader ends disabled (the stated intent of `dfu-util.js:317-318`). A literal rename is not
  enough: `dfu-util.js:380-382` (`// DFU` / `downloadButton.disabled = false;`) re-enables it later in
  the same connect, so the fix must keep it disabled.
- `commandName`: the rejection is `Special DfuSe command ERASE_SECTOR failed` (the command's name from
  `commandNames`).

**Smallest port change:** `commandName`: none, the port already throws that text
(`apps/dfu-loader/src/dfu/dfuse.ts:132`). `dnloadButton`: the port refuses to connect with an error
(`session.ts:311-313`); to match the original's intent instead, finish connecting and set
`flashEnabled: false` when `protocol === 0x02 && !desc.CanDnload`. Either way nothing can be flashed;
the decision is whether the device shows as connected.

---

## Row 143: Properties line stays after a failed connect, and accumulates

> `DFULoader/dfu-util.js` `connect` (`dfuDisplay.textContent += "\n" + info` before the steps that can
> throw). With a non-DfuSe name or CanDnload=false the line stays visible (correcting the "never
> visible" row above), once more per attempt, until a disconnect. Reproduced.

**Verdict: NOT PROVEN.**

**Test:** `R143: after a failed connect the properties line stays, once more per attempt`. Interface
name `Bootloader`: status `Not a DfuSe memory descriptor: "Bootloader"`, `#dfuInfo` is
`"\n" + properties`; a second attempt makes it `"\n" + properties + "\n" + properties`.

**Why not proven:** the line shown is the device's true functional descriptor, which `dfu-util.js:307`
means to display. Nothing in the original says what `#dfuInfo` should hold after a failed connect, and a
repeated line on retries is a UI quirk with no stated intent. Stays reproduced.

---

## Row 144: Start address verdict survives a reconnect

> `DFULoader/dfu-util.js` `connect` sets `dfuseStartAddressField.value` without `setCustomValidity("")`.
> After "Address outside of memory map", reconnecting resets the address but Flash Bootloader still
> refuses until the field is edited. Reproduced.

**Verdict: PROVEN.**

**Status: FIXED.** Port: `apps/dfu-loader/src/dfu/session.ts` `connect` sets
`customValidity: ''` with the first writable segment address. Test:
`apps/dfu-loader/src/dfu/session.test.ts` › `start address field` › `runs the change handler only when
the text changed, as the browser fires change` (after the reconnect upstream keeps `Address outside of
memory map`, the port has `''` and validates; every other field is identical).

**Test:** `R144: the start address custom validity survives a reconnect and blocks Flash Bootloader`.
Connect an F4, enter `0x1000` (custom validity `Address outside of memory map`), disconnect, reconnect:
the field holds `0x8000000` and still carries `Address outside of memory map`; with a firmware chosen,
Flash Bootloader returns `false` and sends no USB transfer. Entering the same `0x8000000` through the
field gives an empty custom validity.

**Evidence (contradicts itself; fails to produce what its UI offers):**

- Connect writes a known-good address but leaves the old verdict: `dfu-util.js:393-394`
  `device.startAddress = segment.start;` / `dfuseStartAddressField.value = "0x" + segment.start.toString(16);`
  (no `setCustomValidity` anywhere in `connect`, `dfu-util.js:286-407`).
- The page's own rule judges that address valid: `dfu-util.js:447-449`
  `if (device.getSegment(address) !== null) {` / `device.startAddress = address;` /
  `field.setCustomValidity("");`. The field therefore says "Address outside of memory map" about an
  address the same page says is inside it.
- Flash refuses an invalid form: `dfu-util.js:533-535` `if (!configForm.checkValidity()) {` /
  `configForm.reportValidity();` / `return false;`.
- A non-empty custom validity message makes the control fail validation (`lib.dom.d.ts:17395` "Use the
  empty string to indicate that the element does not have a custom validity error."; `lib.dom.d.ts:37713`
  "**`customError`** ... returns true if an element doesn't meet the validation required in the custom
  validity set by the element's setCustomValidity() method"), and the form's `checkValidity()` "returns a
  boolean value which indicates if all associated controls meet any constraint validation rules"
  (`lib.dom.d.ts:18176`). The harness models only this custom-validity constraint.

**Minimal correct behaviour:** when connecting sets the start address to the first writable segment,
its custom validity is cleared, so a valid address does not block Flash Bootloader.

**Smallest port change:** in `apps/dfu-loader/src/dfu/session.ts` `connect`, add `customValidity: ''`
to the `startAddress` patch (`session.ts:354-355`).

---

## Row 145: Enter in a DfuSe field starts flashing

> `DFULoader/index.html` (`#download` is the first submit button of `#configForm`). Pressing Enter to
> confirm the start address or upload size submits the form, which clicks Flash Bootloader. Reproduced.

**Verdict: NOT PROVEN.**

**Test:** `R145: Flash Bootloader is a button without a type inside #configForm, next to the DfuSe text
fields` (`index.html:102` `<button id="download" disabled="true">Flash Bootloader</button>` is the
form's only button; `index.html:90` and `index.html:92` are the text and number fields).

**Why not proven:** implicit submission on Enter is browser behaviour that cannot run in `node:vm`,
and no local source describes it. Nothing in the original states that Enter in these fields must not
submit the form whose only button is Flash Bootloader. Stays reproduced.

---

## Row 146: Flash Bootloader can be pressed again during a flash

> `DFULoader/dfu-util.js` download `click` handler (no busy state). A second press clears the log and
> starts a second download whose transfers interleave with the first. Deliberately fixed (2026-10-03,
> see `docs/porting-policy.md`): presses are ignored while flashing.

**Verdict: NOT PROVEN** as a bug by this standard. The deliberate fix stands as a policy decision
(`docs/porting-policy.md:43`), not as a proof.

**Test:** `R146: a second press during a flash clears the log and starts a second download`. Two
presses of a 2048-byte flash send two ERASE_SECTOR 0x08000000 commands and 4 data blocks (two
downloads), and the log ends with a single `Done!`.

**Why not proven:** the reproduction shows two overlapping downloads (`dfu-util.js:530-571` has no busy
check; `clearLog(downloadLog)` at `dfu-util.js:540`). Whether the interleaved control transfers fail or
corrupt flash depends on how a DFU/DfuSe device answers requests out of sequence, which needs the DFU
1.1 / DfuSe state machine; no such specification is available locally, and the fake device is not a
reference. `porting-policy.md:43` describes the transfers as ones that "corrupt the write"; that claim is
not established by a local reference.

---

## Row 147: `abortToIdle` prints `state.state` of a number

> `DFULoader/dfu.js` `abortToIdle`. The message ends "state undefined". Not reachable from the page.
> Reproduced.

**Verdict: PROVEN** (not reachable from the page: `abortToIdle` is called only from `do_upload`,
`dfu.js:547`, `dfuse.js:291`, `dfuse.js:294`, and the page never uploads).

**Status: FIXED.** Port: `apps/dfu-loader/src/dfu/dfu.ts` `abortToIdle` interpolates
the state. Test: `apps/dfu-loader/src/dfu/dfu.test.ts` › `fails abort-to-idle when the device stays in
error, naming the state (upstream: "state undefined")` (upstream `... state undefined`, port
`... state 10`; transfers and logs identical).

**Test:** `R147: abortToIdle reports "state undefined"`. A device left in state 5 after ABORT rejects
with `Failed to return to idle state after abort: state undefined`.

**Evidence (contradicts itself):** `state` is the number `getState` resolves to, so `state.state` is
always undefined:

- `dfu.js:497-499` `dfu.Device.prototype.getState = function() {` /
  `return this.requestIn(dfu.GETSTATE, 1).then(` / `data => Promise.resolve(data.getUint8(0)),`
- `dfu.js:510` `let state = await this.getState();`; `dfu.js:515-516` `if (state != dfu.dfuIDLE) {` /
  `throw "Failed to return to idle state after abort: state " + state.state;`

**Minimal correct behaviour:** the message ends with the state number (`... state 5`).

**Smallest port change:** `apps/dfu-loader/src/dfu/dfu.ts:597`: interpolate `state`.

---

## Row 148: `waitDisconnected` timeout passes `reject` to `setTimeout`

> `DFULoader/dfu.js` `waitDisconnected` (`onTimeout` defined, never used). A timeout rejects with no
> reason and leaves the `disconnect` listener attached. The page only logs it. Reproduced.

**Verdict: PROVEN** (effect on the page: none visible; `dfu-util.js:559-562` only logs to the console).

**Status: FIXED.** Port: `apps/dfu-loader/src/dfu/dfu.ts` `waitDisconnected` uses
the timeout handler as written. Test: `apps/dfu-loader/src/dfu/dfu.test.ts` › `times out with
"Disconnect timeout expired" and removes its listener (upstream: no reason, listener stays)` (upstream
rejects with `undefined` and keeps 1 listener; the port rejects with `Disconnect timeout expired` and
keeps 0).

**Test:** `R148: waitDisconnected rejects with no reason on timeout and leaves its listener attached`.
`waitDisconnected(10)` rejects with `undefined` and one `disconnect` listener remains on
`navigator.usb`.

**Evidence (contradicts itself):** the function writes the timeout handler it means to use and then
schedules `reject` instead; `onTimeout` is referenced nowhere:

- `dfu.js:443-448` `function onTimeout() {` /
  `navigator.usb.removeEventListener("disconnect", onDisconnect);` /
  `if (device.disconnected !== true) {` / `reject("Disconnect timeout expired");`
- `dfu.js:449` `timeoutID = setTimeout(reject, timeout);`

**Minimal correct behaviour:** on timeout, the `disconnect` listener is removed and, unless the device
already disconnected, the promise rejects with `Disconnect timeout expired`.

**Smallest port change:** in `apps/dfu-loader/src/dfu/dfu.ts` `waitDisconnected`, replace
`setTimeout(() => reject(), timeout)` with a handler that removes `onDisconnect` and rejects with
`new DfuError('Disconnect timeout expired')` when `this.disconnected !== true`.

---

## Row 149: Crashes on unusual devices

> `DFULoader/dfu.js` `open` (`error.endsWith` on a DOMException), `parseSubDescriptors` (zero-length
> descriptor loops forever); `dfuse.js` `erase` (gap in the map); `dfu-util.js` `fixInterfaceNames`
> (interface missing from the descriptor), `autoConnect` (unhandled rejection, undeclared `vidField`).
> TypeError, endless loop or "Connecting..." left showing. Port shows an error (crash clause; see
> `docs/audit/dfu-loader.md`).

Five sites, judged separately.

### `open`: `error.endsWith`: NOT PROVEN

**Test:** `R149 open: a redundant SET_INTERFACE failure is recognised only when the rejection is a
string`. With two alternates, a rejection `"NetworkError: Unable to set device interface."` gives the
warning `Redundant SET_INTERFACE request to select altSetting 0 failed`; an `Error` rejection gives
`TypeError: error.endsWith is not a function`.

**Why not proven:** `dfu.js:117-118` (`if (intf.alternate.alternateSetting == altSetting &&` /
`error.endsWith("Unable to set device interface.")) {`) works for a string rejection and throws for an
object. Which one the browser's `selectAlternateInterface` rejects with is WebUSB behaviour that no
local source states.

### `parseSubDescriptors`: zero-length descriptor: PROVEN

**Status: FIXED (no port change needed)** (`apps/dfu-loader/src/dfu/dfu.ts:266-267`).

**Test:** `R149 parseSubDescriptors: a zero-length descriptor never terminates`. Bytes
`[0, 5, 0, 0]` run until the vm's 200 ms timeout (`Script execution timed out after 200ms`).

**Evidence (fails: hangs):** with `bLength` 0 the remaining view is rebuilt from the same bytes, so the
loop condition never changes: `dfu.js:319` `while (remainingData.byteLength > 2) {`, `dfu.js:320`
`let bLength = remainingData.getUint8(0);`, `dfu.js:347`
`remainingData = new DataView(remainingData.buffer.slice(bLength));`.

**Minimal correct behaviour:** parsing terminates on a zero-length descriptor (an error is acceptable).

**Smallest port change:** none; the port throws `Malformed configuration descriptor: zero-length
descriptor` (`apps/dfu-loader/src/dfu/dfu.ts:266-267`).

### `erase`: range across a gap in the memory map: PROVEN

**Status: FIXED (no port change needed)** (`apps/dfu-loader/src/dfu/dfuse.ts:203`, pinned by
`dfu.test.ts`, which expects `Address 8008000 outside of memory map` where upstream throws a
TypeError).

**Test:** `R149 erase: a range across a gap in the memory map throws a TypeError`. Map
`@Flash /0x08000000/01*016Kg/0x08008000/01*016Kg`, erase 0x9000 bytes from 0x08000000: one
ERASE_SECTOR 0x08000000, then `TypeError: Cannot read properties of null (reading 'erasable')`.

**Evidence (fails: throws):** `getSegment` returns `null` for an unmapped address (`dfuse.js:114`
`return null;`), and the loop dereferences it without a check: `dfuse.js:196-199`
`if (segment.end <= addr) {` / `segment = this.getSegment(addr);` / `}` / `if (!segment.erasable) {`.
For unmapped addresses the same file's stated outcome is a descriptive error: `dfuse.js:122-123`
`if (!segment) {` / ``throw `Address ${addr.toString(16)} outside of memory map`;``.

**Minimal correct behaviour:** no TypeError; the erase stops with `Address 8004000 outside of memory
map`.

**Smallest port change:** none; the port throws that error (`apps/dfu-loader/src/dfu/dfuse.ts:203`).

### `fixInterfaceNames`: interface missing from the descriptor: NOT PROVEN

**Test:** `R149 fixInterfaceNames: an interface missing from the configuration descriptor throws a
TypeError`. The browser reports interface 0 with no name; the configuration descriptor lists only
interface 1; status `TypeError: Cannot read properties of undefined (reading '0')`
(`dfu-util.js:89` `intf.name = mapping[configIndex][intfNumber][alt];`).

**Why not proven:** the input needs the browser's parsed `device.configurations` to disagree with the
configuration descriptor the device returns. Whether a browser can ever present such a device cannot be
established from local sources.

### `autoConnect`: unhandled rejection and undeclared `vidField`: PROVEN

**Status: FIXED (no port change needed)**: the port has no `vidField` and shows the error
(`apps/dfu-loader/src/dfu/session.ts` `autoConnect`).

**Tests:** `R149 autoConnect: the undeclared vidField throws after a successful connect (unhandled)`
(landing-page serial, F4 device: connected, then an unhandled `ReferenceError: vidField is not
defined`); `R149 autoConnect: a failed connect is an unhandled rejection and leaves "Connecting..."`
(interface name `Bootloader`: unhandled rejection `Not a DfuSe memory descriptor: "Bootloader"`, status
stays `Connecting...`).

**Evidence (fails: the original throws, uncaught):**

- `dfu-util.js:434` `vidField.value = "0x" + hex4(matching_devices[0].device_.vendorId).toUpperCase();`.
  No `vidField` is declared in `upstream/DFULoader` and `index.html` has no VID field.
- `dfu-util.js:410-411` `dfu.findAllDfuInterfaces().then(` / `async dfu_devices => {` has no rejection
  handler, while `dfu-util.js:427-430` sets `'Connecting...'` and awaits `connect(device)`, which
  rethrows (`dfu-util.js:323` constructs `dfuse.Device`, whose `parseMemoryDescriptor` throws at
  `dfuse.js:27`). The Connect button path catches the same errors and shows them: `dfu-util.js:481-482`
  `}).catch(error => {` / `statusDisplay.textContent = error;`.

**Minimal correct behaviour:** no ReferenceError after an automatic connect (the `vidField` write
removed; `vid` still updated); a failed automatic connect shows its error in the status, as the Connect
button does.

**Smallest port change:** none; the port has no `vidField` and shows the error
(`apps/dfu-loader/src/dfu/session.ts:384-387`).
