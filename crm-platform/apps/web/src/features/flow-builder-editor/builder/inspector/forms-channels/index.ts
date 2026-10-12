import type { FormComponent } from '../types';
import {
  CfAiForm,
  CfAssistantForm,
  CfHangupForm,
  CfListenForm,
  CfMenuForm,
  CfSayForm,
  CfSearchForm,
  CfTransferForm,
} from './call';
import { ApiLibraryForm } from './api-library';
import { FaqForm } from './faq';
import { ShopifyForm, WhatsappShopForm, WoocommerceForm } from './commerce';
import { ChatbotForm, SubflowForm } from './engage';
import { AiCallForm, BookAppointmentForm, DealForm, GoogleMeetForm, WaFormForm } from './crm';
import {
  FbGalleryForm,
  FbLeadForm,
  FbProductsForm,
  FbReplyCommentForm,
  FbToWhatsappForm,
} from './facebook';
import { GoogleDocsForm, GoogleFormForm, GoogleSheetsForm } from './google';
import {
  IgAiForm,
  IgAskForm,
  IgButtonsForm,
  IgLeadForm,
  IgProductsForm,
  IgQuickForm,
  IgReplyCommentForm,
  IgSendDmForm,
  IgToWhatsappForm,
} from './instagram';
import { TgPaymentForm } from './telegram';
import {
  InListForm,
  InSegmentForm,
  ListMemberForm,
  SheetCheckForm,
  SheetContactForm,
  UpdateContactForm,
  WaSessionForm,
} from './workflow';

/**
 * Forms for commerce, Google, CRM, call, Instagram, Facebook and Telegram nodes. `ig_send_dm`, `ig_quick`, `ig_ai` and
 * `ig_ask` are the legacy Instagram types the palette hides; they stay here so old flows remain editable.
 */
export const CHANNEL_FORMS: Record<string, FormComponent> = {
  // These two replace the same-named entries of CORE_FORMS (the registry spreads CHANNEL_FORMS last): see engage.tsx.
  subflow: SubflowForm,
  chatbot: ChatbotForm,
  whatsapp_shop: WhatsappShopForm,
  woocommerce: WoocommerceForm,
  shopify: ShopifyForm,
  book_appointment: BookAppointmentForm,
  ai_call: AiCallForm,
  google_meet: GoogleMeetForm,
  wa_form: WaFormForm,
  api_library: ApiLibraryForm,
  faq: FaqForm,
  google_sheets: GoogleSheetsForm,
  google_docs: GoogleDocsForm,
  google_form: GoogleFormForm,
  deal: DealForm,
  cf_say: CfSayForm,
  cf_listen: CfListenForm,
  cf_ai: CfAiForm,
  cf_assistant: CfAssistantForm,
  cf_menu: CfMenuForm,
  cf_search: CfSearchForm,
  cf_transfer: CfTransferForm,
  cf_hangup: CfHangupForm,
  ig_send_dm: IgSendDmForm,
  ig_quick: IgQuickForm,
  ig_buttons: IgButtonsForm,
  ig_reply_comment: IgReplyCommentForm,
  ig_ai: IgAiForm,
  ig_products: IgProductsForm,
  ig_ask: IgAskForm,
  ig_lead: IgLeadForm,
  ig_to_whatsapp: IgToWhatsappForm,
  fb_gallery: FbGalleryForm,
  fb_products: FbProductsForm,
  fb_lead: FbLeadForm,
  fb_reply_comment: FbReplyCommentForm,
  fb_to_whatsapp: FbToWhatsappForm,
  tg_payment: TgPaymentForm,
  update_contact: UpdateContactForm,
  list_member: ListMemberForm,
  in_list: InListForm,
  in_segment: InSegmentForm,
  wa_session: WaSessionForm,
  sheet_check: SheetCheckForm,
  sheet_contact: SheetContactForm,
};
