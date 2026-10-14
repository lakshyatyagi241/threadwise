// Not a task (the runner loads only default exports with an id): the shared XSS corpus, mirrored in apps/web/e2e/security/xss.spec.ts.
export const PAYLOADS = [
  `<script>window.__xss=1</script>`,
  `"><script>window.__xss=1</script>`,
  `<img src=x onerror="window.__xss=1">`,
  `<svg onload="window.__xss=1">`,
  `<svg><script>window.__xss=1</script></svg>`,
  `javascript:window.__xss=1`,
  `<a href="javascript:window.__xss=1">x</a>`,
  `<iframe srcdoc="<script>parent.__xss=1</script>">`,
  `<details open ontoggle="window.__xss=1">`,
  `<body onload="window.__xss=1">`,
  `<math><mtext></mtext><script>window.__xss=1</script></math>`,
  `'-window.__xss=1-'`,
  `{{constructor.constructor('window.__xss=1')()}}`,
  '${window.__xss=1}',
  `<style>@import 'javascript:window.__xss=1';</style>`,
  `<input autofocus onfocus="window.__xss=1">`,
];
export default undefined;
