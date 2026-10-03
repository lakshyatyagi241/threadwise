'use client';

import { useEffect, useMemo, useState } from 'react';
import { checkDocs, type CheckInput, type DocsCheck } from '../lib/json-docs';

/** A value that follows `value` after it has stopped changing for `ms` (the editors validate while the person types, not on every key). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return out;
}

/**
 * The validation of the two editors' text, kept a moment behind the typing. The returned `settled` is false while the checked text is
 * older than the typed text, so a screen can avoid saying "all good" about text it has not looked at yet.
 */
export function useDocsCheck(input: CheckInput): { check: DocsCheck; settled: boolean } {
  const manifestText = useDebounced(input.manifestText);
  const recipeText = useDebounced(input.recipeText);
  const { expect, categories } = input;
  const check = useMemo(
    () => checkDocs({ manifestText, recipeText, expect, categories }),
    [manifestText, recipeText, expect, categories],
  );
  return {
    check,
    settled: manifestText === input.manifestText && recipeText === input.recipeText,
  };
}
