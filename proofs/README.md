# Proof tests

Reproductions of upstream bugs, run against the original JavaScript in `node:vm`. See
[`../docs/bug-proofs/README.md`](../docs/bug-proofs/README.md) for the standard. One folder per tool.
Tests here must not read `upstream/modules/ardupilot` (CI does not fetch it); cite firmware source in
the verdict files instead.
