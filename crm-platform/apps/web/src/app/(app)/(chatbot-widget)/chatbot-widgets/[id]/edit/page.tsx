import { notFound } from 'next/navigation';
import { BuilderScreen } from '@/features/chatbot-widget/components/builder-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditChatbotWidgetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // WaDesk only matched numeric ids; anything that is not an id is a plain 404.
  if (!UUID.test(id)) notFound();
  return <BuilderScreen widgetId={id} />;
}
