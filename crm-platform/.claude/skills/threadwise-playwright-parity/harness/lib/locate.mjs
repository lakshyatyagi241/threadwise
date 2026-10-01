// Turn a locator SPEC into a Playwright Locator. Specs are plain data so they can live in twin specs and in config:
//   'css string' | {css} | {testid} | {role, name, exact, level, checked} | {label} | {placeholder} | {text}
//   | {any: [spec, spec]} (first that matches) | function(root) -> Locator | an existing Locator (returned as is)
// Add `has: spec` to filter by a descendant and `nth: n|'last'` to pick one.
export function resolveLocator(root, spec) {
  if (spec == null) throw new Error('no locator given');
  if (typeof spec.click === 'function' && typeof spec.locator === 'function') return spec; // already a Locator
  if (typeof spec === 'function') return spec(root);
  if (typeof spec === 'string') return root.locator(spec);
  let l;
  if (spec.any) l = spec.any.map((s) => resolveLocator(root, s)).reduce((a, b) => a.or(b));
  else if (spec.css) l = root.locator(spec.css);
  else if (spec.testid) l = root.getByTestId(spec.testid);
  else if (spec.role)
    l = root.getByRole(spec.role, {
      name: spec.name,
      exact: spec.exact,
      checked: spec.checked,
      level: spec.level,
    });
  else if (spec.label) l = root.getByLabel(spec.label, { exact: spec.exact });
  else if (spec.placeholder) l = root.getByPlaceholder(spec.placeholder, { exact: spec.exact });
  else if (spec.text) l = root.getByText(spec.text, { exact: spec.exact });
  else throw new Error(`unrecognised locator spec ${JSON.stringify(spec)}`);
  if (spec.has) l = l.filter({ has: resolveLocator(root, spec.has) });
  if (spec.nth !== undefined) l = spec.nth === 'last' ? l.last() : l.nth(spec.nth);
  return l;
}
