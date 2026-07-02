// Stub for @anthropic-ai/mcpb

function success(data) {
  return { success: true, data };
}

function failure(message) {
  return {
    success: false,
    error: {
      flatten() {
        return { fieldErrors: {}, formErrors: [message] };
      },
    },
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const McpbManifestSchema = {
  safeParse(value) {
    if (!isObject(value)) return failure("Manifest must be an object");
    if (typeof value.name !== "string" || value.name.length === 0) {
      return failure("name is required");
    }
    if (!isObject(value.author) || typeof value.author.name !== "string") {
      return failure("author.name is required");
    }
    return success(value);
  },
};

function substituteUserConfig(value, userConfig) {
  if (typeof value === "string") {
    return value.replace(/\$\{user_config\.([^}]+)\}/g, (_match, key) => {
      const replacement = userConfig?.[key];
      return replacement === undefined ? "" : String(replacement);
    });
  }
  if (Array.isArray(value))
    return value.map((item) => substituteUserConfig(item, userConfig));
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        substituteUserConfig(item, userConfig),
      ]),
    );
  }
  return value;
}

export async function getMcpConfigForManifest({
  manifest,
  extensionPath,
  userConfig = {},
} = {}) {
  if (!manifest?.server) return null;

  const server = substituteUserConfig(manifest.server, userConfig);

  if (server.type === "node" && server.entry_point) {
    return {
      type: "stdio",
      command: process.execPath,
      args: [
        new URL(
          server.entry_point,
          `file://${extensionPath.replace(/\\/g, "/")}/`,
        ).pathname,
      ],
      env: server.env,
    };
  }

  if (server.type === "python" && server.entry_point) {
    return {
      type: "stdio",
      command: "python",
      args: [
        new URL(
          server.entry_point,
          `file://${extensionPath.replace(/\\/g, "/")}/`,
        ).pathname,
      ],
      env: server.env,
    };
  }

  if (server.command) {
    return {
      type: "stdio",
      command: server.command,
      args: server.args ?? [],
      env: server.env,
    };
  }

  if (server.url) {
    return {
      type: server.type === "sse" ? "sse" : "http",
      url: server.url,
      headers: server.headers,
    };
  }

  return null;
}
