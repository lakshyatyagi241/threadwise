import type { FieldType } from '@crm/contracts';

/**
 * The contact property types a new property made from the bot builder may have, by what the step stores in it. A button, list row or
 * card button stores its label, which is plain text, so a number or a date type would only ever hold a conflict. A question stores
 * what the customer typed, checked as the question's answer type (an email, a phone number, a number, a date), so the type that holds
 * that and plain text are offered; a text answer only takes text.
 */
export function compatiblePropertyTypes(
  noun: 'choice' | 'answer',
  answerType?: string,
): readonly FieldType[] {
  if (noun === 'choice') return ['text', 'long_text'];
  switch (answerType) {
    case 'email':
      return ['email', 'text', 'long_text'];
    case 'phone':
      return ['phone', 'text'];
    case 'number':
      return ['integer', 'decimal', 'text'];
    case 'date':
    case 'date_of_birth':
      return ['date', 'text'];
    default:
      return ['text', 'long_text'];
  }
}
