import {
  WABA_ENTITY_TYPES,
  type UpdateComplianceInfoInput,
  type WabaComplianceInfo,
  type WabaEntityType,
} from '@crm/contracts';
import type { BusinessComplianceInfo } from '../../infra/providers/whatsapp-cloud-api-waba/waba-admin.port';

/** The form's record in the provider port's terms: the contact sides named the way Meta names them. */
export function toComplianceRecord(input: UpdateComplianceInfoInput): BusinessComplianceInfo {
  return {
    entityName: input.entityName,
    entityType: input.entityType,
    entityTypeCustom: input.entityType === 'OTHER' ? (input.entityTypeCustom ?? null) : null,
    isRegistered: input.isRegistered ?? null,
    customerCare: {
      email: input.customerCare.email,
      mobileNumber: input.customerCare.mobile,
      landlineNumber: input.customerCare.landline,
    },
    grievanceOfficer: {
      name: input.grievanceOfficer.name,
      email: input.grievanceOfficer.email,
      mobileNumber: input.grievanceOfficer.mobile,
      landlineNumber: input.grievanceOfficer.landline,
    },
  };
}

const isEntityType = (v: string): v is WabaEntityType =>
  (WABA_ENTITY_TYPES as readonly string[]).includes(v);

/**
 * Meta's record as the API returns it. An entity type Meta holds that this app does not know is shown as empty, not sent on:
 * the form then asks for it again instead of showing a value it cannot use.
 */
export function toComplianceDto(info: BusinessComplianceInfo): WabaComplianceInfo {
  return {
    entityName: info.entityName,
    entityType: info.entityType && isEntityType(info.entityType) ? info.entityType : null,
    entityTypeCustom: info.entityTypeCustom,
    isRegistered: info.isRegistered,
    customerCare: {
      email: info.customerCare.email,
      mobile: info.customerCare.mobileNumber,
      landline: info.customerCare.landlineNumber,
    },
    grievanceOfficer: {
      name: info.grievanceOfficer.name,
      email: info.grievanceOfficer.email,
      mobile: info.grievanceOfficer.mobileNumber,
      landline: info.grievanceOfficer.landlineNumber,
    },
  };
}
