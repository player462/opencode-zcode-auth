# opencode-zcode-auth

An OpenCode / [magpie](https://usemagpie.ai) provider plugin for **ZCode**
(Z.ai and BigModel / 智谱 GLM Coding Plan).

This is **upstream `@magpie-community/opencode-zcode-auth` 0.1.38 plus three
things it does not have**.

Upstream **does claim gifts now** (0.1.35, #503) and does it well. What it
still lacks:

1. **The captcha is solved, not just reported.** A claim ZCode guards is
   answered `400 {"code":3007,"msg":"captcha verify failed"}`, and upstream
   stops there — `outcome: "captcha"`, "claim it in the ZCode app". This
   fork solves it: the scene comes from ZCode's own client configs
   (`GET /api/v1/client/configs` → `configs.captcha`), the **traceless
   check** (`startTracelessVerification`) answers a `captchaVerifyParam`
   with no interaction, and the claim sends it as
   `X-Aliyun-Captcha-Verify-Param` / `-Region`. Measured: the check answered
   in ~3.4 s on the live scene `11xygtvd`. A scene that does want a human
   shows its popup instead.
2. **An account with no plan can still be added.** Upstream throws "this
   account has no GLM Coding Plan … has ended or was never started" for an
   account with no coding plan, no team seat and no live Start Plan bucket
   — which is exactly the state an unclaimed gift is in, since the gift is
   not on the account until it is claimed. That deadlocks: claiming needs
   the account added, adding needs a plan.
3. **A card with no plan names the gift it holds.** The claim line sits
   behind `if (!card.error)` upstream, so an account with no plan — the one
   a gift is waiting for — shows only "no plan" and never the gift.
   Measured on four accounts, three held a `ZCODE GLOBAL BUILD` and none of
   them showed it. The line is added over that error now, and the card
   stops being an error once the gift is named.

Everything else is upstream's own code, unchanged: 0.1.33's 3.16 model
list, 0.1.34's gift naming and start time, 0.1.35's daily claim, 0.1.36's
bucket naming, 0.1.37's "no gift is not a failed check-in", 0.1.38's
`freeFirst`, and 0.1.21–0.1.24 before them.

## Gift plans it handles

Whatever ZCode is holding, by `plan_id` — nothing is matched by name:

| plan | grants |
| --- | --- |
| `zcode-v3-start-plan-1030-wk` · **ZCODE WEEKEND BUILD** | GLM-5.3-Flash 500M tokens |
| `zcode-v3-start-plan-nt-1026` · ZCODE GLOBAL BUILD | GLM-5.3-Flash 300M |
| `zcode-v3-start-plan-1024` · ZCode 1024 Dev Day | GLM-5.3-Flash 300M + GLM-5.3 200M |
| `zcode-v3-start-plan-trust-*` · ZCode Trust Build | per campaign |
| `zcode-v3-start-plan` · Start Plan | daily |

An entitlement's `effective_at` can be later than the plan's `starts_at`
(the Weekend Build starts 22:25 and its tokens at 23:00 Beijing): until
then the card names the plan with no buckets and the Start Plan endpoint
answers `1005 exceed quota limit`. That is ZCode's own timing, not a
failure.

## Tools and page

Two tools for any agent (magpie's MCP server):

| tool | does |
| --- | --- |
| `zcode_gifts` | lists what ZCode holds for every signed-in account |
| `zcode_claim_gifts` | claims it, across every account (or one, by `account`) |

```text
use zcode_claim_gifts to claim my ZCode gifts
```

The page (**ZCode gifts**) shows the same state. magpie's page sandbox has
no network and its window answers only declared reads, not tool calls, so
the page reports and points at the two ways to claim rather than claiming
itself.

The claim also runs from magpie's daily check-in (**Settings → Usage →
Plugins**): turn the account's check-in on and a gift is claimed as soon as
ZCode offers it.

`X-Device-Mid` is read from ZCode's own `telemetry-state.json` /
`onboarding-record.json` instead of being minted per process, so the calls
carry the machine id the app itself uses.

## Install

The package name is `opencode-zcode-auth`, so it does not collide with the
upstream `@magpie-community/opencode-zcode-auth`. Both provide the `zcode`
provider, so **remove the upstream one first** or magpie has two plugins
for one provider id.

```sh
magpie plugin rm @magpie-community/opencode-zcode-auth
magpie plugin add github:player462/opencode-zcode-auth
```

### If `magpie plugin add github:...` doesn't stick

Measured on magpie (Windows): `magpie plugin add` resolves the GitHub
package into `plugins/node_modules/`, but the plugin host looks the package
up by the name in `plugins.json`, so a `github:` spec there fails with
`no such plugin: ...\node_modules\github:player462\...`.

Install it by name instead, which is what worked:

```sh
cd ~/.config/magpie/plugins
bun add opencode-zcode-auth@github:player462/opencode-zcode-auth
```

Then set the spec magpie loads to the installed name:

```jsonc
// ~/.config/magpie/plugins.json
{ "plugins": [ { "spec": "opencode-zcode-auth@latest" }, /* … */ ] }
```

`magpie plugin list --json` then shows `opencode-zcode-auth@latest` with
`provides: ["zcode"]` and its two tools.

## Tests

```sh
HOME=$(mktemp -d) bun test packages/zcode
```

**178 tests pass**: upstream 0.1.38's own 173 (with its "the card's error
stays the error" test rewritten to the behaviour this fork has), plus 5 for
the captcha attestation and the tools. `bun scripts/check.mjs zcode`
passes.

## License

MIT, as upstream. The upstream plugin is
[magpie-community/plugins](https://github.com/magpie-community/plugins).
