import { redirect } from 'next/navigation';

/** Legacy WaDesk bookmark (WD-BSP-002): pricing and Meta cost live on the Message pricing page. */
export default function LegacyRateCardsRedirect(): never {
  redirect('/admin/wallet/pricing');
}
