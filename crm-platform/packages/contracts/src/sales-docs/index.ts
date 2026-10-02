/**
 * sales-docs (PROP / EST): proposals and estimates, one engine with a `kind` filter. See
 * docs/wadesk-port/inventory/sales-proposals-estimates.md ("Port decisions") and docs/api/sales-proposals-estimates.md.
 * `computeSalesDoc` in ./money is the one pricing function (the API and the web form's live preview both call it).
 */
export * from './money';
export * from './sales-doc';
export * from './public';
export * from './settings';
