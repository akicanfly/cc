import { defines } from './macros'

const defineArgs = Object.entries(defines).flatMap(([k, v]) => ['--define', `${k}=${v}`])

const args = [...defineArgs, 'src/entrypoints/cli.tsx', ...process.argv.slice(2)]

const proc = Bun.spawn(['bun', ...args], {
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
})

await proc.exited
process.exitCode = await proc.exitCode
