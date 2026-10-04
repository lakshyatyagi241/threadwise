/**
 * The executors a domain adds to the core set (WD-FLR-021 to 048). Each node group is an injectable class that implements
 * `NodeExecutor` (its `types` are the PascalCase names `compileGraph` produces) and is listed in the `useFactory` for this token in
 * `FlowRuntimeEngineModule`. A group reaches its domain through that domain's public facade and never through the engine.
 */
export const FLOW_NODE_EXECUTORS = Symbol('FLOW_NODE_EXECUTORS');
