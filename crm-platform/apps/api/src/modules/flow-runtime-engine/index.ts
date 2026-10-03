/**
 * Public surface of the flow runtime engine (FLR). Other modules import from here, never from the files behind it.
 * `FlowLaunchService.start` is the one door that starts a run; `FlowTriggerService` is what a domain calls when something happens
 * that flows may be bound to (an order placed).
 */
export { FlowRuntimeEngineModule } from './flow-runtime-engine.module';
export { FlowRuntimeEngineWorkerModule } from './flow-runtime-engine-worker.module';
export { FlowLaunchService, type LaunchInput, type LaunchOutcome } from './runtime/launch.service';
export { FlowTriggerService, type OrderPlaced } from './triggers/trigger.service';
export { FlowEngine } from './runtime/engine.service';
