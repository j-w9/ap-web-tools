# MAVLink: bug proofs

Verdicts for the MAVLink rows of [`../upstream-bugs.md`](../upstream-bugs.md), under the standard in
[`README.md`](README.md). Reproductions: `proofs/mavlink/upstream-bugs.test.ts` and
`proofs/mavlink/sha256-length.test.ts`, both running upstream `modules/MAVLink/mavlink.js` (with its
`runtime-fixes.patch` already applied) and its bundled jspack in `node:vm`.

Paths below are relative to `upstream/modules/MAVLink/` unless they start with `packages/` or `apps/`.

| #   | Bug                                                                            | Verdict                                              | Reference                                                                                     |
| --- | ------------------------------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 150 | Parser discards the length a frame claims before checking it                   | PROVEN                                               | Contradicts itself (the `parsePayload` TODO states the intended behaviour)                    |
| 151 | Omitted float values are packed as NaN                                         | NOT PROVEN                                           | jspack documents results for such values as undefined; no in-repo text defines 0              |
| 152 | An omitted numeric array shifts the following fields and corrupts the checksum | NOT PROVEN                                           | Same as #151                                                                                  |
| 153 | -0 is packed as +0                                                             | PROVEN                                               | IEEE 754 binary32 (the format jspack states it implements); its own decoder and rounding path |
| 154 | Some messages cannot be packed                                                 | PROVEN (TEST_TYPES); NOT PROVEN (omitted extensions) | It fails: jspack documents `c` packing and has no encoder for it                              |
| 155 | Frame checksum overwrites a field called `crc`                                 | PROVEN                                               | Contradicts the MAVLink definition (`definitions/cubepilot.xml:39`)                           |
| 156 | SHA-256 length block holds only 32 bits                                        | PROVEN                                               | Mathematics: digest differs from the reference SHA-256 (Node `crypto`)                        |
| 157 | Keys that are not 32 bytes are padded or cut                                   | NOT PROVEN                                           | Keys are defined as 32 bytes; nothing defines the result for other lengths                    |

PROVEN: 5 (counting #154 once). NOT PROVEN: 3. Fixed in `packages/mavlink`: #150,
#153, #154 (TEST_TYPES), #156. No row is mis-described: every effect the rows state
was reproduced exactly (byte values, the 280-byte bound, the `RangeError`/`TypeError` cases).

---

## #150 Parser discards the length a frame claims before checking it

> `modules/MAVLink/mavlink.js` `parsePayload` (slices `expected_length` before `decode`, see its TODO).
> After a false start marker in noise or a corrupted length byte, the parser waits for and then drops
> up to 280 bytes, losing good frames inside them (CRC failure, unknown flags).

**Verdict: PROVEN** (contradicts itself).

**Reproduction:** `#150 parser discards the length a frame claims before checking it > drops a good
frame that starts inside a false start`. Two HEARTBEATs (seq 0 and 1) each decode alone. Preceded by
the three bytes `FD 05 00`, the parser cuts 17 bytes (`5 + 10 + 2`) as one frame: the false start plus
the first 14 bytes of the seq-0 HEARTBEAT. Output: `BAD_DATA "Unknown MAVLink message ID (65792)"`,
`BAD_DATA "Bad prefix (2)"`, `HEARTBEAT` seq 1. The seq-0 frame, which starts 3 bytes in, is lost.

**Evidence:** the same function states what must happen when the cut frame is not well formed,
`mavlink.js:19176-19182`:

```js
var mbuf = this.buf.slice(0, this.expected_length)

// TODO: slicing off the buffer should depend on the error produced by the decode() function
// - if we find a well formed message, cut-off the expected_length
// - if the message is not well formed (correct prefix by accident), cut-off 1 char only
this.buf = this.buf.slice(this.expected_length)
```

The code then cuts `expected_length` whatever `decode` reports. The bound in the row is right:
`expected_length` is at most 255 + `HEADER_LEN` 10 (`mavlink.js:99`) + 2 + `MAVLINK_SIGNATURE_BLOCK_LEN`
13 (`mavlink.js:114`) = 280.

**Minimal correct behaviour:** when the bytes taken as a frame fail as "not well formed" (the frame
checksum does not match, or the incompatibility flags are unsupported), only the first byte is
discarded and the search for a start marker resumes at the next byte, so the seq-0 HEARTBEAT above is
decoded. Well-formed frames (checksum good, including a signature failure) are still consumed whole.
Unknown message IDs cannot be checked without their CRC_EXTRA; the TODO does not settle them, so they
keep upstream's behaviour.

**Smallest port change:** `packages/mavlink/src/parser.ts` `next()` (line 191): when `decode` returns a
`garbage` event with reason `crc` or `incompat-flags`, report and drop only the first byte
(advance the read position by one byte from the frame start) instead of the whole `take(frameLength)`.

**Status: FIXED** for the cases the minimal behaviour above covers (checksum and
incompatibility-flag failures). `packages/mavlink/src/parser.ts` `next()` takes a copy of the claimed
frame without consuming it; when `decode` refuses it for its checksum or its incompatibility flags (the
only `garbage` events `decode` returns, now carrying just the marker byte), the read position advances
by one byte, otherwise by the whole frame. Before/after, input `FD 28 00 00 00 01 01 00 00 00` + a
HEARTBEAT + 30 zero bytes + an ATTITUDE (`parser.oracle.test.ts`): upstream gives `BAD_DATA` (invalid
CRC), `BAD_DATA` (bad prefix), `ATTITUDE`; the port gives `garbage:crc` (1 byte), `garbage:noise`,
`HEARTBEAT`, `garbage:noise`, `ATTITUDE`.

**Not changed: the reproduction input above.** Its 17 claimed bytes are refused as an unknown message
id (65792), which this entry leaves with upstream's behaviour. On `FD 05 00` + two HEARTBEATs the port
still gives `unknown`, `garbage:noise` (7 bytes), `HEARTBEAT` seq 1, losing seq 0 as upstream does.

Tests: in `packages/mavlink/src/parser.oracle.test.ts` every comparison now runs upstream with its TODO
applied (`applyResyncTodo` in `test-utils/upstream.ts`) and, where no frame fails on its checksum or
flags, asserts unpatched upstream gives exactly the same result. `a false start marker in noise no
longer swallows the frames inside its claimed length (proven bug #150)`, `a corrupted length byte no
longer discards the frames inside the bytes it claims (proven bug #150)`, `a bad checksum drops the
start marker, ...`, `truncated frames wait for the claimed length, then fail` and `refuses
incompatibility flags other than SIGNED, dropping only the start marker` pin unpatched upstream's output
and the port's. `random streams` checks every mode and chunking against upstream with the TODO applied.
The `framing` tests in `fixtures.test.ts` are updated to the corrected events.

---

## #151 Omitted float values are packed as NaN

> `jspack.js` `_En754(undefined)`. An omitted float extension (DISTANCE_SENSOR `horizontal_fov`) or a
> short float array (`q: [0.5]`) sends NaN (0x7F800001) instead of 0.

**Verdict: NOT PROVEN.**

**Reproduction:** `#151 omitted float values are packed as NaN > sends 0x7F800001 for an omitted float
extension and a short float array`. DISTANCE_SENSOR with its last four arguments omitted packs
`horizontal_fov` and `vertical_fov` as `01 00 80 7f`; with `quaternion: [0.5]` the three missing
elements are `01 00 80 7f` each.

**Why not proven:** the behaviour is reproduced exactly, but no allowed reference defines the output
for an omitted value. jspack's own contract makes it undefined, `local_modules/jspack/README.md:42-46`:

```
Return an octet array containing the packed values array.  If there are
more values supplied than are specified in the format string, the excess is
ignored.  If there are fewer values supplied, Pack() will return false.  If
any value is of an inappropriate type, the results are undefined.
```

The generated constructors always pass every field (some `undefined`), so this is the "inappropriate
type" case. The field definition (`packages/mavlink/definitions/common.xml:5448`, "Otherwise this is set
to 0.") tells a sender what to put there; it does not say a library must turn a missing argument into 0. The MAVLink serialization rule that absent extension fields are zero is not quotable from any source
in the repository (pymavlink and the MAVLink C library are not vendored; `modules/ardupilot/modules/mavlink`
is an empty submodule). No upstream tool omits a float field: the only messages the tools construct are
HEARTBEAT, COMMAND_INT, MISSION_ITEM_INT and FILE_TRANSFER_PROTOCOL.

---

## #152 An omitted numeric array shifts the following fields and corrupts the checksum

> `jspack.js` `WouldPack` (cursor not advanced), `mavlink.js` `x25Crc` (`forEach` skips the sparse
> array's holes). BATTERY_STATUS without `voltages_ext` but with `mode`, `fault_bitmask`: `mode` sends 0,
> `fault_bitmask` sends `mode`, and the CRC omits the unwritten bytes, so receivers drop the frame.

**Verdict: NOT PROVEN.**

**Reproduction:** `#152 ... > BATTERY_STATUS without voltages_ext: mode is sent as 0, fault_bitmask as
mode, the CRC skips bytes`. With `voltages_ext` `undefined`, `mode` 2 and `fault_bitmask` 5, `pack`
returns a 63-entry array with 55 entries set (the eight `voltages_ext` bytes are holes). On the wire
(holes as 0) payload byte 49 (`mode`) is 0 and byte 50 (`fault_bitmask`) is 2. The frame carries
checksum 54216; the CRC of its bytes plus CRC_EXTRA 154 is 20557, and upstream's own parser rejects it:
`invalid MAVLink CRC in msgID 147, got 54216 checksum, calculated payload checksum as 20557`. With
`voltages_ext: [0, 0, 0, 0]` the same message round-trips (`mode` 2, `fault_bitmask` 5).

The mechanism is as the row says: the non-array branch only logs (`jspack.js:695-697`,
`console.log("ERROR: (dst IS array) (source is not array)")`) and does not advance `values_i`, which the
array branch does (`jspack.js:692-693`); `x25Crc` iterates with `bytes.forEach` (`mavlink.js:84`), which
skips holes.

**Why not proven:** the trigger is an `undefined` value, for which jspack's contract leaves the result
undefined (`local_modules/jspack/README.md:46`, quoted under #151), and that "results" covers the whole
packed output, including the shifted fields and the checksum. The `voltages_ext` definition
(`common.xml:5591`, "Cells above the valid cell count for this battery should have a value of 0")
describes what a sender sends, not what the library does with a missing argument; the MAVLink rule for
absent extension fields is not quotable in the repository. A frame its own parser rejects is strong,
but with the input outside the documented contract it does not meet the 100% bar. No upstream tool packs
BATTERY_STATUS or any message with an omitted array.

---

## #153 -0 is packed as +0

> `jspack.js` `_En754` (sign test `v < 0`). Negative zero loses its sign on the wire.

**Verdict: PROVEN** (contradicts the specification it implements, and its own rounding path).

**Reproduction:** `#153 -0 is packed as +0 > drops the sign of -0 but keeps it for a negative value that
rounds to zero`. ATTITUDE with `roll: -0` packs roll as `00 00 00 00`; with `roll: -1e-50` (which rounds
to a zero magnitude in binary32) it packs `00 00 00 80`. ECMAScript's `DataView.setFloat32(-0)` gives
`00 00 00 80`. Upstream's parser decodes the first frame's roll as +0 and the second's as -0.

**Evidence:**

- The encoder states its format, `jspack.js:224`: `// Little-endian N-bit IEEE 754 floating point`. In
  IEEE 754 binary32 the sign is its own bit and -0 is `0x80000000`; the reference encoder used in the
  test (`DataView.setFloat32`, which ECMAScript defines as IEEE 754 binary32) writes exactly that.
- The encoder computes and applies a sign bit, `jspack.js:312`: `bool_s = v < 0 ? 1 : 0;` and
  `jspack.js:374`: `octet_array_a[offset_p + i - d] |= bool_s * 128;`. `-0 < 0` is false, so the sign of
  -0 alone is dropped, while -1e-50, encoded with the same zero magnitude, keeps it.
- The matching decoder honours that bit, `jspack.js:284`:
  `return (bool_s ? -1 : 1) * mantissa * Math.pow(2, exponent - mantissaLen);`, so upstream's own codec
  round-trips -1e-50 to -0 but -0 to +0.

**Minimal correct behaviour:** -0 is encoded with the sign bit set (`00 00 00 80` for a float,
`00 00 00 00 00 00 00 80` for a double); every other value is unchanged.

**Smallest port change:** `packages/mavlink/src/encode.ts:94` and `:96`: drop the `value === 0 ? 0 :`
substitution (write `float32TiesAway(value)` / `value`), and update the comment at line 88.

**Status: FIXED.** `packages/mavlink/src/encode.ts` `writeFloat` writes
`float32TiesAway(value)` / `value` (the `value === 0 ? 0 :` substitution removed). A float -0 (the
reproduction's ATTITUDE `roll`, COMMAND_INT `param1` in the tests) was `00 00 00 00` (upstream and the
old port) and is now `00 00 00 80`, the bytes upstream gives -1e-50;
a double -0 in WHEEL_DISTANCE now ends `80`. Tests (`packages/mavlink/src/oracle.test.ts`): `clamps and
truncates integers, rounds float32 ties away from zero, packs NaN its way and -0 with its sign` asserts
upstream packs -0 as +0, the port packs exactly what upstream packs for -1e-50, and +0 is identical;
`packs -0 with its sign in floats and doubles, where upstream packs +0 (proven bug #153)` checks
upstream's own decoder reads the port's frames back as -0.

---

## #154 Some messages cannot be packed

> `jspack.js`: no `_EnChar`; `_EnString` / `_EnInt64` of `undefined`. `pack` throws for TEST_TYPES and
> when an optional byte-array, string or 64-bit extension is omitted (AUTOPILOT_VERSION `uid2`,
> HOME_POSITION `time_usec`). Port throws `RangeError`.

**Verdict: PROVEN for TEST_TYPES** (it fails); **NOT PROVEN for omitted extensions.**

**Reproduction:** `#154 some messages cannot be packed > TEST_TYPES with every field given throws (jspack
has no char encoder)`: TEST_TYPES with every one of its 22 fields given with the documented JavaScript
type (`c: 'A'`, 64-bit values as `[lowBits, highBits]`) throws `TypeError: fxn is not a function`.
`> omitted string and 64-bit extensions throw`: AUTOPILOT_VERSION without `uid2` throws
`Cannot read properties of undefined (reading 'charCodeAt')`; HOME_POSITION without `time_usec` throws
`Cannot read properties of undefined (reading 'length')`.

**Evidence (TEST_TYPES):**

- The message is in the dialect: `packages/mavlink/definitions/all.xml:19` `<include>test.xml</include>`;
  `packages/mavlink/definitions/test.xml:5-7` defines `TEST_TYPES` with `<field type="char" name="c">char</field>`, and the generated
  format `'<Qqd3Q3q3dIif3I3i3fHh3H3hc10sBb3s3s'` uses jspack's `c`.
- jspack documents `c` packing, `local_modules/jspack/README.md:60`:
  `c   | char           | string (length 1) |        1       |  (2)`, and README.md:82: `The "c" and "s"
codes handle strings with codepoints between 0 and 255`.
- The encoder is commented out, `jspack.js:73`: `// m._EnChar = function(to_octet_array_a, offset_p,
from_str_array_v) {`, yet the table uses it, `jspack.js:460`: `'c': {en:m._EnChar, de:m._DeChar},`.
  `_PackSeries` calls `el.en` (`jspack.js:539`), so any message with a scalar `char` field throws for
  every input. The decoder side (`_DeChar`, `jspack.js:63-66`) exists, so such messages can be received
  but never sent.

**Why the omitted-extension part is not proven:** those throws come from `undefined` values, for which
jspack's contract leaves the result undefined (`README.md:46`, quoted under #151); throwing is one such
result.

**Minimal correct behaviour:** a scalar `char` field is packed as one byte holding the character code
of the string's first character (0 for an empty string), the inverse of `_DeChar`; TEST_TYPES then
packs and round-trips.

**Smallest port change:** `packages/mavlink/src/encode.ts:175`: instead of failing for a scalar `char`
(`field.arrayLength === undefined`), write `value.charCodeAt(0)` (or 0 when the string is empty) into
the field's byte, sharing the existing string path with a count of 1.

**Status: FIXED** for TEST_TYPES only. `packages/mavlink/src/encode.ts` `packPayload`
no longer refuses a scalar `char`: it shares the string path with a count of 1 (the first character's
code, 0 for an empty string). Omitted strings, byte arrays and 64-bit values still throw, as upstream.
TEST_TYPES with `c: 'A'` threw `fxn is not a function` (upstream) / `RangeError` (old port); the port now
packs byte 160 as `41`. Tests: `oracle.test.ts` `packs a scalar char as its character code, where
upstream cannot pack TEST_TYPES at all (proven bug #154)` (upstream still throws; upstream's decoder
reads the port's frame back); `decodes random frames of every message identically and re-encodes them
to the same bytes` now re-encodes TEST_TYPES too and still asserts upstream cannot; `codec.test.ts`
`round trip` includes TEST_TYPES.

---

## #155 Frame checksum overwrites a field called `crc`

> `mavlink.js` `decode` (`m.crc = receivedChecksum` after the fields). CUBEPILOT_FIRMWARE_UPDATE_START's
> `crc` reads as the checksum. Reproduced by Telemetry Dashboard's widget objects; `@apwt/mavlink` keeps
> fields apart.

**Verdict: PROVEN** (contradicts the MAVLink definition; the generated code also says not to do it).

**Reproduction:** `#155 frame checksum overwrites a field called crc > CUBEPILOT_FIRMWARE_UPDATE_START crc
reads as the frame checksum`. The packed frame is
`fd 0a 00 00 00 01 01 54 c3 00 e8 03 00 00 78 56 34 12 01 01 ca 3f`: the payload holds `crc` 0x12345678.
Upstream decodes `fieldnames` `['target_system', 'target_component', 'size', 'crc']`, `size` 1000, and
`crc` 0x3fca, the frame checksum.

**Evidence:**

- `packages/mavlink/definitions/cubepilot.xml:39`: `<field type="uint32_t" name="crc">FW CRC.</field>` —
  the field is the firmware CRC, a payload value.
- `mavlink.js:148` sets each field (`this[e] = args[i];`), then `mavlink.js:19526` overwrites it:
  `m.crc = receivedChecksum;`. The other frame metadata uses underscore names (`m._payload = payloadBuf;`,
  `mavlink.js:19525`), and the generated setter warns against exactly this, `mavlink.js:142`:
  `"WARNING, overwriting an existing property is DANGEROUS:"`.

**Minimal correct behaviour:** a message with a field named `crc` exposes that field's decoded value
under `crc`; the frame checksum must not replace it.

**Smallest port change:** `apps/telemetry-dashboard/src/mavlink/legacy-message.ts:192`: set the
frame-info `crc` only when the message has no field called `crc` (and adjust the comment at line 61).
`@apwt/mavlink` already keeps the field and the checksum apart.

**Status:** FIXED. `toLegacyMessage`
(`apps/telemetry-dashboard/src/mavlink/legacy-message.ts`) sets the frame-info `crc` to the message's own
`crc` field when it has one, else to the frame checksum (key order unchanged). Tests in
`apps/telemetry-dashboard/src/mavlink/legacy-message.test.ts`: "proven bug #155:
CUBEPILOT_FIRMWARE_UPDATE_START keeps its crc field instead of the frame checksum" (the frame above:
upstream `crc` 0x3fca, port 0x12345678, everything else identical), and "matches upstream for random
frames of every shared message, …", which stays strictly identical for every other message and, for
CUBEPILOT_FIRMWARE_UPDATE_START, asserts upstream's checksum, the port's field value, and identity of
all other keys.

---

## #156 SHA-256 length block holds only 32 bits

> `mavlink.js` `mavlink20.sha256`. Wrong digest for inputs of 512 MiB or more; unreachable for signing
> (at most 306 bytes).

**Verdict: PROVEN** (mathematics: it does not compute SHA-256).

**Reproduction:** `proofs/mavlink/sha256-length.test.ts`, `#156 SHA-256 length block holds only 32 bits >
gives a wrong digest for 2^29 bytes (bit length 2^32)`. For 2^29 zero bytes Node's SHA-256 gives
`9acca8e8c22201155389f65abbf6bc9723edc7384ead80503839f49dcc56d767`; upstream gives
`754b83b4865fa21349b7a1a1bc520b291ecf800364771dfe3838f8a550ac151c`. The control test (`matches the
reference below 512 MiB`) shows upstream equals the reference for 0, 55, 56, 64 and 306 bytes. The
2^29-byte test takes about ten seconds and 1 GiB of memory.

**Evidence:** the function is named and commented as SHA-256 (`mavlink.js:153`, `sha256 implementation`).
Its length block is four zero bytes followed by the low 32 bits of the bit length, `mavlink.js:190-201`:

```js
    const bitLen = l * 8;
    ...
    withPadding.set([
        0, 0, 0, 0,
        (bitLen >>> 24) & 0xff,
        (bitLen >>> 16) & 0xff,
        (bitLen >>> 8) & 0xff,
        bitLen & 0xff
    ], withPadding.length - 8);
```

For 2^29 bytes, `bitLen` is 2^32 and every written length byte is 0 (asserted in the test), so the
final block encodes length 0 instead of 2^32, and the digest differs from SHA-256's.

**Minimal correct behaviour:** the last 8 bytes hold the full bit length big-endian: the high four bytes
from `Math.floor(bitLen / 2 ** 32)`, the low four as now. Digests below 512 MiB are unchanged.

**Smallest port change:** `packages/mavlink/src/sha256.ts:46`: replace the four leading zeros with the
bytes of `Math.floor(bitLength / 2 ** 32)` and update the comment at lines 6-7. (No caller hashes that
much; signing hashes at most 306 bytes, so no output changes.)

**Status: FIXED.** `packages/mavlink/src/sha256.ts` writes the bit length's high 32
bits (`Math.floor(bitLength / 2 ** 32)`) and low 32 bits big-endian into the last 8 bytes. For 2^29
zero bytes the port gave upstream's `754b83b4…151c`, now `9acca8e8…d767` (Node `crypto`). Tests:
`packages/mavlink/src/sha256.test.ts` (`matches the reference around the block and length-field
boundaries`, and, with `APWT_SLOW_PROOFS=1`, `writes the full 64-bit bit length: 2^29 bytes hash
correctly (proven bug #156)`, about 18 s and 1.1 GB); `parser.oracle.test.ts` `computes SHA-256 and
signatures as upstream` still checks byte identity with upstream below 512 MiB.

---

## #157 Keys that are not 32 bytes are padded or cut

> `mavlink.js` `mavlink20.create_signature` (32-byte key slot, data copied after it). Shorter keys are
> zero-padded, longer ones act as their first 32 bytes (or throw past 32 + data). Unreachable from the
> tools, whose keys are SHA-256 digests.

**Verdict: NOT PROVEN.**

**Reproduction:** `#157 keys that are not 32 bytes are padded or cut > a 16-byte key signs as its
zero-padded 32-byte form; a 40-byte key as its first 32 bytes`. A 16-byte key gives the same signature
as that key zero-padded to 32 bytes; a 40-byte key the same as its first 32 bytes; a 60-byte key with
20 data bytes throws `RangeError: offset is out of bounds` (`mavlink.js:255-257`).

**Why not proven:** the signing key is defined as 32 bytes, `packages/mavlink/definitions/common.xml:5936`:
`<field type="uint8_t[32]" name="secret_key">signing key</field>`. Every key the tools use is a
32-byte SHA-256 digest. Nothing in the tools reaches another length. No allowed
reference defines what must happen for a key of another length, so the padding, truncation and throw are
behaviour for out-of-contract input, not a proven error.
