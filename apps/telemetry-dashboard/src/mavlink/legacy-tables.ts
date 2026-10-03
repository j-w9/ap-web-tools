/**
 * Facts about the XML definitions that `@apwt/mavlink` descriptors do not carry but upstream's
 * pymavlink-generated `mavlink.js` exposes on every message. Both tables are checked against the
 * XML in `legacy-tables.test.ts`.
 */
import type { MessageName } from '@apwt/mavlink'

/**
 * XML field names that are not the snake_case of the package's camelCase key, by message. Every
 * other field's XML name is `snakeCase(key)` (`timeBootMs` -> `time_boot_ms`).
 */
export const XML_NAME_EXCEPTIONS: Partial<Record<MessageName, Readonly<Record<string, string>>>> = {
  ADSB_VEHICLE: { icaoAddress: 'ICAO_address' },
  AHRS: { omegaIx: 'omegaIx', omegaIy: 'omegaIy', omegaIz: 'omegaIz' },
  AIRSPEED_AUTOCAL: { eas2tas: 'EAS2TAS', pax: 'Pax', pby: 'Pby', pcz: 'Pcz' },
  AIS_VESSEL: { mmsi: 'MMSI', cog: 'COG' },
  AOA_SSA: { aoa: 'AOA', ssa: 'SSA' },
  CAMERA_SETTINGS: { zoomLevel: 'zoomLevel', focusLevel: 'focusLevel' },
  COMPASSMOT_STATUS: { compensationX: 'CompensationX', compensationY: 'CompensationY', compensationZ: 'CompensationZ' },
  HWSTATUS: { vcc: 'Vcc', i2Cerr: 'I2Cerr' },
  ICAROUS_KINEMATIC_BANDS: { numBands: 'numBands' },
  MCU_STATUS: {
    mcuTemperature: 'MCU_temperature',
    mcuVoltage: 'MCU_voltage',
    mcuVoltageMin: 'MCU_voltage_min',
    mcuVoltageMax: 'MCU_voltage_max'
  },
  PID_TUNING: { ff: 'FF', p: 'P', i: 'I', d: 'D', sRate: 'SRate', pDmod: 'PDmod' },
  POWER_STATUS: { vcc: 'Vcc', vservo: 'Vservo' },
  UAVIONIX_ADSB_GET: { reqMessageId: 'ReqMessageId' },
  UAVIONIX_ADSB_OUT_CFG: {
    icao: 'ICAO',
    emitterType: 'emitterType',
    aircraftSize: 'aircraftSize',
    gpsOffsetLat: 'gpsOffsetLat',
    gpsOffsetLon: 'gpsOffsetLon',
    stallSpeed: 'stallSpeed',
    rfSelect: 'rfSelect'
  },
  UAVIONIX_ADSB_OUT_CONTROL: { baroAltMSL: 'baroAltMSL', emergencyStatus: 'emergencyStatus' },
  UAVIONIX_ADSB_OUT_DYNAMIC: {
    utcTime: 'utcTime',
    gpsLat: 'gpsLat',
    gpsLon: 'gpsLon',
    gpsAlt: 'gpsAlt',
    gpsFix: 'gpsFix',
    numSats: 'numSats',
    baroAltMSL: 'baroAltMSL',
    accuracyHor: 'accuracyHor',
    accuracyVert: 'accuracyVert',
    accuracyVel: 'accuracyVel',
    velVert: 'velVert',
    velNS: 'velNS',
    velEW: 'VelEW',
    emergencyStatus: 'emergencyStatus'
  },
  UAVIONIX_ADSB_OUT_STATUS: { nicNACp: 'NIC_NACp', boardTemp: 'boardTemp' },
  UAVIONIX_ADSB_TRANSCEIVER_HEALTH_REPORT: { rfHealth: 'rfHealth' },
  VIBRATION: { clipping0: 'clipping_0', clipping1: 'clipping_1', clipping2: 'clipping_2' }
}

/** The field marked `instance="true"` in the XML (camelCase key), by message. */
export const INSTANCE_FIELDS: Partial<Record<MessageName, string>> = {
  ADAP_TUNING: 'axis',
  AIRSPEED: 'id',
  BATTERY_STATUS: 'id',
  CAMERA_THERMAL_RANGE: 'streamId',
  DEBUG_FLOAT_ARRAY: 'arrayId',
  DEBUG_VECT: 'name',
  DISTANCE_SENSOR: 'id',
  GIMBAL_MANAGER_INFORMATION: 'gimbalDeviceId',
  GIMBAL_MANAGER_SET_ATTITUDE: 'gimbalDeviceId',
  GIMBAL_MANAGER_SET_MANUAL_CONTROL: 'gimbalDeviceId',
  GIMBAL_MANAGER_SET_PITCHYAW: 'gimbalDeviceId',
  GIMBAL_MANAGER_STATUS: 'gimbalDeviceId',
  GLOBAL_POSITION_SENSOR: 'id',
  GPS_INPUT: 'gpsId',
  HIGHRES_IMU: 'id',
  HYGROMETER_SENSOR: 'id',
  LOWEHEISER_GOV_EFI: 'efiIndex',
  MAG_CAL_PROGRESS: 'compassId',
  MAG_CAL_REPORT: 'compassId',
  MCU_STATUS: 'id',
  NAMED_VALUE_FLOAT: 'name',
  NAMED_VALUE_INT: 'name',
  NAMED_VALUE_STRING: 'name',
  OBSTACLE_DISTANCE_3D: 'obstacleId',
  OPTICAL_FLOW_RAD: 'sensorId',
  PID_TUNING: 'axis',
  RAW_IMU: 'id',
  SERVO_OUTPUT_RAW: 'port',
  SMART_BATTERY_INFO: 'id',
  STORAGE_INFORMATION: 'storageId',
  VIDEO_STREAM_INFORMATION: 'streamId',
  VIDEO_STREAM_STATUS: 'streamId',
  WATER_DEPTH: 'id'
}
