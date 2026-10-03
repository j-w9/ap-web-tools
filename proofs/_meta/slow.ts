/**
 * Proofs that need a lot of CPU or memory (hashing 512 MiB, simulating 1000 s of flight) run only
 * when APWT_SLOW_PROOFS=1. CI runs them in their own step, one file at a time, so they cannot
 * starve the main test run.
 */
export const SLOW_PROOFS = process.env['APWT_SLOW_PROOFS'] === '1'
