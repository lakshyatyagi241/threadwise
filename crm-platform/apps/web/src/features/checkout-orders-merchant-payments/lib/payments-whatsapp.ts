import {
  WHATSAPP_PAY_TYPES,
  type SaveWhatsappPayConfigInput,
  type WhatsappPayConfig,
} from '@crm/contracts';

/** The WhatsApp Pay configuration form (Reference `store`: create or update by name; India is the only market). */
export interface WaPayForm {
  configName: string;
  paymentType: (typeof WHATSAPP_PAY_TYPES)[number];
  isActive: boolean;
  autoCharge: boolean;
}

export const WA_PAY_TYPES = WHATSAPP_PAY_TYPES;
export const CONFIG_NAME_MAX = 60;

export const emptyWaPayForm = (): WaPayForm => ({
  configName: '',
  paymentType: 'razorpay',
  isActive: true,
  autoCharge: false,
});

export const isWaPayType = (v: string): v is WaPayForm['paymentType'] =>
  (WA_PAY_TYPES as readonly string[]).includes(v);

/** Edit a saved configuration: its name is the key of the PUT, so the form starts from it. An unknown type falls back to the first. */
export function formFromConfig(c: WhatsappPayConfig): WaPayForm {
  return {
    configName: c.configName,
    paymentType: isWaPayType(c.paymentType) ? c.paymentType : 'razorpay',
    isActive: c.isActive,
    autoCharge: c.autoCharge,
  };
}

/** `name` when the name is usable, otherwise why not. */
export function validateWaPay(form: WaPayForm): 'name' | null {
  const name = form.configName.trim();
  return name.length < 1 || name.length > CONFIG_NAME_MAX ? 'name' : null;
}

export function buildWaPayBody(form: WaPayForm): SaveWhatsappPayConfigInput {
  return {
    configName: form.configName.trim(),
    paymentType: form.paymentType,
    isActive: form.isActive,
    autoCharge: form.autoCharge,
  };
}

/** Is this name already one of the saved configurations (a save may update it instead of adding one)? Compared without case, as a hint only. */
export function isExistingName(configs: readonly WhatsappPayConfig[], name: string): boolean {
  const n = name.trim().toLowerCase();
  return n !== '' && configs.some((c) => c.configName.trim().toLowerCase() === n);
}
