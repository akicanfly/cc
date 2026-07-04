export class OTLPLogExporter {
  constructor(config?: Record<string, unknown>)
  export(logs: unknown, callback: () => void): void
  shutdown(): Promise<void>
}
