import { randomUUID } from 'node:crypto';
import { createSdkMcpServer, tool, type Options } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { toolRunner, type CompletionRequest } from '@plugin-sdk/core';

/** One extra turn lets Claude answer after the last permitted tool call. */
export const FINAL_ANSWER_TURN = 1;

/** Only request tools enter this server; built-in and user-configured tools stay disabled. */
export function completionTools(req: CompletionRequest, signal: AbortSignal): Pick<Options, 'mcpServers' | 'allowedTools' | 'maxTurns'> {
  if (req.schema) throw new TypeError('Claude tools cannot be combined with a response schema.');
  const limit = req.maxToolCalls;
  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) throw new TypeError('Claude tools require a positive integer maxToolCalls.');
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
    maxTurns: limit + FINAL_ANSWER_TURN,
  };
}
