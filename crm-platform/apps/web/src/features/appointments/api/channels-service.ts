import {
  adoptAppointmentTemplateSchema,
  appointmentChannelStateSchema,
  appointmentChannelsResponseSchema,
  appointmentTemplateResultSchema,
  appointmentTemplateSchema,
  appointmentTemplatesResponseSchema,
  predefinedAppointmentTemplatesResponseSchema,
  type AdoptAppointmentTemplateInput,
  type AppointmentChannel,
  type AppointmentChannelState,
  type AppointmentTemplate,
  type AppointmentTemplateResult,
  type CreateAppointmentTemplateInput,
  type PredefinedAppointmentTemplatesResponse,
  type UpdateAppointmentChannelInput,
  type UpdateAppointmentTemplateInput,
} from '@crm/contracts';
import { call } from './http';

/**
 * The owner's choice of channels for appointment messages and the message library (BL-350, BL-351). Always the real API (like the
 * calendar calls beyond Google's card): with the development stand-in on these fail visibly instead of faking an answer. The wire
 * shapes are the view models.
 */
export const channelsApi = {
  channels(signal?: AbortSignal): Promise<AppointmentChannelState[]> {
    return call('/appointment-channels', {
      schema: appointmentChannelsResponseSchema.transform((r) => r.data),
      signal,
    });
  },
  updateChannel(
    channel: AppointmentChannel,
    input: UpdateAppointmentChannelInput,
  ): Promise<AppointmentChannelState> {
    return call(`/appointment-channels/${channel}`, {
      method: 'PUT',
      body: input,
      schema: appointmentChannelStateSchema,
    });
  },

  library(signal?: AbortSignal): Promise<AppointmentTemplate[]> {
    return call('/appointment-message-templates', {
      schema: appointmentTemplatesResponseSchema.transform((r) => r.data),
      signal,
    });
  },
  predefined(signal?: AbortSignal): Promise<PredefinedAppointmentTemplatesResponse> {
    return call('/appointment-message-templates/predefined', {
      schema: predefinedAppointmentTemplatesResponseSchema,
      signal,
    });
  },
  adopt(
    input: Pick<AdoptAppointmentTemplateInput, 'key' | 'channel'> &
      Partial<AdoptAppointmentTemplateInput>,
  ): Promise<AppointmentTemplateResult> {
    return call('/appointment-message-templates/adopt', {
      method: 'POST',
      body: adoptAppointmentTemplateSchema.parse(input),
      schema: appointmentTemplateResultSchema,
    });
  },
  createEmail(input: CreateAppointmentTemplateInput): Promise<AppointmentTemplateResult> {
    return call('/appointment-message-templates', {
      method: 'POST',
      body: input,
      schema: appointmentTemplateResultSchema,
    });
  },
  update(id: string, input: UpdateAppointmentTemplateInput): Promise<AppointmentTemplateResult> {
    return call(`/appointment-message-templates/${id}`, {
      method: 'PATCH',
      body: input,
      schema: appointmentTemplateResultSchema,
    });
  },
  submit(id: string): Promise<AppointmentTemplateResult> {
    return call(`/appointment-message-templates/${id}/submit`, {
      method: 'POST',
      body: {},
      schema: appointmentTemplateResultSchema,
    });
  },
  refresh(id: string): Promise<AppointmentTemplate> {
    return call(`/appointment-message-templates/${id}/refresh`, {
      method: 'POST',
      body: {},
      schema: appointmentTemplateSchema,
    });
  },
  remove(id: string): Promise<void> {
    return call(`/appointment-message-templates/${id}`, { method: 'DELETE' });
  },
};
