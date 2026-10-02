import { HealthScreen } from '@/features/whatsapp-cloud-api-waba/components/health-screen';

type Props = { params: Promise<{ id: string }> };

export default async function WhatsappHealthPage({ params }: Props) {
  return <HealthScreen id={(await params).id} />;
}
