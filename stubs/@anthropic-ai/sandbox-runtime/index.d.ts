export type FsReadRestrictionConfig = Record<string, unknown>
export type FsWriteRestrictionConfig = Record<string, unknown>
export type IgnoreViolationsConfig = Record<string, unknown>
export type NetworkHostPattern = { host: string; port?: number }
export type NetworkRestrictionConfig = Record<string, unknown>
export type SandboxAskCallback = (hostPattern: NetworkHostPattern) => boolean | Promise<boolean>
export type SandboxDependencyCheck = { errors: string[]; warnings: string[] }
export type SandboxRuntimeConfig = Record<string, any>
export type SandboxViolationEvent = Record<string, unknown>

export class SandboxViolationStore {
  violations: SandboxViolationEvent[]
  add(violation: SandboxViolationEvent): void
  getAll(): SandboxViolationEvent[]
  clear(): void
}

export class SandboxManager {
  static checkDependencies(options?: unknown): SandboxDependencyCheck
  static isSupportedPlatform(): boolean
  static initialize(config?: SandboxRuntimeConfig, askCallback?: SandboxAskCallback): Promise<void>
  static updateConfig(config?: SandboxRuntimeConfig): void
  static reset(): Promise<void>
  static wrapWithSandbox(command: string, binShell?: string, customConfig?: Partial<SandboxRuntimeConfig>, abortSignal?: AbortSignal): Promise<string>
  static getFsReadConfig(): FsReadRestrictionConfig
  static getFsWriteConfig(): FsWriteRestrictionConfig
  static getNetworkRestrictionConfig(): NetworkRestrictionConfig
  static getIgnoreViolations(): IgnoreViolationsConfig | undefined
  static getAllowUnixSockets(): string[] | undefined
  static getAllowLocalBinding(): boolean | undefined
  static getEnableWeakerNestedSandbox(): boolean | undefined
  static getProxyPort(): number | undefined
  static getSocksProxyPort(): number | undefined
  static getLinuxHttpSocketPath(): string | undefined
  static getLinuxSocksSocketPath(): string | undefined
  static waitForNetworkInitialization(): Promise<boolean>
  static getSandboxViolationStore(): SandboxViolationStore
  static annotateStderrWithSandboxFailures(command: string, stderr: string): string
  static cleanupAfterCommand(): void
}

export const SandboxRuntimeConfigSchema: {
  safeParse(value: unknown): { success: true; data: unknown }
  parse<T>(value: T): T
}
