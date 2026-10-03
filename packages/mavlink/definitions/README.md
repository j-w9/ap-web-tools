# MAVLink definitions

Vendored, unmodified, from [ArduPilot/mavlink](https://github.com/ArduPilot/mavlink)
`message_definitions/v1.0/` at commit
[`0d734a416f1836e0840c3bb9ab9e4daffc6330d1`](https://github.com/ArduPilot/mavlink/tree/0d734a416f1836e0840c3bb9ab9e4daffc6330d1/message_definitions/v1.0)
(2026-10-01, "pymavlink: update for flash savings").

`ardupilotmega.xml` is the root; the other files are everything it includes, directly or not:
`common.xml`, `standard.xml`, `minimal.xml`, `uAvionix.xml`, `icarous.xml`, `loweheiser.xml`,
`cubepilot.xml` and `csAirLink.xml`.

To update, download the same files at a newer commit, record its hash here, then run
`npm run generate` in `packages/mavlink` and review the diff of `src/generated/`:

```sh
SHA=<commit>
for f in ardupilotmega common standard minimal uAvionix icarous loweheiser cubepilot csAirLink; do
  curl -sSfo "$f.xml" "https://raw.githubusercontent.com/ArduPilot/mavlink/$SHA/message_definitions/v1.0/$f.xml"
done
```

If `ardupilotmega.xml` gains an `<include>`, add that file too; generation fails on a missing one.
