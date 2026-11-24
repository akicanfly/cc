import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
const server = new Server({ name: 'compatibility-fixture', version: '1.0.0' }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
  name: 'compat_fixture', description: 'Compatibility regression fixture',
  inputSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: {
    status: { anyOf: [{ type: 'string', enum: ['pending', 'completed'] }, { type: 'string', const: 'deleted' }] },
  }, required: ['status'], additionalProperties: false },
}] }))
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'fixture-ok' }] }))
await server.connect(new StdioServerTransport())
