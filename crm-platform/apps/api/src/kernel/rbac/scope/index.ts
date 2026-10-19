export {
  memberTeamIdsSql,
  scopeOwnerCondition,
  scopeOwnerPredicate,
  teamPeersSql,
  type ScopeActor,
  type ScopeColumns,
} from './scope-sql';
export {
  conversationScopeAllows,
  conversationScopeCondition,
  type ConversationAssignment,
  type ConversationScopeViewer,
} from './conversation-scope';
export { ScopeResolver } from './scope-resolver';
