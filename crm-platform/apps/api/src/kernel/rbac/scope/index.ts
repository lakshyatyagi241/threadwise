export {
  MAX_TEAM_DEPTH,
  memberTeamIdsSql,
  scopeOwnerCondition,
  scopeOwnerPredicate,
  teamPeersBelowSql,
  teamPeersSql,
  teamTreeIdsSql,
  type ScopeActor,
  type ScopeColumns,
} from './scope-sql';
export {
  conversationScopeAllows,
  conversationScopeCondition,
  type ConversationAssignment,
  type ConversationScopeViewer,
} from './conversation-scope';
export { withDescendants } from './team-tree';
export {
  canActOn,
  isTeamPeer,
  ScopeResolver,
  teamIdsForScope,
  teamIdsOf,
  teamPeers,
  teamPeersBelow,
  teamTreeIdsOf,
} from './scope-resolver';
