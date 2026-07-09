// Build-time macros injected via Bun.build's `define` option. Each value is
// a string literal WITH its own quotes baked in, because define replacement
// does a textual substitution — `MACRO.VERSION` -> `"2.1.88"` (with quotes).
//
// `BUILD_TIME` is set at module load time so it reflects the actual build
// moment rather than a hardcoded date.

export const ENTRYPOINT = 'src/entrypoints/cli.tsx'

export const defines: Record<string, string> = {
  'MACRO.VERSION': '"2.1.88"',
  'MACRO.BUILD_TIME': `"${new Date().toISOString()}"`,
  'MACRO.FEEDBACK_CHANNEL': '"#claude-code-feedback"',
  'MACRO.ISSUES_EXPLAINER': '"https://github.com/anthropics/claude-code/issues"',
  'MACRO.NATIVE_PACKAGE_URL': '"@anthropic-ai/claude-code"',
  'MACRO.PACKAGE_URL': '"@anthropic-ai/claude-code"',
  'MACRO.VERSION_CHANGELOG': '""',
}
