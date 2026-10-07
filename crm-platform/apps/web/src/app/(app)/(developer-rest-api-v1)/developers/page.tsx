import { DeveloperScreen } from '@/features/developer-rest-api-v1/components/developer-screen';
import { baseUrlOf } from '@/features/developer-rest-api-v1/lib/keys-model';

/** The base URL shown on the page is the public address of the customer API: PUBLIC_API_URL, else APP_URL, else the proxy target. */
const publicApiOrigin = () =>
  process.env.PUBLIC_API_URL ??
  process.env.APP_URL ??
  process.env.API_URL ??
  'http://localhost:3000';

export const dynamic = 'force-dynamic';

export default function DevelopersPage() {
  return <DeveloperScreen baseUrl={baseUrlOf(publicApiOrigin())} />;
}
