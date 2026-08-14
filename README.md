# Claude Code

## Build and install

Build and link the `ccc` command from a checkout:

```sh
bun install
bun run build
bun link
ccc --version
```

Bun 1.3.10 or newer is required.

## Configure a provider

Start `ccc`, then run:

```text
/provider
```

The profile manager can add, edit, delete, and switch between named providers.
Each profile contains an OpenAI-compatible base URL and a masked API key. The
active profile and saved profiles live in `~/.claude/openai-compatible.json`
with user-only permissions. Changes take effect immediately.
Without environment variables or a saved profile, `ccc` defaults to the
keyless `opencode` profile at `https://opencode.ai/zen/v1`.
`OPENAI_COMPATIBLE_BASE_URL` and
`OPENAI_COMPATIBLE_API_KEY` (and their `OPENAI_*` aliases) continue to override
the saved values.

Install the latest stable prebuilt Bun package directly from GitHub Releases:

```sh
bun remove -g ccc-openai-compatible
bun install -g https://github.com/akicanfly/cc/releases/latest/download/ccc.tgz
```

The portable package requires Bun at runtime, runs on every platform supported
by Bun, and does not run lifecycle scripts. Each release also includes
standalone `ccc` binaries for Linux, macOS, and Windows on x64 and ARM64.

## Educational Use Only — Student Notes

I'm a student using this codebase purely for learning. I'm reading through the source and making small experimental modifications just to understand how it works. This is not production code and not meant to be used by anyone else.

## Proprietary Software of Anthropic

This is **proprietary software owned by Anthropic**, not open source. No license is granted by being in this repository.

Forking for personal study is fine. What's **not** okay: redistributing the code, rebranding or white-labeling it, shipping it under a different name, using Anthropic's trademarks, or sublicensing any of it. That's Anthropic's code, not mine to give away.

For the full terms, see: <https://code.claude.com/docs/en/legal-and-compliance>
