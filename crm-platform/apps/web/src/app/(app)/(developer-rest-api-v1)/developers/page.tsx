import { publicApiOrigin } from '@/lib/public-api-origin';
import { DeveloperScreen } from '@/features/developer-rest-api-v1/components/developer-screen';
import { baseUrlOf } from '@/features/developer-rest-api-v1/lib/keys-model';

export const dynamic = 'force-dynamic';

export default function DevelopersPage() {
  return <DeveloperScreen baseUrl={baseUrlOf(publicApiOrigin())} />;
}
