// The two things this fork adds to upstream 0.1.38: the Aliyun captcha a
// guarded claim is refused with is solved (a page's traceless check makes
// the captchaVerifyParam, the claim sends it), and the tools that list and
// claim every account's gifts.
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

const GIFT = { plan_id: "zcode-v3-start-plan-1030-wk", name: "ZCODE WEEKEND BUILD", priority: 101, entitlements: [] }
const PREVIEW = { server_time: now, plans: [GIFT] }

const real = globalThis.fetch
let calls
let claimReply
beforeEach(() => {
  _internal.routes.clear()
  calls = []
  claimReply = null
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const headers = Object.fromEntries(new Headers(init.headers ?? {}))
    calls.push({ path: url.pathname, method: init.method ?? "GET", headers, body: init.body })
    if (url.pathname.endsWith("/preview")) return ok(PREVIEW)
    if (url.pathname.endsWith("/claim")) {
      if (claimReply) return claimReply(calls.filter((c) => c.path.endsWith("/claim")).length)
      return new Response(JSON.stringify({ code: 0, msg: "", data: { server_time: now, plan: { plan_id: GIFT.plan_id, status: "active" } } }), { headers: { "content-type": "application/json" } })
    }
    if (url.pathname.endsWith("/client/configs")) return ok({ configs: { captcha: { enabled: true, prefix: "no8xfe", region: "cn", sceneId: "11xygtvd" } } })
    if (url.pathname.endsWith("/balance")) return ok({ server_time: now, plans: [], balances: [] })
    if (url.pathname === "/api/biz/subscription/list") return ok([])
    return new Response("", { status: 404 })
  }
})
afterEach(() => (globalThis.fetch = real))

const hooks = async () => ZCodeAuthPlugin({ client: {} })
const oauth = () => ({ type: "oauth", access: "", refresh: JSON.stringify({ site: "zai", jwt: TOKEN, device: DEVICE }), expires: 0 })

test("a guarded claim is refused with 3007 and then claimed with the attestation", async () => {
  // first claim: ZCode's captcha; second: the attestation is accepted
  claimReply = (n) => n === 1
    ? new Response(JSON.stringify({ code: 3007, msg: "captcha verify failed" }), { status: 400, headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ code: 0, msg: "", data: { server_time: now, plan: { plan_id: GIFT.plan_id, status: "active" } } }), { headers: { "content-type": "application/json" } })

  const h = await hooks()
  const first = await h.auth.checkin(async () => oauth(), { id: "zcode" })
  expect(first.outcome).toBe("captcha")

  const att = { param: "captcha-param-from-the-page", region: "cn" }
  const r = await h.auth.submitClaimAttestation(async () => oauth(), att)
  expect(r.outcome).toBe("claimed")

  const claim = calls.filter((c) => c.path.endsWith("/claim")).at(-1)
  expect(claim.headers["x-aliyun-captcha-verify-param"]).toBe(att.param)
  expect(claim.headers["x-aliyun-captcha-verify-region"]).toBe("cn")
})

test("the captcha scene comes from ZCode's own client configs", async () => {
  const h = await hooks()
  const scene = await h.auth.claimScene(async () => oauth())
  expect(scene).toEqual({ enabled: true, sceneId: "11xygtvd", prefix: "no8xfe", region: "cn" })
})

test("an attestation with no param is refused", async () => {
  const h = await hooks()
  expect((await h.auth.submitClaimAttestation(async () => oauth(), { param: "  " })).error).toBe("no captchaVerifyParam")
})

test("a stale attestation is dropped so the next attempt gets a fresh one", async () => {
  claimReply = () => new Response(JSON.stringify({ code: 3007, msg: "captcha verify failed" }), { status: 400, headers: { "content-type": "application/json" } })
  const h = await hooks()
  const s = _internal.stateOf(oauth())
  expect(_internal.putAttestation(s, { param: "stale", region: "cn" })).toBe(true)
  expect(_internal.getAttestation(s)?.param).toBe("stale")
  await h.auth.checkin(async () => oauth(), { id: "zcode" })
  // the claim said captcha again, so the param is not reused
  expect(_internal.getAttestation(s)).toBeNull()
})

test("the tools list and claim every account's gift", async () => {
  const h = await hooks()
  // no magpie store in the isolated home: the tools say so rather than throw
  const g = await h.tool.zcode_gifts.execute({})
  expect(g.claimable).toBe(0)
  expect(Array.isArray(g.accounts)).toBe(true)
  const c = await h.tool.zcode_claim_gifts.execute({})
  expect(c.claimed).toBe(0)
  expect(Array.isArray(c.accounts)).toBe(true)
})

// The Weekend Build never appears in /billing/preview: ZCode advertises it
// through a marketing banner whose claim button carries the plan_id, and
// the same /billing/claim puts it on the account. A preview with nothing
// in it beside a campaign waiting is a claimable gift, and the card names
// it.
test("a campaign banner's claim_zcode_plan is a gift the check-in claims", async () => {
  claimReply = () => new Response(JSON.stringify({ code: 0, msg: "", data: { server_time: now, plan: { plan_id: "zcode-v3-start-plan-1030-wk", name: "ZCODE WEEKEND BUILD", status: "active" } } }), { headers: { "content-type": "application/json" } })
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const headers = Object.fromEntries(new Headers(init.headers ?? {}))
    calls.push({ path: url.pathname, method: init.method ?? "GET", headers, body: init.body })
    if (url.pathname.endsWith("/preview")) return ok({ server_time: now, plans: [] })
    if (url.pathname === "/api/v1/marketing/touch") {
      return ok({
        deliveries: [{
          campaign_id: "2101141259813175296", resource_position: "banner",
          banner: {
            buttons: [
              { action: { type: "close", args: null } },
              { action: { type: "claim_zcode_plan", args: { plan_id: "zcode-v3-start-plan-1030-wk" } } },
            ],
            background: { args: { zcode_plan: { plan_id: "zcode-v3-start-plan-1030-wk", name: "ZCODE WEEKEND BUILD" } } },
          },
        }],
      })
    }
    if (url.pathname.endsWith("/claim")) return claimReply(calls.filter((c) => c.path.endsWith("/claim")).length)
    if (url.pathname.endsWith("/balance")) return ok({ server_time: now, plans: [], balances: [] })
    if (url.pathname === "/api/biz/subscription/list") return ok([])
    return new Response("", { status: 404 })
  }

  const h = await hooks()
  const r = await h.auth.checkin(async () => oauth(), { id: "zcode" })
  expect(r.outcome).toBe("claimed")
  expect(r.message).toContain("ZCODE WEEKEND BUILD")
  const c = calls.find((x) => x.path.endsWith("/claim"))
  expect(JSON.parse(c.body)).toEqual({ plan_id: "zcode-v3-start-plan-1030-wk" })

  // the card names it while it waits, and a claimed one leaves no line
  const u = await h.auth.usage(async () => oauth(), { id: "zcode" })
  expect(u.windows?.some((w) => w.name === "Gift plans to claim in the ZCode app")).toBe(true)
})

test("a campaign read that fails is no gift, and never a failed claim", async () => {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname.endsWith("/preview")) return ok({ server_time: now, plans: [] })
    return new Response("", { status: 404 }) // marketing/touch unreachable
  }
  const h = await hooks()
  const r = await h.auth.checkin(async () => oauth(), { id: "zcode" })
  expect(r).toEqual({ outcome: "inactive", message: "no ZCode gift plan to claim" })
})
