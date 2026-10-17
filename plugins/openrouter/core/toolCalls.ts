import { toolRunner, type CompletionRequest, type ToolRunner } from '@plugin-sdk/core';

class InvalidArguments extends Error {
  constructor(readonly raw: string) {
    super('Invalid tool arguments JSON.');
  }
}

/** Keeps malformed arguments inside the runner's budget and failed-call events. */
export function requestToolRunner(req: CompletionRequest, signal: AbortSignal): ToolRunner {
  return toolRunner({
    ...req,
    tools: req.tools?.map((tool) => ({
      ...tool,
      run: async (args, toolSignal) => {
        if (args instanceof InvalidArguments) throw args;
        return tool.run(args, toolSignal);
      },
    })),
    onEvent: (event) => req.onEvent?.(
      event.type === 'toolCall' && event.args instanceof InvalidArguments ? { ...event, args: event.args.raw } : event,
    ),
  }, signal);
}

export function toolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return new InvalidArguments(raw);
  }
}
