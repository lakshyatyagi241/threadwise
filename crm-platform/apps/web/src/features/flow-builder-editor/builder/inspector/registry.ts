import { CHANNEL_FORMS } from './forms-channels';
import { CORE_FORMS } from './forms-core';
import type { FormComponent } from './types';

/** node type -> the form shown in the inspector. A type without a form shows the "no settings" note. */
export const NODE_FORMS: Record<string, FormComponent> = { ...CORE_FORMS, ...CHANNEL_FORMS };
