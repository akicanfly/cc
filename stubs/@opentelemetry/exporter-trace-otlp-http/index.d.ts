export class OTLPTraceExporter {
  constructor(config?: Record<string, unknown>)
  export(spans: unknown, callback: () => void): void
  shutdown(): Promise<void>
}
