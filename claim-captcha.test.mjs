// What this fork adds on top of upstream 0.1.51: the Aliyun captcha a
// guarded claim is refused with is answered (a page's traceless check
// makes the captchaVerifyParam, the claim sends it as the app sends it),
// the tools that list and claim every account's gifts from one call, and
// the sign-in that keeps an account with no plan but a gift waiting.
import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { homedir, tmpdir } from "node:os"
import { mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// the solver is a real browser run; tests stand in for it
mock.module("./attest.mjs", () => ({
  solveCaptcha: async (scene) => {
    globalThis.__solverCalls = (globalThis.__solverCalls ?? 0) + 1
    if (globalThis.__solverScene) globalThis.__solverScene.push(scene)
    return scene?.sceneId ? { param: "auto-solved-param", region: scene.region } : { error: "no captcha scene" }
  },
}))

if (![tmpdir(), realpathSync(tmpdir())].some((t) => homedir().startsWith(t))) throw new Error("run in HOME=$(mktemp -d) bun test")
const { ZCodeAuthPlugin, _internal } = await import("./index.mjs")

const now = Math.trunc(Date.now() / 1000)
const jwt = (exp) => ["{}", JSON.stringify({ exp })].map((s) => Buffer.from(s).toString("base64url")).join(".") + ".sig"
const DEVICE = "11111111-2222-4333-8444-555555555555"
const TOKEN = jwt(now + 86400)
const ok = (data) => new Response(JSON.stringify({ code: 0, data }), { headers: { "content-type": "application/json" } })
const env = (code, msg = "", data = null, status = 200) => new Response(JSON.stringify({ code, msg, ...(data ? { data } : {}) }), { status, headers: { "content-type": "application/json" } })

// The plan ZCode advertises through a banner; the feed is the only list
// the 3.17 client reads (upstream #678), so every gift mock here is one.
const WK = "zcode-v3-start-plan-1030-wk"
const WK_NAME = "ZCODE WEEKEND BUILD"
const banner = (planId = WK, name = WK_NAME) => ({
  deliveries: [{
    campaign_id: "2101141259813175296", resource_position: "banner",
    banner: {
      buttons: [
        { action: { type: "close", args: null } },
        { action: { type: "claim_zcode_plan", args: { plan_id: planId } } },
      ],
      background: { args: { zcode_plan: { plan_id: planId, name } } },
    },
  }],
})

const real = globalThis.fetch
let calls
let claimReply
let feed
let captchaOn
beforeEach(() => {
  _internal.routes.clear()
  calls = []
  claimReply = null
  feed = banner()
  captchaOn = true
  globalThis.__solverCalls = 0
  globalThis.__solverScene = []
  delete process.env.ZCODE_ATTEST
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const headers = Object.fromEntries(new Headers(init.headers ?? {}))
    calls.push({ path: url.pathname, method: init.method ?? "GET", headers, body: init.body })
    if (url.pathname.endsWith("/marketing/touch")) return feed ? ok(feed) : new Response("", { status: 500 })
    if (url.pathname.endsWith("/billing/claim")) {
      if (claimReply) return claimReply(calls.filter((c) => c.path.endsWith("/claim")).length, headers)
      return env(0, "Plan claimed successfully.", { server_time: now, plan: { plan_id: WK, status: "active" } })
    }
    if (url.pathname.endsWith("/client/configs")) {
      if (!captchaOn) return ok({ configs: {} })
      return ok({ configs: { captcha: { enabled: true, prefix: "no8xfe", region: "cn", sceneId: "11xygtvd" } } })
    }
    if (url.pathname.endsWith("/billing/balance")) return ok({ server_time: now, plans: [], balances: [] })
    if (url.pathname === "/api/biz/subscription/list") return ok([])
    return new Response("", { status: 404 })
  }
})
afterEach(() => (globalThis.fetch = real))

const hooks = async () => ZCodeAuthPlugin({ client: {} })
const oauth = () => ({ type: "oauth", access: "", refresh: JSON.stringify({ site: "zai", jwt: TOKEN, device: DEVICE }), expires: 0 })
const claimCalls = () => calls.filter((c) => c.path.endsWith("/claim"))

test("a guarded claim answers captcha, and the submitted attestation claims it", async () => {
  // first claim: ZCode wants its captcha; the retried one, with the
  // solver's fresh param, is code 0
  claimReply = (n) => n === 1
    ? env(3007, "captcha verify failed", null, 400)
    : env(0, "Plan claimed successfully.", { server_time: now, plan: { plan_id: WK, status: "active" } })

  const h = await hooks()
  const r = await h.auth.checkin(async () => oauth(), { id: "zcode" })
  expect(r.outcome).toBe("claimed")
  expect(r.message).toContain(WK_NAME)

  // the solver ran once, on ZCode's own scene, and its param went on the retry
  expect(globalThis.__solverCalls).toBe(1)
  expect(globalThis.__solverScene[0]?.sceneId).toBe("11xygtvd")
  const claim = claimCalls().at(-1)
  expect(claim.headers["x-aliyun-captcha-verify-param"]).toBe("auto-solved-param")
  expect(claim.headers["x-aliyun-captcha-verify-region"]).toBe("cn")
  // and the claim goes as the current client does: the feed and the claim
  // are version-gated (upstream #678: an older header answers nothing)
  expect(claim.headers["x-zcode-app-version"]).toBe("3.17.2")
  // the spent param is not kept: the next claim makes a fresh one
  expect(_internal.getAttestation(_internal.stateOf(oauth()))).toBeNull()
})

test("ZCODE_ATTEST=off leaves the claim as captcha for the page to answer", async () => {
  claimReply = () => env(3007, "captcha verify failed", null, 400)
  process.env.ZCODE_ATTEST = "off"
  const h = await hooks()
  const r = await h.auth.checkin(async () => oauth(), { id: "zcode" })
  expect(r.outcome).toBe("captcha")
  expect(r.message).toContain("claim it in the ZCode app")
  expect(globalThis.__solverCalls).toBe(0)
  expect(claimCalls().length).toBe(1)
})

test("the submitted attestation claims it when the solver is off", async () => {
  claimReply = (n, headers) => headers["x-aliyun-captcha-verify-param"] === "captcha-param-from-the-page"
    ? env(0, "Plan claimed successfully.", { server_time: now, plan: { plan_id: WK, status: "active" } })
    : env(3007, "captcha verify failed", null, 400)
  process.env.ZCODE_ATTEST = "off"

  const h = await hooks()
  const att = { param: "captcha-param-from-the-page", region: "cn" }
  const r = await h.auth.submitClaimAttestation(async () => oauth(), att)
  expect(r.outcome).toBe("claimed")

  const claim = claimCalls().at(-1)
  expect(claim.headers["x-aliyun-captcha-verify-param"]).toBe(att.param)
  expect(claim.headers["x-aliyun-captcha-verify-region"]).toBe("cn")
})

test("the captcha scene comes from ZCode's own client configs", async () => {
  const h = await hooks()
  const scene = await h.auth.claimScene(async () => oauth(), { id: "zcode" })
  expect(scene).toEqual({ enabled: true, sceneId: "11xygtvd", prefix: "no8xfe", region: "cn" })
})

test("a captcha that is off has no scene", async () => {
  captchaOn = false
  const h = await hooks()
  const scene = await h.auth.claimScene(async () => oauth(), { id: "zcode" })
  expect(scene.error).toBe("ZCode's captcha is off")
})

test("an attestation with no param is refused", async () => {
  const h = await hooks()
  expect((await h.auth.submitClaimAttestation(async () => oauth(), { param: "  " })).error).toBe("no captchaVerifyParam")
})

test("a stale attestation is dropped so the next attempt gets a fresh one", async () => {
  claimReply = () => env(3007, "captcha verify failed", null, 400)
  const h = await hooks()
  const s = _internal.stateOf(oauth())
  expect(_internal.putAttestation(s, { param: "stale", region: "cn" })).toBe(true)
  expect(_internal.getAttestation(s)?.param).toBe("stale")
  const r = await h.auth.checkin(async () => oauth(), { id: "zcode" })
  expect(r.outcome).toBe("captcha")
  // the claim said captcha again, so the param is not kept for the next one
  expect(_internal.getAttestation(s)).toBeNull()
})

test("an already-claimed plan is done, and no attestation is spent on it", async () => {
  claimReply = () => env(1003, "target already exists")
  const h = await hooks()
  const r = await h.auth.checkin(async () => oauth(), { id: "zcode" })
  expect(r.outcome).toBe("done")
  expect(r.message).toContain(WK_NAME)
})

test("an empty feed is inactive, not a failure magpie retries all day", async () => {
  feed = { deliveries: [] }
  const h = await hooks()
  const r = await h.auth.checkin(async () => oauth(), { id: "zcode" })
  expect(r.outcome).toBe("inactive")
  expect(r.message).toBe("no ZCode gift plan to claim")
  expect(claimCalls().length).toBe(0)
})

// The tools reach every account magpie has, from one call, through
// magpie's own store; an isolated home holds none.
const storeTo = (accounts) => {
  const dir = join(realpathSync(tmpdir()), `capstore-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  const store = {}
  for (const [k, a] of Object.entries(accounts)) store[k] = { type: "oauth", access: "", refresh: JSON.stringify(a), expires: 0 }
  writeFileSync(join(dir, "plugin-auth.json"), JSON.stringify(store))
  return dir
}

test("the tools list and claim every account's gift", async () => {
  const home = storeTo({
    "zcode": { site: "zai", jwt: TOKEN, device: DEVICE },
    "zcode#z2": { site: "zai", jwt: jwt(now - 60), device: DEVICE },
  })
  process.env.MAGPIE_HOME = home
  try {
    const h = await hooks()
    const g = await h.tool.zcode_gifts.execute({})
    expect(g.claimable).toBe(1)
    expect(g.accounts.length).toBe(2)
    expect(g.accounts.find((a) => a.plans.length)?.plans[0].plan_id).toBe(WK)
    expect(g.accounts.find((a) => a.note)?.note).toContain("expired")

    const c = await h.tool.zcode_claim_gifts.execute({})
    expect(c.claimed).toBe(1)
    expect(claimCalls().length).toBe(1)
    expect(JSON.parse(claimCalls()[0].body)).toEqual({ plan_id: WK })
  } finally {
    delete process.env.MAGPIE_HOME
  }
})

test("with no magpie store the tools say so rather than throw", async () => {
  process.env.MAGPIE_HOME = join(realpathSync(tmpdir()), "capstore-none")
  try {
    const h = await hooks()
    const g = await h.tool.zcode_gifts.execute({})
    expect(g.claimable).toBe(0)
    expect(Array.isArray(g.accounts)).toBe(true)
    const c = await h.tool.zcode_claim_gifts.execute({})
    expect(c.claimed).toBe(0)
    expect(Array.isArray(c.accounts)).toBe(true)
  } finally {
    delete process.env.MAGPIE_HOME
  }
})

// An account with no plan at all is the one a gift is waiting for: the
// sign-in used to throw "no GLM Coding Plan", so it could not be added
// and its gift could never be claimed. A claimable banner keeps it as a
// gift-pending sign-in instead.
test("an account with no plan and a gift to claim can still be added", async () => {
  const token = jwt(now + 86400)
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ path: url.pathname, method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers ?? {})), body: init.body })
    if (url.pathname === "/api/auth/z/login") return ok({ access_token: "biz-token" })
    if (url.pathname === "/api/biz/customer/getCustomerInfo") return ok({ organizations: [{ organizationId: "org1", organizationName: "默认机构", projects: [{ projectId: "p1", projectName: "默认项目", projectType: "1" }] }] })
    if (url.pathname === "/api/biz/subscription/list") return ok([]) // no GLM Coding Plan
    if (url.pathname.endsWith("/marketing/touch")) return ok(banner("zcode-v3-start-plan-1024", "ZCode 1024 Dev Day"))
    if (url.pathname.endsWith("/billing/balance")) return ok({ server_time: now, plans: [], balances: [] })
    return new Response("", { status: 404 })
  }
  try {
    const s = await _internal.signedIn("zai", token, token, DEVICE)
    // the sign-in must not throw "no GLM Coding Plan" while a gift waits
    expect(s).toBeTruthy()
    expect(s.jwt).toBe(token)
    expect(s.plan).toBe("ZCode 1024 Dev Day")
    expect(s.giftPending).toBe(1)
  } finally {
    globalThis.fetch = realFetch
  }
})
