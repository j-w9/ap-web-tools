# Bug proofs

An upstream bug is fixed in the port only when it is proven with certainty. Everything else stays
reproduced (see [`../porting-policy.md`](../porting-policy.md)). This folder holds one file per tool
with a verdict for every entry in [`../upstream-bugs.md`](../upstream-bugs.md).

## What counts as proof

Every PROVEN verdict needs **both**:

1. **A reproduction that runs the original code.** A test in `proofs/<tool>/` loads the upstream
   JavaScript (in `node:vm`, as the oracle tests do) and shows the behaviour, with the exact input and
   the exact output.
2. **At least one hard reference showing that output is wrong:**
   - **It fails.** The original throws, hangs, or never produces the output its own UI offers.
   - **It contradicts itself.** The same code states the intent unambiguously and the result differs
     from it (e.g. a check written with the comma operator so it can never be true; a duplicated
     `case` label making a branch unreachable; a variable named for one quantity computed from
     another; a help text or label in the same page describing a different result).
   - **It contradicts ArduPilot.** The firmware source at the commit the original pins
     (`upstream/modules/ardupilot`, `f3836cf`) defines the value differently (a parameter name that
     does not exist, an enum value or bit with another meaning, a log field with other units). Cite
     file and line.
   - **It contradicts mathematics or a specification it implements.** E.g. a MAVLink checksum that
     does not match the MAVLink specification, a unit conversion with the wrong constant.

## What does not count

- A behaviour we would prefer, or that "seems odd", without one of the references above.
- Timing, ordering or UI quirks whose intent is not stated anywhere.
- Anything where a reasonable reading of the original makes the behaviour intended.

Those are marked **NOT PROVEN** with the reason, and stay reproduced.

## Verdict file format

Each `docs/bug-proofs/<tool>.md` has one section per bug: the row from `upstream-bugs.md`, the
verdict (PROVEN / NOT PROVEN), the reproduction test name, the evidence (quotes with file:line), and
for PROVEN bugs the minimal correct behaviour a fix must have.
