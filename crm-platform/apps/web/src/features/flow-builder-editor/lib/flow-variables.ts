import type { SimpleDoc } from './simple-model';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * The names a message can read from the flow so far: the answers the steps save (`var`) and the results an API or code step saves
 * (`save`), plus the flow's declared variables. In first-seen order, each once; `{{name}}` reads them at run time.
 */
export function flowVariables(doc: Pick<SimpleDoc, 'journeys' | 'vars'>): string[] {
  const names: string[] = [];
  const add = (n: string) => {
    if (n !== '' && !names.includes(n)) names.push(n);
  };
  for (const v of doc.vars) add(str(v.name));
  for (const j of doc.journeys)
    for (const s of j.steps) {
      add(str(s.data.var));
      add(str(s.data.save));
    }
  return names;
}
