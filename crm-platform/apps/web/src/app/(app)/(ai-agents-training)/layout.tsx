import type { ReactNode } from 'react';
import { TrainingProviders } from '@/features/ai-agents-training/components/training-providers';

/** Shared frame of the AI Training screens: the toast region. */
export default function AiTrainingDomainLayout({ children }: { children: ReactNode }) {
  return <TrainingProviders>{children}</TrainingProviders>;
}
