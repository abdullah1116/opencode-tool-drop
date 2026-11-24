# opencode-tool-drop

Permission-aware tool schema filter for [OpenCode](https://opencode.ai).

Strips tools an agent's `permissions` deny out of the tool schema before it reaches the model — smaller payloads, faster first tokens, and an audit line per request.

```mermaid
flowchart LR
    A[agent permissions<br/>deny rules] --> C[tool-drop hook]
    B[session context<br/>tools map] --> C
    C -->|"dropped: subagent, compress, ..."| D[model request<br/>smaller schema]
    C --> E[~/.local/state/opencode/<br/>tool-drop.log]
```

## Why

Every tool's JSON schema ships with every model request. Tools an agent is denied never help and always cost:

| Agent setup | Tools | Schema | First turn (cold) |
|---|---|---|---|
| no deny rules | 27 | ~25 KB ≈ 6.3k tokens | ~6.4 min on a local model |
| 6 deny rules | 24 | ~20 KB ≈ 5.0k tokens | ~4 min |

`tool-drop` makes the cut explicit and observable: it reads the deny list, drops matching tools from the schema, and logs what it did — so you can see exactly which tools each agent was offered.

## Install

npx + GitHub (no clone needed):

```bash
npx opencode@latest plugin add github:abdullah1116/opencode-tool-drop
```

Or with the OpenCode CLI directly:

```bash
opencode plugin add github:abdullah1116/opencode-tool-drop
```

Track the `main` branch for auto-updates (checked at startup and every 24 h):

```bash
opencode plugin add github:abdullah1116/opencode-tool-drop#main
```

Or add it manually to `opencode.json`:

```json
{
  "plugin": ["github:abdullah1116/opencode-tool-drop#main"]
}
```

Local development:

```bash
git clone git@github.com:abdullah1116/opencode-tool-drop.git
opencode plugin add ./opencode-tool-drop
```

> Requires OpenCode with package-plugin support (`opencode plugin add`). Changes under watched config directories reload automatically.

## How it works

```mermaid
flowchart TD
    S[session.hook: context · compaction · generate] --> L[read agent list<br/>cached, refreshed every 30s]
    L --> M[match event.agent<br/>gather deny rules with * wildcards]
    M --> F[filter event.tools<br/>drop denied names]
    F --> G[log: agent · perms · deny · tools · dropped]
    G --> Z[return]
    E1[any error] --> X[fail open: log + return untouched]
```

- Hooks: `context`, `compaction`, `generate` (where the tools map is built)
- Agent lookup: `ctx.agent.list()`, cached 30 s, refreshed on a timer
- Matching: deny rules of the form `action:resource` with `*` wildcards (`compress:*` matches the `compress` tool)
- **Fail-open**: every hook body is wrapped — a failure logs and returns the request untouched, never kills the model call
- If OpenCode already removed a denied tool upstream, the log shows `dropped=none` — the filter is a safety net, not a bypass

## Log

One line per request:

```
~/.local/state/opencode/tool-drop.log
2026-11-24T21:29:20Z first-request agent=qwen-local tools=27 agentsLoaded=true
2026-11-24T21:29:41Z hook agent=qwen-local tools=27 patterns=... dropped=none
```

Rotate or delete it freely; it is recreated on demand.

## Configure deny rules

Per agent, in `opencode.json`:

```json
{
  "agent": {
    "qwen-local": {
      "permissions": [
        { "action": "subagent", "resource": "*", "effect": "deny" },
        { "action": "compress", "resource": "*", "effect": "deny" }
      ]
    }
  }
}
```

`tool-drop` picks these up automatically — no plugin config of its own.

## License

All rights reserved by the author unless a license file says otherwise.
