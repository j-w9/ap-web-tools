# MAVLink definitions

These are the definitions upstream WebTools' `modules/MAVLink/mavlink.js` was generated from, so the
package decodes exactly the messages, fields and enum values upstream does.

Vendored, unmodified, from [ArduPilot/mavlink](https://github.com/ArduPilot/mavlink)
`message_definitions/v1.0/` at commit
[`5e496e27fa8108b669cb435d4472823cd7b7a711`](https://github.com/ArduPilot/mavlink/tree/5e496e27fa8108b669cb435d4472823cd7b7a711/message_definitions/v1.0)
(2025-07-26, "common: added options for hover vs loiter for DO_REPOSITION"). That commit is the head
of ArduPilot/mavlink pull request #413 and is not on `master`: it is one commit on top of `master` at
`6cd16c5c` (2025-07-25), adding `MAV_DO_REPOSITION_FLAGS_RELATIVE_YAW`, `_VTOL_HOVER` and
`_FW_LOITER`, which upstream's `mavlink.js` contains.

`all.xml` is the root, as for upstream (its header reads "Generated from: all.xml,ardupilotmega.xml,
..."). The other files are everything it includes, directly or not: `ardupilotmega.xml`,
`ASLUAV.xml`, `common.xml`, `development.xml`, `icarous.xml`, `minimal.xml`,
`python_array_test.xml`, `standard.xml`, `test.xml`, `ualberta.xml`, `uAvionix.xml`,
`loweheiser.xml`, `storm32.xml`, `AVSSUAS.xml`, `cubepilot.xml` and `csAirLink.xml`.

## How the commit was identified

Running pymavlink's generator (`mavgen --lang=JavaScript_NextGen --wire-protocol=2.0`) on `all.xml`
at this commit reproduces upstream's `mavlink.js` from `// enums` to the end of `mavlink20.map` byte
for byte, comments included (pymavlink `159b4db`, 2025-07-27, whose runtime upstream ships, and
`8c6f708`, 2026-08-31, give the same output). Reverting upstream's `runtime-fixes.patch` makes the
whole file identical apart from the header note and whitespace. No commit on `master` matches; the
nearest (`6cd16c5c`, whose definitions equal `676add4a`'s) differs only in `MAV_DO_REPOSITION_FLAGS`.

`src/oracle.test.ts` checks the result: every message (id, name, CRC_EXTRA, fields in XML order,
wire layout) and every enum entry (including mavgen's `*_ENUM_END` values) equals upstream's.

## Updating

Only together with upstream: when upstream regenerates `mavlink.js`, find the commit it was built
from the same way, download the same files at that commit, record its hash here, then run
`npm run generate` in `packages/mavlink` and review the diff of `src/generated/`:

```sh
SHA=<commit>
for f in all ardupilotmega ASLUAV common development icarous minimal python_array_test standard \
  test ualberta uAvionix loweheiser storm32 AVSSUAS cubepilot csAirLink; do
  curl -sSfo "$f.xml" "https://raw.githubusercontent.com/ArduPilot/mavlink/$SHA/message_definitions/v1.0/$f.xml"
done
```

If `all.xml` gains an `<include>`, add that file too; generation fails on a missing one.
