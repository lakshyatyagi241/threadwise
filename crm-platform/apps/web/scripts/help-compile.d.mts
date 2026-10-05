import type { HelpDoc } from '../src/features/help-center/types';

export interface HelpSourceFile {
  /** The `features/<domain>` folder name. */
  domain: string;
  /** `<slug>.md`, or `<slug>.<locale>.md` for a translation. */
  file: string;
  source: string;
}

/** The areas a doc may sit in (mirrors `HELP_AREAS` in `types.ts`; a test keeps the two equal). */
export const AREA_IDS: readonly string[];

/** Compiles every help file into docs; throws an Error whose message starts with `<domain>/help/<file>: ` on a bad file. */
export function compileRegistry(files: HelpSourceFile[]): HelpDoc[];
/** The TypeScript source of `features/_registry/help.generated.ts`. */
export function renderGenerated(docs: HelpDoc[]): string;
export function slugify(text: string): string;
