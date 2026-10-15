'use client';

import { useTranslations } from 'next-intl';
import type { RegistrationProblem } from '../lib/registration-draft';

const NS = 'auth-registration-security.platform.registration.problems';

/** Turns a registration form problem into the sentence shown under its control. */
export function useProblemText(): (p: RegistrationProblem) => string {
  const tp = useTranslations(NS);
  return (p) => {
    switch (p.code) {
      case 'range':
        return tp('range', { min: p.min, max: p.max });
      case 'tooLong':
        return tp('tooLong', { max: p.max });
      case 'tooMany':
        return tp('tooMany', { max: p.max });
      case 'domainFormat':
        return tp('domainFormat', { entry: p.entry });
      default:
        return tp(p.code);
    }
  };
}
