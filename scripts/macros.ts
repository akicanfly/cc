// Build-time macros injected via Bun.build's `define` option. Each value is
// a string literal WITH its own quotes baked in, because define replacement
// does a textual substitution — `MACRO.VERSION` -> `"2.1.88"` (with quotes).
//
// `BUILD_TIME` is set at module load time so it reflects the actual build
// moment rather than a hardcoded date.

import packageMetadata from '../package.json' with { type: 'json' }

export const ENTRYPOINT = 'src/entrypoints/cli.tsx'

const BASE_VERSION = packageMetadata.version
const buildVersion = process.env.CC_BUILD_VERSION ?? `${BASE_VERSION}-v0`

if (
  !new RegExp(
    `^${BASE_VERSION.replaceAll('.', '\\.')}-v(?:0|[1-9]\\d*)(?:-test\\.[1-9]\\d*)?$`,
  ).test(buildVersion)
) {
  throw new Error(
    `CC_BUILD_VERSION must match ${BASE_VERSION}-v<number> or ${BASE_VERSION}-v<number>-test.<number>`,
  )
}

export const defines: Record<string, string> = {
  'process.env.USER_TYPE': '"external"',
  'MACRO.VERSION': JSON.stringify(buildVersion),
  'MACRO.BUILD_TIME': `"${new Date().toISOString()}"`,
  'MACRO.FEEDBACK_CHANNEL': '""',
  'MACRO.ISSUES_EXPLAINER': '"https://github.com/akicanfly/cc/issues"',
  'MACRO.NATIVE_PACKAGE_URL': '"https://github.com/akicanfly/cc"',
  'MACRO.PACKAGE_URL': '"cc-openai-compatible"',
  'MACRO.VERSION_CHANGELOG': '""',
}
