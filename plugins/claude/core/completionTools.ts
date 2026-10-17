import { randomUUID } from 'node:crypto';
import { createSdkMcpServer, tool, type Options } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { toolRunner, type CompletionRequest } from '@plugin-sdk/core';

/** One extra turn lets Claude answer after the last permitted tool call. */
export const FINAL_ANSWER_TURN = 1;
/** One rejected lookup turn preserves the final answer turn without allowing an unbounded retry loop. */
const SPENT_CALL_GRACE_TURNS = 1;

/** Only request tools enter this server; built-in and user-configured tools stay disabled. */
export function completionTools(req: CompletionRequest, signal: AbortSignal): Pick<Options, 'mcpServers' | 'allowedTools' | 'maxTurns'> {
  const runner = toolRunner(req, signal);
  const tools = (req.tools ?? []).map((t) => {
    let schema: z.ZodType;
    try {
      schema = z.fromJSONSchema(t.parameters);
      if (!(schema instanceof z.ZodObject)) throw new TypeError('expected an object schema');
    } catch (error) {
      throw new TypeError(`Claude tool "${t.name}" requires a supported object JSON Schema: ${error instanceof Error ? error.message : String(error)}`);
    }
    return tool(t.name, t.description, schema.shape, async (args) => {
      // The SDK handler exposes MCP request metadata, without a documented Claude tool_use ID.
      const result = await runner.call(t.name, args, randomUUID());
      return { content: [{ type: 'text', text: result.text }], isError: !result.ok };
    });
  });
  return {
    mcpServers: { chattypop: createSdkMcpServer({ name: 'chattypop', tools }) },
    allowedTools: tools.map((t) => `mcp__chattypop__${t.name}`),
    maxTurns: req.maxToolCalls! + FINAL_ANSWER_TURN + SPENT_CALL_GRACE_TURNS,
  };
}
