/** Public surface of AI Training (AIAG). Other modules import from here, never from the files behind it. */
export { AiAgentsTrainingModule } from './ai-agents-training.module';
export { AiAgentsTrainingWorkerModule } from './ai-agents-training-worker.module';
/** The text reader other modules reuse for uploaded documents (PDF, DOCX, HTML, text); it answers a bad file with an AIAG_FILE_UNREADABLE problem. */
export { extractFileText } from './file-extract';
