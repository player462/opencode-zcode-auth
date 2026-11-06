# opencode-zcode-auth

An OpenCode / [magpie](https://usemagpie.ai) provider plugin for **ZCode**
(Z.ai and BigModel / 智谱 GLM Coding Plan).

This is **upstream `@magpie-community/opencode-zcode-auth` 0.1.51 plus three
things it does not have**.

Upstream claims gifts now (0.1.35, #503), reads them from the app's own
marketing feed (0.1.41–0.1.51: the 3.17 client lists plans there alone), and
sends the version-gated headers a campaign needs (#678). What it still lacks:

1. **The captcha is answered, not just reported.** Since 11-02 a guarded
   claim is refused `400 {"code":3007,"msg":"captcha verify failed"}` for
   every bare POST — upstream stops there, `outcome: "captcha"`, "claim it
   in the ZCode app". This fork completes the claim: the scene comes from
   ZCode's own client configs (`GET /api/v1/client/configs` →
   `configs.captcha`), the **traceless check** the app's renderer runs
   (`startTracelessVerification`) answers a `captchaVerifyParam` with no
   interaction, and the claim sends it as `X-Aliyun-Captcha-Verify-Param` /
   `-Region` exactly as the client does. Measured: the check answered in
   ~3.4 s on the live scene `11xygtvd`. The window hooks
   `auth.claimScene` / `auth.submitClaimAttestation` carry it; an
   attestation that still gets a 3007 is dropped, so the next attempt asks
   for a fresh one.
2. **An account with no plan can still be added.** Upstream throws "this
   account has no GLM Coding Plan … has ended or was never started" for an
   account with no coding plan, no team seat and no live Start Plan —
   exactly the state an unclaimed gift is in, since the gift is not on the
   account until it is claimed. That deadlocks: claiming needs the account
   added, adding needs a plan. The fork signs such an account in as
   *gift-pending* (the feed's first claimable plan names it) so the
   daily check-in can claim it.
3. **A device id the app itself uses.** `X-Device-Mid` is read from ZCode's
   own `telemetry-state.json` / `onboarding-record.json` instead of being
   minted per process.

Everything else is upstream's own code, unchanged: 0.1.46's sign-in as
ZCode 3.17.2 and a Start Plan that starts later, 0.1.50's code-1004
ineligible, 0.1.51's gift-only card, and 0.1.35–0.1.43 before them —
including its card semantics (an error card stays an error; upstream's
"the card's error stays the error" test is kept as upstream wrote it).

## Gift plans it handles

Whatever ZCode is holding, by `plan_id` — nothing is matched by name.
Since 3.17 the client reads one list only:

| plan | grants | listed on |
| --- | --- | --- |
| `zcode-v3-start-plan-1030-wk` · **ZCODE WEEKEND BUILD** | GLM-5.3-Flash 500M tokens | **campaign banner** |
| `zcode-v3-start-plan-nt-1026` · ZCODE GLOBAL BUILD | GLM-5.3-Flash 300M | campaign banner |
| `zcode-v3-start-plan-1024` · ZCode 1024 Dev Day | GLM-5.3-Flash 300M + GLM-5.3 200M | campaign banner |
| `zcode-v3-start-plan-trust-*` · ZCode Trust Build | per campaign | campaign banner |
| `zcode-v3-start-plan` · Start Plan | daily | campaign banner |

A campaign gift never appears in `/billing/preview` — the 3.17 client
polls `GET /api/v1/marketing/touch` alone, whose deliveries carry a banner
with a `claim_zcode_plan` button (`action.args.plan_id`) and the plan's own
name beside it; the client posts that id to `/billing/claim`. Upstream
reads the feed now; the fork posts the captcha answer along with it. Measured
end to end: three accounts with a Weekend Build waiting on the banner,
guarded 3007, attestation submitted, claimed, banner gone.

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
ZCode offers it — without the captcha answer, a guarded claim will report
`captcha` until the app itself is opened once.

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
`provides: ["zcode"]` and its two tools. A `github:` spec carries no npm
version, so upstream's auto-update never overwrites it.

## Tests

```sh
HOME=$(mktemp -d) bun test
```

**210 tests pass**: upstream 0.1.51's own 200, plus 10 in
`claim-captcha.test.mjs` for the captcha attestation, the tools and the
gift-pending sign-in.

## License

MIT, as upstream. The upstream plugin is
[magpie-community/plugins](https://github.com/magpie-community/plugins).
