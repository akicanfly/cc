import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import stripAnsi from 'strip-ansi'

const project = resolve(import.meta.dir, '..')
const cli = join(project, 'dist/cli.js')
const prompt = 'Use Bash to run pwd once, then reply with compatibility-ok.'

beforeAll(async () => {
  const build = Bun.spawn([process.execPath, 'scripts/build.ts', '--no-clean'], { cwd: project, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NODE_ENV: 'production', CI: '' } })
  const [code, stdout, stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()])
  if (code !== 0) throw new Error(`CLI test build failed: ${stdout}\n${stderr}`)
}, 30000)

function completion(responses: boolean, tool: boolean) {
  const call = { command: 'pwd', description: 'Read the test working directory' }
  if (responses) return { id: 'resp_fixture', status: 'completed', output: [
    { type: 'reasoning', id: 'rs_fixture', encrypted_content: 'encrypted-fixture', summary: [{ type: 'summary_text', text: 'Check the directory.' }] },
    tool ? { type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: 'Bash', arguments: JSON.stringify(call) }
      : { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'compatibility-ok' }] },
  ], usage: { input_tokens: 100, output_tokens: 5 } }
  return { id: 'chat_fixture', choices: [{ finish_reason: tool ? 'tool_calls' : 'stop', message: {
    role: 'assistant', content: tool ? null : 'compatibility-ok', reasoning_content: 'Check the directory.',
    ...(tool ? { tool_calls: [{ id: 'call_fixture', type: 'function', function: { name: 'Bash', arguments: JSON.stringify(call) } }] } : {}),
  } }], usage: { prompt_tokens: 100, completion_tokens: 5 } }
}

function streamResponse(payload: any, responses: boolean): Response {
  const events: any[] = []
  if (responses) {
    for (const [index, item] of payload.output.entries()) {
      events.push({ type: 'response.output_item.added', output_index: index, item: { ...item, arguments: item.type === 'function_call' ? '' : undefined } })
      if (item.type === 'function_call') events.push({ type: 'response.function_call_arguments.delta', output_index: index, delta: item.arguments })
      if (item.type === 'message') events.push({ type: 'response.output_text.delta', output_index: index, delta: item.content[0].text })
      if (item.type === 'reasoning') events.push({ type: 'response.reasoning_summary_text.delta', output_index: index, delta: item.summary[0].text })
      events.push({ type: 'response.output_item.done', output_index: index, item })
    }
    events.push({ type: 'response.completed', response: payload })
  } else events.push({ ...payload, choices: payload.choices.map((c: any) => ({ ...c, delta: c.message, message: undefined })) })
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n', { headers: { 'content-type': 'text/event-stream' } })
}

async function runScenario(options: { mode: 'print' | 'interactive'; api: 'chat' | 'responses'; mcp: boolean; failure?: 'auth' | 'stream' }) {
  const interactive = options.mode === 'interactive'
  const responses = options.api === 'responses'
  const mcp = options.mcp
  const authError = options.failure === 'auth'
  const streamError = options.failure === 'stream'
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ccc-cli-compat-')))
  const config = join(root, 'config')
  await mkdir(config)
  const requests: any[] = []
  const headers: Headers[] = []
  let proc: ReturnType<typeof Bun.spawn> | undefined
  let terminal: Bun.Terminal | undefined
  let output = ''
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
    const path = new URL(request.url).pathname
    if (path.endsWith('/models')) return Response.json({ data: [{ id: 'compat-e2e' }] })
    const body = await request.json() as any
    const main = body.model === 'compat-e2e' && body.tools?.length > 0
    if (main) { requests.push(body); headers.push(request.headers) }
    if (main && streamError) {
      const first = responses ? { type: 'response.output_text.delta', output_index: 0, delta: 'partial' } : { choices: [{ delta: { content: 'partial' } }] }
      const failure = responses ? { type: 'response.failed', response: { error: { code: 'server_error', message: 'fixture stream failed' } } } : { error: { code: 'server_error', message: 'fixture stream failed' } }
      return new Response(`data: ${JSON.stringify(first)}\n\ndata: ${JSON.stringify(failure)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    }
    if (main && authError) return Response.json({ error: { code: 'invalid_api_key', message: 'fixture authentication failed' } })
    const toolResult = responses ? body.input?.some((m: any) => m.type === 'function_call_output') : body.messages?.some((m: any) => m.role === 'tool')
    const payload = completion(responses, main && !toolResult)
    return body.stream ? streamResponse(payload, responses) : Response.json(payload)
  } })
  try {
    await writeFile(join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.88', theme: 'dark', projects: { [root]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }))
    await writeFile(join(config, 'openai-compatible.json'), JSON.stringify({ version: 1, activeProfile: 'fixture', profiles: [{ name: 'fixture', baseURL: `http://127.0.0.1:${server.port}/v1`, apiKey: 'fixture-key', apiMode: responses ? 'responses' : 'chat-completions', headers: { 'X-Fixture-Profile': 'selected' }, chatCompletionsPath: '/custom/chat', responsesPath: '/custom/responses' }] }))
    const env = { ...process.env, CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', TERM: 'xterm-256color', NO_COLOR: '1', NODE_ENV: 'production' }
    delete (env as Record<string, string | undefined>).CI
    for (const key of Object.keys(env)) if (/^(OPENAI_|OPENAI_COMPATIBLE_|ANTHROPIC_|CLAUDE_CODE_ENABLE_TASKS)/.test(key)) delete (env as Record<string, string | undefined>)[key]
    const mcpConfig = mcp ? { mcpServers: { fixture: { command: process.execPath, args: [join(project, 'scripts/fixtures/compatibilityMcp.ts')] } } } : { mcpServers: {} }
    const args = [process.execPath, cli, '--model', 'compat-e2e', '--max-turns', '3', '--allowedTools', 'Bash(pwd)', '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--strict-mcp-config', '--mcp-config', JSON.stringify(mcpConfig)]
    let submitted = false
    let trusted = false
    let exited = false
    if (interactive) {
      terminal = new Bun.Terminal({ cols: 100, rows: 30, data(term, chunk) {
        output += new TextDecoder().decode(chunk)
        const clean = stripAnsi(output)
        if (!trusted && clean.replace(/\s/g, '').includes('Yes,Itrustthisfolder')) { trusted = true; term.write('\r'); return }
        if (!submitted && /❯(?:\s|$)/.test(clean.slice(-2000))) { submitted = true; term.write(prompt + '\r') }
        if (submitted && /●\s*compatibility-ok/.test(clean) && requests.length >= 2 && !exited) { exited = true; term.write('/exit\r') }
      } })
      proc = Bun.spawn(args, { cwd: root, env, terminal })
    } else {
      proc = Bun.spawn([...args, '-p', prompt], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
    }
    const timeout = setTimeout(() => proc?.kill(), 20000)
    let code: number
    try {
      if (interactive) code = await proc.exited
      else {
        const result = await Promise.all([proc.exited, new Response(proc.stdout as ReadableStream).text(), new Response(proc.stderr as ReadableStream).text()])
        code = result[0]; output = result[1] + result[2]
      }
    } finally { clearTimeout(timeout) }
    if (authError || streamError) {
      expect(code).not.toBe(0)
      expect(requests).toHaveLength(1)
      expect(output).toContain(authError ? 'fixture authentication failed' : 'fixture stream failed')
      return
    }
    if (code !== 0) throw new Error(`CLI scenario failed (${code}): ${stripAnsi(output).slice(-5000)}`)
    expect(stripAnsi(output)).toContain('compatibility-ok')
    expect(requests.length).toBeGreaterThanOrEqual(2)
    expect(headers.every(header => header.get('x-fixture-profile') === 'selected')).toBe(true)
    expect(requests.every(body => !('reasoning_effort' in body) && !('reasoning' in body))).toBe(true)
    const names = requests[0].tools.map((tool: any) => responses ? tool.name : tool.function.name)
    expect(names).toContain('Bash')
    expect(names).toContain('Read')
    expect(names.includes('TaskUpdate')).toBe(interactive)
    expect(names.some((name: string) => name.includes('compat_fixture'))).toBe(mcp)
    if (mcp) {
      const fixture = requests[0].tools.find((tool: any) => (responses ? tool.name : tool.function.name).includes('compat_fixture'))
      expect((responses ? fixture.parameters : fixture.function.parameters).properties.status.anyOf[1].const).toBe('deleted')
    }
    if (responses) expect(requests.at(-1).input).toContainEqual(expect.objectContaining({ type: 'reasoning', id: 'rs_fixture', encrypted_content: 'encrypted-fixture' }))
  } finally {
    proc?.kill()
    terminal?.close()
    server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}

describe('built CLI provider integration', () => {
  for (const responses of [false, true]) {
    test(`print mode completes a tool round trip with MCP schemas over ${responses ? 'Responses' : 'Chat Completions'}`, () => runScenario({ mode: 'print', api: responses ? 'responses' : 'chat', mcp: true }), 30000)
    test.skipIf(process.platform === 'win32')(`interactive task tools complete a round trip over ${responses ? 'Responses' : 'Chat Completions'}`, () => runScenario({ mode: 'interactive', api: responses ? 'responses' : 'chat', mcp: false }), 30000)
  }
  test('HTTP 200 authentication errors do not retry generation', () => runScenario({ mode: 'print', api: 'chat', mcp: false, failure: 'auth' }), 30000)
  for (const api of ['chat', 'responses'] as const) test(`partial ${api} streams never replay generation`, () => runScenario({ mode: 'print', api, mcp: false, failure: 'stream' }), 30000)
})
