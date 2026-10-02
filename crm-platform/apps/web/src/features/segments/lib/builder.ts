import { dropMissingValues, findField, type FieldDef } from './fields';
import {
  addCondition,
  addGroup,
  changeField,
  changeOperator,
  findNode,
  moveNode,
  newCondition,
  removeNode,
  setCombinator,
  setValue,
  type Combinator,
  type Condition,
  type EditorValue,
  type Group,
} from './model';
import type { Operator } from './operators';

/** Every change the rule builder can make, as data: the builder is a reducer over the rule tree. */
export type RuleAction =
  | { type: 'addCondition'; groupId: string }
  | { type: 'addGroup'; groupId: string }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; direction: -1 | 1 }
  | { type: 'field'; id: string; field: string }
  | { type: 'operator'; id: string; operator: Operator }
  | { type: 'value'; id: string; value: EditorValue }
  | { type: 'combinator'; groupId: string; combinator: Combinator }
  /** Take the deleted values out of a condition (the "fix" of a stale reference). */
  | { type: 'dropMissing'; id: string; missing: string[] }
  /** Replace everything (the server's newer version was loaded). */
  | { type: 'reset'; root: Group };

/** What a new condition tests: the first field of the catalog (Journey > Stage), so it is never blank. */
export const defaultField = (catalog: readonly FieldDef[]): FieldDef | undefined => catalog[0];

export function ruleReducer(root: Group, action: RuleAction, catalog: readonly FieldDef[]): Group {
  switch (action.type) {
    case 'reset':
      return action.root;
    case 'addCondition': {
      const field = defaultField(catalog);
      return field ? addCondition(root, action.groupId, newCondition(field)) : root;
    }
    case 'addGroup': {
      const field = defaultField(catalog);
      return field ? addGroup(root, action.groupId, newCondition(field)) : root;
    }
    case 'remove':
      return removeNode(root, action.id);
    case 'move':
      return moveNode(root, action.id, action.direction);
    case 'field': {
      const field = findField(catalog, action.field);
      return field ? changeField(root, action.id, field) : root;
    }
    case 'operator': {
      const node = findNode(root, action.id);
      if (node?.kind !== 'condition') return root;
      const field = findField(catalog, node.field);
      return field ? changeOperator(root, action.id, field, action.operator) : root;
    }
    case 'value':
      return setValue(root, action.id, action.value);
    case 'combinator':
      return setCombinator(root, action.groupId, action.combinator);
    case 'dropMissing': {
      const node = findNode(root, action.id);
      if (node?.kind !== 'condition') return root;
      const next: Condition = dropMissingValues(node, action.missing);
      return setValue(root, action.id, next.value);
    }
  }
}
