import { useFormatter } from 'next-intl';
import { usdDigits } from './logic';

/** Formats a decimal USD string (or number) with enough places that a real cost never reads as zero. */
export function useUsd() {
  const format = useFormatter();
  return (value: string | number) => {
    const digits = usdDigits(value);
    return format.number(Number(value), {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  };
}
