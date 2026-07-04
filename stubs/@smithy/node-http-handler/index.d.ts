export class NodeHttpHandler {
  constructor(options?: Record<string, unknown>)
  handle(request: unknown): Promise<{ response: unknown }>
}
