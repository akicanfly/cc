// Build-time macros injected via Bun.build's `define` option. Each value is
// a string literal WITH its own quotes baked in, because define replacement
// does a textual substitution — `MACRO.VERSION` -> `"2.1.88"` (with quotes).
//
// `BUILD_TIME` is set at module load time so it reflects the actual build
// moment rather than a hardcoded date.

export const ENTRYPOINT = 'src/entrypoints/cli.tsx'

export const defines: Record<string, string> = {
  'process.env.USER_TYPE': '"external"',
  'MACRO.VERSION': '"2.1.88"',
  'MACRO.BUILD_TIME': `"${new Date().toISOString()}"`,
  'MACRO.FEEDBACK_CHANNEL': '""',
  'MACRO.ISSUES_EXPLAINER': '"https://github.com/akicanfly/cc/issues"',
  'MACRO.NATIVE_PACKAGE_URL': '"https://github.com/akicanfly/cc"',
  'MACRO.PACKAGE_URL': '"cc-openai-compatible"',
  'MACRO.VERSION_CHANGELOG': '""',
}
