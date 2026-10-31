import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { TOOLS, executeTool } from './tools.mjs';
import { fileService, sourceOptions } from './runtime.mjs';

export function createMcpServer(service) {
  const server = new Server({ name: 'trajectory-evidence', version: '0.2.1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } })) }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try { const result = await executeTool(service, request.params.name, request.params.arguments || {}, extra.signal); return { content: [{ type: 'text', text: JSON.stringify(result) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.onclose = () => service.dispose();
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const service = fileService(sourceOptions(process.argv.slice(2))), server = createMcpServer(service);
    await server.connect(new StdioServerTransport());
    for (const name of ['SIGINT', 'SIGTERM']) process.once(name, async () => { service.dispose(); await server.close(); });
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
