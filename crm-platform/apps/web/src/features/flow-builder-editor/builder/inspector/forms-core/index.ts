import type { FormComponent } from '../types';
import { AssignForm, ChatbotForm, TagForm } from './contact';
import { CtaForm, LocationForm } from './engage';
import {
  AiForm,
  CodeForm,
  ConditionForm,
  DelayForm,
  EndForm,
  MysqlForm,
  SubflowForm,
  WebhookForm,
} from './logic';
import { AskForm, ButtonsForm, ListForm, PollForm } from './options';
import { MediaForm, MessageForm, NotifyNumberForm, TemplateForm, WaToInstagramForm } from './send';
import { SequenceForm } from './sequence';
import { TriggerForm } from './trigger';

/** Forms for the shared chat nodes, keyed by node type. */
export const CORE_FORMS: Record<string, FormComponent> = {
  trigger: TriggerForm,
  message: MessageForm,
  template: TemplateForm,
  media: MediaForm,
  notify_number: NotifyNumberForm,
  wa_to_instagram: WaToInstagramForm,
  sequence: SequenceForm,
  buttons: ButtonsForm,
  list: ListForm,
  ask: AskForm,
  condition: ConditionForm,
  delay: DelayForm,
  webhook: WebhookForm,
  code: CodeForm,
  mysql: MysqlForm,
  ai: AiForm,
  tag: TagForm,
  assign: AssignForm,
  subflow: SubflowForm,
  end: EndForm,
  cta: CtaForm,
  location: LocationForm,
  poll: PollForm,
  chatbot: ChatbotForm,
};
