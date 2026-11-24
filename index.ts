import { appendFileSync } from "node:fs"

type Permission = {
  action: string
  resource?: string
  effect: "allow" | "ask" | "deny"
}

type HookEvent = {
  agent?: string
  tools?: Record<string, unknown>
}

const stateHome = process.env.XDG_STATE_HOME || `${process.env.HOME || "/tmp"}/.local/state`
const LOGFILE = process.env.TOOL_DROP_LOG || `${stateHome}/opencode/tool-drop.log`
const SKIP_AGENTS = (process.env.TOOL_DROP_SKIP_AGENTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

const say = (msg: string) => {
  try {
    appendFileSync(LOGFILE, new Date().toISOString() + " " + msg + "\n")
  } catch {}
}

const match = (pattern: string, name: string) => {
  if (pattern === "*" || pattern === name) return true
  if (!pattern.includes("*")) return false
  return new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, (c) => "\\" + c).replace(/\*/g, ".*") + "$").test(name)
}

const normalize = (res: unknown): any[] => {
  if (Array.isArray(res)) return res
  const r = res as Record<string, unknown> | undefined
  if (r && typeof r === "object") {
    for (const key of ["agents", "items", "list", "results", "data"]) {
      const v = (r as any)[key]
      if (Array.isArray(v)) return v
    }
    for (const key of Object.keys(r)) {
      const v = (r as any)[key]
      if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === "object") return v
    }
  }
  return []
}

export const id = "tool-drop"

let reported = false
let shapeLogged = false

export async function setup(ctx: any) {
  say(`setup start options=${JSON.stringify(ctx?.options ?? {})} skip=${SKIP_AGENTS.join("|") || "none"} log=${LOGFILE}`)
  const block = (ctx?.options?.block ?? {}) as Record<string, string[]>
  let agents: any[] = []
  let warned = false

  const refresh = async () => {
    try {
      const res = await ctx.agent.list()
      if (!shapeLogged) {
        shapeLogged = true
        const raw = JSON.stringify(res) ?? "undefined"
        say(`list shape type=${Array.isArray(res) ? "array" : typeof res} keys=${Object.keys(res ?? {}).join("|")} raw=${raw.slice(0, 500)}`)
      }
      const list = normalize(res)
      if (list.length > 0) {
        agents = list
        if (!reported) {
          reported = true
          const first = list[0]
          say(`agents=${list.length} ids=${list.slice(0, 6).map((a: any) => a?.id ?? a?.name ?? "?").join(",")} firstKeys=${Object.keys(first ?? {}).join("|")}`)
        }
      } else {
        say(`agents EMPTY raw=${JSON.stringify(res)?.slice(0, 300)}`)
      }
    } catch (e) {
      say(`agent.list FAILED ${String(e)}`)
    }
  }

  await refresh()
  const timer = setInterval(() => void refresh(), 30_000)

  const rulesFor = (agentID: string): Permission[] => {
    const rules: Permission[] = []
    const info = agents.find((a: any) => a?.id === agentID)
    if (!info) {
      say(`agent NOT FOUND id=${agentID} known=${agents.map((a) => a?.id).slice(0, 12).join(",")}`)
      return rules
    }
    const perms = (info.permissions ?? info.permission ?? []) as Permission[]
    const arr = (Array.isArray(perms) ? perms : []).filter((p) => p && typeof p.action === "string")
    say(`agent=${agentID} perms=${arr.length} rules=${arr.map((p) => `${p.effect}:${p.action}:${p.resource ?? "*"}`).join(",")}`)
    for (const p of arr) rules.push(p)
    for (const pat of block[agentID] ?? []) rules.push({ action: pat, resource: "*", effect: "deny" })
    return rules
  }

  const isDenied = (rules: Permission[], tool: string) => {
    let effect: string | undefined
    for (const r of rules) {
      if (r.resource && r.resource !== "*") continue
      if (match(r.action, tool)) effect = r.effect
    }
    return effect === "deny"
  }

  const hook = (event: HookEvent) => {
    try {
      if (!event?.tools) {
        say("hook called with NO tools")
        return
      }
      const agentID = String(event?.agent ?? "")
      const names = Object.keys(event.tools)
      if (!agentID) {
        say(`hook agent EMPTY keys=${Object.keys(event).join(",")} tools=${names.length}`)
        return
      }
      if (SKIP_AGENTS.some((pattern) => match(pattern, agentID))) {
        say(`hook agent=${agentID} skipped(SKIP_AGENTS) tools=${names.length}`)
        return
      }
      const rules = rulesFor(agentID)
      const dropped = names.filter((name) => isDenied(rules, name))
      say(`hook agent=${agentID} tools=${names.length} rules=${rules.length} dropped=${dropped.join(",") || "none"}`)
      for (const name of dropped) delete event.tools[name]
    } catch (e) {
      if (!warned) {
        warned = true
        say(`hook ERROR ${String(e)}`)
      }
    }
  }

  for (const kind of ["context", "compaction", "generate"]) await ctx.session.hook(kind, hook)
  say("hooks registered: context, compaction, generate")
  return () => clearInterval(timer)
}

export default { id, setup }
