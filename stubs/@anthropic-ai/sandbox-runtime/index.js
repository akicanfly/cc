// Stub for @anthropic-ai/sandbox-runtime

const defaultFsReadConfig = { allow: [], deny: [] };
const defaultFsWriteConfig = { allow: [], deny: [] };
const defaultNetworkConfig = { allowedDomains: [], deniedDomains: [] };

export class SandboxViolationStore {
  constructor() {
    this.violations = [];
  }

  add(violation) {
    this.violations.push(violation);
  }

  getAll() {
    return [...this.violations];
  }

  clear() {
    this.violations.length = 0;
  }
}

const violationStore = new SandboxViolationStore();
let currentConfig = {};

export class SandboxManager {
  static checkDependencies() {
    return {
      errors: ["sandbox-runtime is stubbed in this source build"],
      warnings: [],
    };
  }

  static isSupportedPlatform() {
    return false;
  }

  static async initialize(config = {}) {
    currentConfig = config;
  }

  static updateConfig(config = {}) {
    currentConfig = config;
  }

  static async reset() {
    currentConfig = {};
    violationStore.clear();
  }

  static async wrapWithSandbox(command) {
    return command;
  }

  static getFsReadConfig() {
    return currentConfig.filesystem?.read ?? defaultFsReadConfig;
  }

  static getFsWriteConfig() {
    return currentConfig.filesystem?.write ?? defaultFsWriteConfig;
  }

  static getNetworkRestrictionConfig() {
    return currentConfig.network ?? defaultNetworkConfig;
  }

  static getIgnoreViolations() {
    return currentConfig.ignoreViolations;
  }

  static getAllowUnixSockets() {
    return currentConfig.allowUnixSockets;
  }

  static getAllowLocalBinding() {
    return currentConfig.allowLocalBinding;
  }

  static getEnableWeakerNestedSandbox() {
    return currentConfig.enableWeakerNestedSandbox;
  }

  static getProxyPort() {
    return currentConfig.proxyPort;
  }

  static getSocksProxyPort() {
    return currentConfig.socksProxyPort;
  }

  static getLinuxHttpSocketPath() {
    return currentConfig.linuxHttpSocketPath;
  }

  static getLinuxSocksSocketPath() {
    return currentConfig.linuxSocksSocketPath;
  }

  static async waitForNetworkInitialization() {
    return false;
  }

  static getSandboxViolationStore() {
    return violationStore;
  }

  static annotateStderrWithSandboxFailures(_command, stderr) {
    return stderr;
  }

  static cleanupAfterCommand() {}
}

export const SandboxRuntimeConfigSchema = {
  safeParse(value) {
    return { success: true, data: value };
  },
  parse(value) {
    return value;
  },
};
