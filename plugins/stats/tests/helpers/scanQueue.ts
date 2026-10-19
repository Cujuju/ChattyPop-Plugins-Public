/** Five hundred rows bound each synchronous read before other core requests can run. */
export const SCAN_BATCH_SIZE = 500;
export const yieldToQueue = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
