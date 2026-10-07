/** Public surface of the personal-number devices domain (WADEV). Other domains import only from here. */
export { WhatsappDevicesBaileysModule } from './whatsapp-devices-baileys.module';
export {
  PILOT_DEVICE_CAP,
  PAIRING_STARTS_PER_DEVICE_PER_HOUR,
  PAIRING_STARTS_PER_ORG_PER_DAY,
  DEVICE_CREATES_PER_ORG_PER_HOUR,
} from './device-rules';
