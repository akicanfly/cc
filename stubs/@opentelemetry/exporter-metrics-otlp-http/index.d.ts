export class OTLPMetricExporter {
  constructor(config?: Record<string, unknown>)
  export(metrics: unknown, callback: () => void): void
  shutdown(): Promise<void>
}
