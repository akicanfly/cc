const defines = {
  'MACRO.VERSION': '"1.0.34"',
  'MACRO.BUILD_TIMESTAMP': '"2026-03-31"',
  'MACRO.BUILD_TIME': '"2026-03-31T12:00:00Z"',
  'MACRO.FEEDBACK_CHANNEL': '"#claude-code-feedback"',
  'MACRO.ISSUES_EXPLAINER': '"https://github.com/anthropics/claude-code/issues"',
  'MACRO.NATIVE_PACKAGE_URL': '"@anthropic-ai/claude-code"',
  'MACRO.PACKAGE_URL': '"@anthropic-ai/claude-code"',
  'MACRO.VERSION_CHANGELOG': '""',
}

const result = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  target: 'bun',
  outdir: 'dist',
  define: defines,
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

for (const output of result.outputs) {
  const sizeInMb = output.size / 1024 / 1024
  console.log(`${output.path} ${sizeInMb.toFixed(2)} MB`)
}
