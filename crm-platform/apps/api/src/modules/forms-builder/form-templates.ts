import {
  formDefinitionSchema,
  type FormDefinition,
  type FormDefinitionInput,
  type FormFieldBlock,
  type FormTemplate,
} from '@crm/contracts';

/**
 * The template gallery (docs/specs/forms-builder-app.md 4 and 13): five starting points, versioned in code. Every one is parsed by the
 * form schema when this file loads, so a template that stops being valid fails the build, not a workspace's "New form".
 *
 * The order-and-payment template of the spec arrives with payments (phase 3); until then the order template is an order REQUEST that
 * lands in the CRM, and says so.
 */

type FieldInput = Omit<FormFieldBlock, 'type' | 'required' | 'width'> &
  Partial<Pick<FormFieldBlock, 'required' | 'width'>>;

const field = (f: FieldInput): FormFieldBlock => ({
  type: 'field',
  required: false,
  width: 'full',
  ...f,
});

const NAME = field({
  id: 'name',
  kind: 'short_text',
  label: 'Full name',
  required: true,
  bind: { object: 'contact', property: 'name' },
});
const EMAIL = field({
  id: 'email',
  kind: 'email',
  label: 'Email address',
  required: true,
  bind: { object: 'contact', property: 'email' },
});
const PHONE = field({
  id: 'phone',
  kind: 'phone',
  label: 'Phone number',
  bind: { object: 'contact', property: 'phone' },
});

const def = (input: FormDefinitionInput): FormDefinition => formDefinitionSchema.parse(input);

const TEMPLATES: FormTemplate[] = [
  {
    key: 'lead-capture',
    name: 'Lead capture',
    description:
      'Name, email, phone and what the person needs. Tags the contact as a website lead.',
    category: 'lead',
    definition: def({
      title: 'Get in touch',
      description: '<p>Tell us a little about what you need and we will get back to you.</p>',
      steps: [
        {
          id: 'main',
          blocks: [
            NAME,
            EMAIL,
            PHONE,
            field({
              id: 'company',
              kind: 'short_text',
              label: 'Company',
              bind: { object: 'company', property: 'name' },
            }),
            field({
              id: 'need',
              kind: 'long_text',
              label: 'How can we help?',
              bind: { object: 'contact', property: 'message' },
            }),
          ],
        },
      ],
      settings: {
        submitLabel: 'Send',
        successMessage: 'Thanks! We received your details and will be in touch soon.',
      },
      consent: {
        enabled: true,
        text: 'I agree to be contacted about my request.',
        required: false,
        marketing: true,
      },
      mapping: { company: { match: 'name_or_domain' } },
      after: { tags: ['Website lead'] },
    }),
  },
  {
    key: 'contact-us',
    name: 'Contact us',
    description: 'A simple contact form with a topic and a message.',
    category: 'contact',
    definition: def({
      title: 'Contact us',
      steps: [
        {
          id: 'main',
          blocks: [
            NAME,
            EMAIL,
            PHONE,
            field({
              id: 'topic',
              kind: 'dropdown',
              label: 'Topic',
              options: [
                { value: 'general', label: 'General question' },
                { value: 'support', label: 'Support' },
                { value: 'sales', label: 'Sales' },
                { value: 'other', label: 'Other' },
              ],
            }),
            field({
              id: 'message',
              kind: 'long_text',
              label: 'Message',
              required: true,
              bind: { object: 'contact', property: 'message' },
              validation: { maxLen: 2000 },
            }),
          ],
        },
      ],
      settings: {
        submitLabel: 'Send message',
        successMessage: 'Thanks for writing to us. We will reply shortly.',
      },
      mapping: { company: { match: 'none' } },
      after: { tags: ['Contact form'] },
    }),
  },
  {
    key: 'event-registration',
    name: 'Event registration',
    description: 'Register for an event: contact details, a session and any dietary needs.',
    category: 'event',
    definition: def({
      title: 'Register for the event',
      description: '<p>Save your seat. We will email you the details.</p>',
      steps: [
        {
          id: 'main',
          blocks: [
            field({
              id: 'first_name',
              kind: 'short_text',
              label: 'First name',
              required: true,
              width: 'half',
              bind: { object: 'contact', property: 'first_name' },
            }),
            field({
              id: 'last_name',
              kind: 'short_text',
              label: 'Last name',
              required: true,
              width: 'half',
              bind: { object: 'contact', property: 'last_name' },
            }),
            EMAIL,
            PHONE,
            field({
              id: 'company',
              kind: 'short_text',
              label: 'Company',
              bind: { object: 'company', property: 'name' },
            }),
            field({
              id: 'session',
              kind: 'radio',
              label: 'Which session will you attend?',
              required: true,
              options: [
                { value: 'morning', label: 'Morning' },
                { value: 'afternoon', label: 'Afternoon' },
                { value: 'both', label: 'Both' },
              ],
            }),
            field({
              id: 'diet',
              kind: 'dropdown',
              label: 'Dietary needs',
              options: [
                { value: 'none', label: 'None' },
                { value: 'vegetarian', label: 'Vegetarian' },
                { value: 'vegan', label: 'Vegan' },
                { value: 'other', label: 'Other' },
              ],
            }),
          ],
        },
      ],
      settings: { submitLabel: 'Register', successMessage: 'You are registered. See you there!' },
      consent: {
        enabled: true,
        text: 'I agree to receive event updates.',
        required: true,
        marketing: false,
      },
      mapping: { company: { match: 'name_or_domain' } },
      after: { tags: ['Event'] },
    }),
  },
  {
    key: 'order-request',
    name: 'Order request',
    description:
      'Take an order request: what, how many and where. Payment is added in a later version.',
    category: 'order',
    definition: def({
      title: 'Place an order request',
      description: '<p>Tell us what you need and we will confirm availability and price.</p>',
      steps: [
        {
          id: 'main',
          blocks: [
            NAME,
            EMAIL,
            PHONE,
            field({
              id: 'product',
              kind: 'dropdown',
              label: 'Product',
              required: true,
              options: [
                { value: 'standard', label: 'Standard' },
                { value: 'premium', label: 'Premium' },
              ],
            }),
            field({
              id: 'quantity',
              kind: 'number',
              label: 'Quantity',
              required: true,
              width: 'half',
              validation: { min: 1, max: 1000 },
            }),
            field({
              id: 'address',
              kind: 'long_text',
              label: 'Delivery address',
              bind: { object: 'contact', property: 'address' },
              validation: { maxLen: 500 },
            }),
            field({ id: 'notes', kind: 'long_text', label: 'Notes', validation: { maxLen: 1000 } }),
          ],
        },
      ],
      settings: {
        submitLabel: 'Request order',
        successMessage: 'Thanks! We received your request and will confirm shortly.',
      },
      mapping: { company: { match: 'none' } },
      after: { tags: ['Order request'] },
    }),
  },
  {
    key: 'survey',
    name: 'Customer survey',
    description: 'A short satisfaction survey with a rating and a follow-up email.',
    category: 'survey',
    definition: def({
      title: 'How did we do?',
      description: '<p>It takes less than a minute.</p>',
      steps: [
        {
          id: 'main',
          blocks: [
            EMAIL,
            field({
              id: 'rating',
              kind: 'rating',
              label: 'How satisfied are you? (1 to 5)',
              required: true,
            }),
            field({
              id: 'liked',
              kind: 'checkbox_group',
              label: 'What did you like?',
              options: [
                { value: 'product', label: 'The product' },
                { value: 'service', label: 'The service' },
                { value: 'price', label: 'The price' },
                { value: 'speed', label: 'The speed' },
              ],
            }),
            field({
              id: 'comments',
              kind: 'long_text',
              label: 'Anything else?',
              validation: { maxLen: 2000 },
            }),
          ],
        },
      ],
      settings: { submitLabel: 'Send feedback', successMessage: 'Thank you for your feedback.' },
      mapping: { company: { match: 'none' } },
      after: { tags: ['Survey'] },
    }),
  },
];

export const FORM_TEMPLATES: readonly FormTemplate[] = TEMPLATES;

export function formTemplate(key: string): FormTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key);
}

/** The definition a blank form starts from: a name and an email, the minimum that lands a contact. */
export function blankDefinition(title: string): FormDefinition {
  return def({
    title,
    steps: [{ id: 'main', blocks: [NAME, EMAIL] }],
    settings: { submitLabel: 'Submit' },
  });
}
