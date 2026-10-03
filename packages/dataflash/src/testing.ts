/**
 * Test helpers for building synthetic DataFlash logs, for this package's tests and for apps'
 * tests. Import from `@apwt/dataflash/testing`; never from production code.
 */
export { LogWriter, buildSyntheticLog, type FieldValue } from './test-support/synthetic-log.js'
