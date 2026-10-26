// checkin claims the gift plans ZCode holds for the account (the 1024 Dev
// Day gift among them) through the app's own POST /billing/claim, and an
// account with no plan at all can still be added while it holds one.
//
// The claim is not gated on the Aliyun captcha attestation the app's
// renderer makes: a claim without it is answered on the gift's own terms.
// A claim that does ask for it (3007) is reported as `captcha` and never
// solved here. The preview goes as ZCode 3.16.3, the first client whose
// gift list names the 1024 gift; 3.14.3 was told "nothing to claim".
import { afterEach, beforeEach, expect, test } from "bun:test"
import { homedir, tmpdir } from "node:os"
import { realpathSync } from "node:fs"

if (![tmpdir(), realpathSync(tmpdir())].some((t) => homedir().startsWith(t))) throw new Error("run in HOME=$(mktemp -d) bun test")
const { ZCodeAuthPlugin, _internal } = await import("./index.mjs")

const now = Math.trunc(Date.now() / 1000)
const jwt = (exp) => ["{}", JSON.stringify({ exp })].map((s) => Buffer.from(s).toString("base64url")).join(".") + ".sig"
const DEVICE = "11111111-2222-4333-8444-555555555555"
const TOKEN = jwt(now + 86400)
const ok = (data) => new Response(JSON.stringify({ code: 0, data }), { headers: { "content-type": "application/json" } })

// the 1024 Dev Day gift as ZCode's preview names it to a 3.16.3 client
const GIFT_1024 = {
  plan_id: "zcode-v3-start-plan-1024", name: "ZCode 1024 Dev Day", priority: 101,
  entitlements: [
    { entitlement_id: "ent-zcode-v3-start-plan-1024-1", show_name: "GLM-5.3-Flash", capabilities: ["model:glm-5.3-flash"], grant_units: 300000000 },
    { entitlement_id: "ent-zcode-v3-start-plan-1024-2", show_name: "GLM-5.3", capabilities: ["model:glm-5.3"], grant_units: 200000000 },
  ],
}
const PREVIEW_GIFT = { server_time: now, plans: [GIFT_1024] }
const PREVIEW_NONE = { server_time: now, plans: [] }

// a gift-only account's balance: the 1024 gift is on it, its buckets not yet
// effective (the card has no bucket to draw, as ZCode answers the minute it
// is claimed)
const BALANCE_GIFT = {
  server_time: now,
  plans: [{ user_plan_id: "upl_1", plan_id: "zcode-v3-start-plan-1024", name: "ZCode 1024 Dev Day", status: "active", starts_at: now, ends_at: now + 3 * 86400 }],
  balances: [],
}

const auth = () => ({ type: "oauth", access: TOKEN, refresh: JSON.stringify({ site: "zai", jwt: TOKEN, device: DEVICE }), expires: 0 })

const real = globalThis.fetch
let calls
let preview
let claim
beforeEach(() => {
  _internal.routes.clear()
  _internal.blocked.clear()
  calls = []
  preview = () => ok(PREVIEW_GIFT)
  claim = () => new Response(JSON.stringify({ code: 0, msg: "", data: { server_time: now, plan: { plan_id: "zcode-v3-start-plan-1024", user_plan_id: "upl_1", status: "active" } } }), { headers: { "content-type": "application/json" } })
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const headers = Object.fromEntries(new Headers(init.headers ?? (input instanceof Request ? input.headers : {})))
    const c = { path: url.pathname, method: init.method ?? "GET", query: Object.fromEntries(url.searchParams), headers, body: init.body }
    calls.push(c)
    if (url.pathname === "/api/v1/zcode-plan/billing/preview") return preview(c)
    if (url.pathname === "/api/v1/zcode-plan/billing/claim") return claim(c)
    if (url.pathname === "/api/v1/zcode-plan/billing/balance") return ok(BALANCE_GIFT)
    if (url.pathname === "/api/biz/subscription/list") return ok([])
    if (url.pathname === "/api/monitor/usage/quota/limit") return ok({ limits: [] })
    return new Response("", { status: 404 })
  }
})
afterEach(() => (globalThis.fetch = real))

const hooks = async () => ZCodeAuthPlugin({ client: { auth: { set: async () => {} } } })
const checkin = async (credentials = auth()) => (await hooks()).auth.checkin(async () => credentials, { id: "zcode" })

test("checkin claims the 1024 Dev Day gift through the app's own claim", async () => {
  const r = await checkin()
  expect(r.outcome).toBe("claimed")
  expect(r.message).toContain("ZCode 1024 Dev Day")

  // the preview went as a client whose gift list names it, and the claim as
  // the app's own POST
  const p = calls.find((c) => c.path.endsWith("/preview"))
  expect(p.query.app_version).toBe("3.16.3")
  const c = calls.find((x) => x.path.endsWith("/claim"))
  expect(c.method).toBe("POST")
  expect(JSON.parse(c.body)).toEqual({ plan_id: "zcode-v3-start-plan-1024" })
  const h = (name) => c.headers[name] ?? c.headers[name.toLowerCase()]
  expect(h("Authorization")).toBe("Bearer " + TOKEN)
  expect(h("X-Device-Mid")).toBe(DEVICE)
  expect(h("X-ZCode-App-Version")).toBe("3.16.3")
  // no captcha attestation is ever sent: solving one is not the plugin's job
  expect(Object.keys(c.headers).some((k) => /aliyun-captcha/i.test(k))).toBe(false)
})

test("nothing to claim is inactive, not a failure magpie retries all day", async () => {
  preview = () => ok(PREVIEW_NONE)
  const r = await checkin()
  expect(r.outcome).toBe("inactive")
  expect(calls.some((c) => c.path.endsWith("/claim"))).toBe(false)
})

test("an already-claimed gift is inactive: 1003 target already exists", async () => {
  claim = () => new Response(JSON.stringify({ code: 1003, msg: "target already exists", data: { message: "You have already claimed this plan." } }), { headers: { "content-type": "application/json" } })
  const r = await checkin()
  expect(r.outcome).toBe("inactive")
})

test("a claim ZCode guards with its captcha is captcha, never solved here", async () => {
  claim = () => new Response(JSON.stringify({ code: 3007, msg: "captcha verify failed" }), { status: 400, headers: { "content-type": "application/json" } })
  const r = await checkin()
  expect(r.outcome).toBe("captcha")
})

test("a gift that is gone is inactive with its reason", async () => {
  claim = () => new Response(JSON.stringify({ code: 1001, msg: "target not found", data: { message: "This plan does not exist or is no longer available." } }), { headers: { "content-type": "application/json" } })
  const r = await checkin()
  expect(r.outcome).toBe("inactive")
  expect(r.message).toContain("no longer available")
})

test("an expired sign-in fails as expired and asks nothing", async () => {
  const r = await checkin({ type: "oauth", access: "", refresh: JSON.stringify({ site: "zai", jwt: jwt(now - 60), device: DEVICE }), expires: 0 })
  expect(r.outcome).toBe("failed")
  expect(r.signIn).toBe("expired")
  expect(calls.some((c) => c.path.endsWith("/claim"))).toBe(false)
})

test("a claimed gift re-reads the card's routes rather than its cache", async () => {
  _internal.routes.set(TOKEN + "\0" + TOKEN, { start: false, gift: null, at: Date.now(), ttl: 600_000 })
  expect(_internal.routes.size).toBe(1)
  await checkin()
  expect(_internal.routes.size).toBe(0)
})

// an account with no plan at all: the gift it holds is why it is added
test("an account with no plan and a gift to claim can still be added", async () => {
  const token = jwt(now + 86400)
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ path: url.pathname, method: init.method ?? "GET", query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(new Headers(init.headers ?? {})), body: init.body })
    if (url.pathname === "/api/auth/z/login") return ok({ access_token: "biz-token" })
    if (url.pathname === "/api/biz/customer/getCustomerInfo") return ok({ organizations: [{ organizationId: "org1", organizationName: "默认机构", projects: [{ projectId: "p1", projectName: "默认项目", projectType: "1" }] }] })
    if (url.pathname === "/api/biz/subscription/list") return ok([]) // no GLM Coding Plan
    if (url.pathname === "/api/v1/zcode-plan/billing/preview") return ok(PREVIEW_GIFT)
    if (url.pathname === "/api/v1/zcode-plan/billing/balance") return ok({ server_time: now, plans: [], balances: [] })
    return new Response("", { status: 404 })
  }
  try {
    const { _internal: i } = await import("./index.mjs")
    const s = await i.signedIn("zai", token, token, DEVICE)
    // the sign-in must not throw "no GLM Coding Plan" while a gift waits
    expect(s).toBeTruthy()
    expect(s.jwt).toBe(token)
    expect(s.plan).toBe("ZCode 1024 Dev Day")
  } finally {
    globalThis.fetch = realFetch
  }
})

// An account with no coding plan is the one a gift is waiting for: the card
// used to hide the claim line behind its own error, so three of four
// accounts showed nothing while ZCode held a gift for each.
test("a card with no plan still names the gift it holds, and stops being an error", async () => {
  const token = jwt(now + 86400)
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ path: url.pathname, method: init.method ?? "GET" })
    if (url.pathname === "/api/v1/zcode-plan/billing/balance") return ok({ server_time: now, plans: [], balances: [] })
    if (url.pathname === "/api/v1/zcode-plan/billing/preview") return ok(PREVIEW_GIFT)
    if (url.pathname === "/api/biz/subscription/list") return ok([])
    return new Response("", { status: 404 })
  }
  const h = await hooks()
  const u = await h.auth.usage(async () => ({ type: "oauth", access: "", refresh: JSON.stringify({ site: "zai", jwt: token, device: DEVICE }), expires: 0 }), { id: "zcode" })
  // the gift is named, and the card no longer says "no plan" over it
  expect(u.error).toBeUndefined()
  expect(u.plan).toBe("ZCode 1024 Dev Day")
  expect((u.windows ?? []).map((w) => w.name)).toContain("Gift plans to claim in the ZCode app")
})
