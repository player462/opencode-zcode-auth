// The "余额已用尽" fix: a gift-only account's plain model request that the
// Start Plan answers 1005 "exceed quota limit" inside a 200 now comes back
// as a 429 saying the account holds no gift and the check-in claims one.
import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { homedir, tmpdir } from "node:os"
import { realpathSync } from "node:fs"

mock.module("./attest.mjs", () => ({ solveCaptcha: async () => ({ error: "off in this file" }) }))

if (![tmpdir(), realpathSync(tmpdir())].some((t) => homedir().startsWith(t))) throw new Error("run in HOME=$(mktemp -d) bun test")
const { ZCodeAuthPlugin, _internal } = await import("./index.mjs")

const now = Math.trunc(Date.now() / 1000)
const jwt = (exp) => ["{}", JSON.stringify({ exp })].map((s) => Buffer.from(s).toString("base64url")).join(".") + ".sig"
const DEVICE = "11111111-2222-4333-8444-555555555555"
const TOKEN = jwt(now + 86400)
const ok = (data) => new Response(JSON.stringify({ code: 0, data }), { headers: { "content-type": "application/json" } })

const real = globalThis.fetch
beforeEach(() => {
  _internal.routes.clear()
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname.endsWith("/billing/balance")) return ok({ server_time: now, plans: [], balances: [] })
    if (url.pathname.endsWith("/marketing/touch")) return ok({ deliveries: [] })
    if (url.pathname === "/api/biz/subscription/list") return ok([])
    // the Start Plan endpoint: a 200 carrying the quota refusal
    if (url.pathname.endsWith("/v1/messages")) {
      return new Response(JSON.stringify({ code: 1005, msg: "exceed quota limit" }), { status: 200, headers: { "content-type": "application/json" } })
    }
    return new Response("", { status: 404 })
  }
})
afterEach(() => (globalThis.fetch = real))

test("a gift-only account's 1005 says the account has no gift, not just the vendor text", async () => {
  const h = await ZCodeAuthPlugin({ client: {} })
  const auth = { type: "oauth", access: "", refresh: JSON.stringify({ site: "zai", jwt: TOKEN, device: DEVICE }), expires: 0 }
  const loader = await h.auth.loader(async () => auth, { id: "zcode" })
  const res = await loader.fetch("https://api.z.ai/api/anthropic/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "GLM-5.3-Flash", max_tokens: 8, messages: [{ role: "user", content: "hi" }] }),
  })
  expect(res.status).toBe(429)
  const body = await res.json()
  expect(body.error.type).toBe("permission_error")
  expect(body.error.message).toContain("holds no gift plan right now")
  expect(body.error.message).toContain("exceed quota limit")
})
