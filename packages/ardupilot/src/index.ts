/**
 * @apwt/ardupilot — framework-free ArduPilot domain helpers shared by several tools: parameter
 * names, values and files, sensor device ids, firmware version and board detection, and the
 * APJ board id table. Ports of upstream `Libraries/Param_Helpers.js`, `DecodeDevID.js`,
 * `LogHelpers.js` and `board_types.txt`.
 */
export {
  paramNameVector3,
  compassParamNames,
  paramValue,
  paramToString,
  compareParamNames,
  paramLine,
  paramFileText,
  parseParamFile,
  type Vector3Names,
  type CompassParamNames,
  type ParamValueResult,
  type ParamFileEntry,
  type SkippedParamReason,
  type SkippedParamLine,
  type ParsedParamFile
} from './params.js'
export {
  DeviceType,
  BUS_TYPE_DRONECAN,
  decodeDevId,
  describeDevId,
  type LocalDevId,
  type DroneCanDevId,
  type DecodedDevId
} from './devid.js'
export {
  BUILD_TYPES,
  getVersionAndBoard,
  versionFromRecords,
  readVerRecord,
  type BuildName,
  type VerRecord,
  type VersionAndBoard
} from './version.js'
export { BOARD_TYPES, boardName, parseBoardTypes } from './board-types.js'
