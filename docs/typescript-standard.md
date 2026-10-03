# TypeScript standard

The point of the port is to get value from the type system, not to re-type JavaScript. This page
is the agreed standard. CI enforces everything marked **(enforced)**; the rest is checked in review.

## Compiler

`tsconfig.base.json` turns on `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `noUnusedLocals`/`Parameters` and `verbatimModuleSyntax`. Tests are part of
each project, so they are type-checked too. **(enforced: `npm run typecheck`)**

## No escape hatches

- No `any`, explicit or implicit. Use `unknown` and narrow it. **(enforced)**
- No double casts through `unknown` (`x as unknown as T`). If a library's types are wrong,
  augment them, as `packages/plot/src/plotly-augment.d.ts` does. **(enforced)**
- No object-literal assertions (`{} as T`). Annotate the variable instead, so missing fields are
  errors. **(enforced)**
- No unnecessary assertions or conditions. If the compiler already knows, do not repeat it.
  **(enforced)**
- `!` only on indexed access (`values[i]!`) inside a loop whose bound proves the index valid.
  Anywhere else, narrow with a check. **(enforced)**
- `@ts-expect-error` only with a reason, e.g. in a test proving that bad input fails to compile.
  `@ts-ignore` is banned. **(enforced)**

## Model the domain in types

- **Closed sets are literal unions, not strings.** Controller keys are `SpecKey`, not `string`;
  vehicles are `VehicleType`. A `Record<VehicleType, string>` then fails to compile if a vehicle
  is missing.
- **Variants are discriminated unions.** A PID controller's data comes from either its own
  message or one axis of `RATE`: `{ message: 'PIDR' } | { message: 'RATE'; axis: 'R' }`, not a
  tuple whose second element is sometimes present.
- **Let options shape results.** `runFft(…, { takeMax: true })` returns a result whose `max` is
  guaranteed, through an overload, so callers never write `result.max!`.
- **Switches over unions are exhaustive.** **(enforced: `switch-exhaustiveness-check`)**
- **Derive, don't duplicate.** Use `as const` tables plus `(typeof TABLE)[number]` for the union,
  and `satisfies` to check a table's shape without widening it.
- **Readonly at boundaries.** Function inputs are `readonly T[]`, `ReadonlyMap`, `ReadonlySet`.
- **Units in names.** Time columns say `timeUs` or `time` (seconds) explicitly; conversions
  happen once, at load.

## Structure

- Analysis code is pure and framework-free (`src/analysis/`), with tests next to it. React code
  renders state and raises events (`src/ui/`). Neither touches the other's concerns.
- React state that can be computed from other state is computed, not synced with an effect.
  **(enforced: `react-hooks` rules)**
- Imports of types use `import type`. **(enforced)**

## Formatting

Prettier owns formatting: no semicolons, single quotes, 130 columns, no trailing commas. These
settings were chosen because they changed the fewest lines of existing code
(`scripts/measure-format.mjs`). **(enforced: `npm run format:check`)**
