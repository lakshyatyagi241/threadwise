/** Public surface of the FAQ knowledge base (ADR-0021). Other modules import from here, never from the files behind it. */
export { FaqKnowledgeModule } from './faq-knowledge.module';
// FaqKnowledgeWorkerModule is imported by WorkersModule from its own file: it needs the flow runtime, which imports this barrel for
// the FAQ node, so exporting it here would make a cycle.
export { FaqFlowService, type FlowFaqAnswer, type FlowFaqInput } from './faq-flow.service';
