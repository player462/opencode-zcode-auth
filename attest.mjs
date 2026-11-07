// attest solves the Aliyun captcha a guarded claim is refused with (3007),
// the way ZCode's own renderer does: the scene from /api/v1/client/configs
// runs its traceless check in a real browser (ego-browser, which magpie's
// machine already has), and startTracelessVerification answers a
// captchaVerifyParam with no interaction. Measured ~3.4 s on scene
// 11xygtvd; the param is what /billing/claim wants as
// X-Aliyun-Captcha-Verify-Param, and it is single-use: one per claim.
//
// The solver runs `ego-browser nodejs <script>` in a temp dir; the script
// loads the SDK on zcode.z.ai, starts the scene, and prints the param on
// one CAPTCHA_PARAM line. No account data enters the browser: the check is
// anonymous, bound to the scene and the browser session alone.

import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ATTEST_TIMEOUT_MS = 45_000

function attestScript(scene) {
  return `// generated: ZCode claim captcha, traceless check
const task = await taskSpace("ZCode claim captcha");
const page = await task.page("p1");
await page.goto("https://zcode.z.ai/cn", { waitUntil: "domcontentloaded" }).catch(() => {});
const out = await page.evaluate(async () => {
  const SDK = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
  const load = () => new Promise((res, rej) => {
    if (typeof window.initAliyunCaptcha === "function") return res();
    const s = document.createElement("script");
    s.src = SDK; s.onload = () => res(); s.onerror = () => rej(new Error("sdk load failed"));
    document.head.appendChild(s);
  });
  try { await load(); } catch (e) { return { error: String(e) }; }
  window.AliyunCaptchaConfig = { region: ${JSON.stringify(scene.region)}, prefix: ${JSON.stringify(scene.prefix)} };
  const holder = document.createElement("div"); holder.id = "cap-holder";
  const btn = document.createElement("button"); btn.id = "cap-btn"; btn.hidden = true;
  document.body.append(holder, btn);
  return await new Promise((resolve) => {
    const out = {};
    const timer = setTimeout(() => { out.timeout = true; resolve(out); }, 20000);
    try {
      window.initAliyunCaptcha({
        SceneId: ${JSON.stringify(scene.sceneId)}, mode: "popup", language: "zh-CN", showErrorTip: false,
        element: "#cap-holder", button: "#cap-btn",
        getInstance: (inst) => { if (typeof inst.startTracelessVerification === "function") inst.startTracelessVerification(); },
        success: (p) => { clearTimeout(timer); out.param = typeof p === "string" ? p : (p && p.captchaVerifyParam); resolve(out); },
        fail: (p) => { clearTimeout(timer); out.fail = JSON.stringify(p).slice(0, 200); resolve(out); },
        onError: (p) => { clearTimeout(timer); out.err = JSON.stringify(p).slice(0, 200); resolve(out); },
      });
    } catch (e) { clearTimeout(timer); out.error = String(e); resolve(out); }
  });
});
console.log("CAPTCHA_PARAM " + (out && out.param ? out.param : ""));
console.log("CAPTCHA_DETAIL " + JSON.stringify(out ?? {}).slice(0, 300));
`
}

// solve runs the traceless check and answers {param, region} or {error}.
// env ZCODE_ATTEST=off turns it off for machines with no browser.
export async function solveCaptcha(scene) {
  if (!scene?.sceneId) return { error: "no captcha scene" }
  if (process.env.ZCODE_ATTEST === "off") return { error: "captcha solving is off (ZCODE_ATTEST=off)" }
  let dir
  try {
    dir = mkdtempSync(join(tmpdir(), "zcode-attest-"))
  } catch (e) {
    return { error: `temp dir: ${e?.message ?? e}` }
  }
  try {
    const script = join(dir, "attest.mjs")
    writeFileSync(script, attestScript(scene))
    const out = await new Promise((resolve) => {
      let so = "", se = ""
      let child
      try {
        child = spawn("ego-browser", ["nodejs", "-e", `await import('file:///${script.replace(/\\/g, "/")}')`], { stdio: ["ignore", "pipe", "pipe"] })
      } catch (e) {
        return resolve({ error: `spawn: ${e?.message ?? e}` })
      }
      const timer = setTimeout(() => { try { child.kill() } catch {} resolve({ error: "timed out" }) }, ATTEST_TIMEOUT_MS)
      child.stdout.on("data", (d) => (so += d))
      child.stderr.on("data", (d) => (se += d))
      child.on("error", (e) => { clearTimeout(timer); resolve({ error: `ego-browser: ${e?.message ?? e}` }) })
      child.on("close", (code) => {
        clearTimeout(timer)
        // ego's runner relays the script's console output on either stream
        const both = so + "\n" + se
        const line = both.split(/\r?\n/).find((l) => l.trim().startsWith("CAPTCHA_PARAM "))
        const param = line ? line.trim().slice("CAPTCHA_PARAM ".length).trim() : ""
        if (param) return resolve({ param })
        const why = both.trim().split(/\r?\n/).filter((l) => l.includes("CAPTCHA_DETAIL")).at(-1) ?? both.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? `exit ${code}`
        resolve({ error: `no answer (${String(why).slice(0, 140)})` })
      })
    })
    return out.param ? { param: out.param, region: scene.region } : out
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}
