// The ZCode gift page: what ZCode is holding for each signed-in account,
// and how to claim it.
//
// magpie's page sandbox has no network of its own and its window answers
// only the reads a package declares (magpie.permissions) — not a tool call.
// So the claim itself is not run from here: it is the plugin's tools
// (zcode_gifts, zcode_claim_gifts) and the daily check-in, which magpie
// runs for the account. This page shows the state and says where to act,
// which is what a page can honestly do.
//
// The captcha the claim may be guarded with is the scene ZCode's own app
// uses; it is solved by the traceless check, which needs no interaction
// when the risk engine is satisfied.

const $ = (id) => document.getElementById(id);
const $dot = $("dot"), $statusText = $("statusText");
const $plans = $("plans"), $refresh = $("refresh");
const $log = $("log"), $sub = $("sub"), $how = $("how");

const errText = (e) => (!e ? "未知错误" : typeof e === "string" ? e : e.message || e.error || JSON.stringify(e));

function say(text, tone = "") {
  $statusText.textContent = text;
  $dot.className = "dot" + (tone ? " " + tone : "");
}
function detail(text) {
  if (!text) { $log.hidden = true; $log.textContent = ""; return; }
  $log.hidden = false;
  $log.textContent = text;
}

// The declared reads are the only door out of the sandbox. A build of
// magpie that exposes the plugin's tools to a page answers
// magpie.tool/call; one that doesn't says so plainly rather than failing
// silently.
async function tool(name, args) {
  if (typeof magpie.tool === "function") return magpie.tool(name, args ?? {});
  if (typeof magpie.call === "function") return magpie.call("tool", { name, args: args ?? {} });
  return null;
}

function render(groups) {
  $plans.replaceChildren();
  for (const g of groups) {
    const li = document.createElement("li");
    const n = document.createElement("div");
    n.className = "n";
    n.textContent = g.account;
    li.append(n);
    if (g.plans?.length) {
      for (const p of g.plans) {
        const m = document.createElement("div");
        m.className = "m";
        m.textContent = "· 待领取：" + (p.name || p.planId);
        li.append(m);
      }
    } else {
      const m = document.createElement("div");
      m.className = "m";
      m.textContent = g.note || "无待领取";
      li.append(m);
    }
    $plans.append(li);
  }
}

async function refresh() {
  say("正在检测…");
  detail("");
  try {
    const r = await tool("zcode_gifts");
    if (!r) {
      say("这个 magpie 版本的页面读不到插件工具", "warn");
      $how.hidden = false;
      return;
    }
    const groups = Array.isArray(r?.accounts) ? r.accounts : [];
    render(groups);
    const n = r?.claimable ?? 0;
    say(n ? `发现 ${n} 个待领取礼包` : "没有待领取的礼包", n ? "ok" : "");
    $how.hidden = n === 0;
  } catch (e) {
    say("检测失败：" + errText(e), "err");
    detail(errText(e));
  }
}

$refresh.addEventListener("click", refresh);

(async () => {
  try {
    const th = await magpie.ready;
    if (th?.lang) $sub.textContent = "所有 ZCode 账号的礼包状态";
  } catch { /* standalone preview */ }
  await refresh();
})();
