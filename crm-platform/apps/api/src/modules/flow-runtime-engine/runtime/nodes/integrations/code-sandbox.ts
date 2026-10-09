/**
 * The sandbox behind the Code node moved to `infra/sandbox` when the API Library began running the owner's JavaScript too (a domain
 * module may not import another's internals). This keeps the old path for the Code node and its tests.
 */
export {
  runUserCode,
  type SandboxOptions,
  type SandboxResult,
} from '../../../../../infra/sandbox/code-sandbox';
