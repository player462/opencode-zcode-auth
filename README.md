# opencode-zcode-auth

An OpenCode / [magpie](https://usemagpie.ai) provider plugin for **ZCode**
(Z.ai and BigModel / 智谱 GLM Coding Plan).

This is **upstream `@magpie-community/opencode-zcode-auth` 0.1.26 plus two
fixes it does not have**:

1. **The 1024 Dev Day gift is claimed, not just listed.** Upstream finds
   the gift on the card but never claims it — it still says only the ZCode
   app can, because the claim "takes the Aliyun captcha attestation the
   app's renderer makes". That is not what the endpoint does: a claim with
   no attestation header at all is answered on the gift's own terms, and
   only a risk-control path asks for the captcha (`3007`). This fork claims
   the gift through magpie's daily check-in, and reports a guarded claim
   as `captcha` instead of solving it.
2. **An account with no plan can still be added.** Upstream throws "this
   account has no GLM Coding Plan … has ended or was never started" for an
   account with no coding plan, no team seat and no live Start Plan bucket
   — which is exactly the state an unclaimed gift is in, since the gift is
   not on the account until it is claimed. That deadlocks: claiming needs
   the account added, adding needs a plan.

Everything else — 0.1.21's system-prompt placement, 0.1.22's Start Plan
headers, 0.1.23's per-plan bucket names, 0.1.24's `ToolSearchTool`,
0.1.25's `NO_PLAN_KEY` and 0.1.26's gift retry plus `-Trial` fallback — is
upstream's own code, unchanged.

## What upstream fixed on its own

Upstream **0.1.24 does find the gift**: it bumped `APP_VERSION` from
`3.14.3` to `3.16.3`, and ZCode gates the gift list on the client version
(3.16.0 answers an empty list, 3.16.1 is the first that names
`zcode-v3-start-plan-1024`). So the card names the gift.

Upstream **0.1.25 and 0.1.26 still do not claim it, and still cannot add an
account that has no plan.** 0.1.25's `NO_PLAN_KEY` improves the *message* a
key with no coding plan gets — it now explains that a gift plan needs
ZCode's sign-in rather than a key — but `signedIn()` still throws for an
account with no plan, and `auth` still has no `checkin` hook. Measured
against the same "no plan, unclaimed 1024 gift" account:

| | add the account | claim the gift |
| --- | --- | --- |
| upstream 0.1.26 | fails (`Z.ai API keys: Not Found`) | no `checkin` hook |
| this fork | succeeds | `claimed ZCode 1024 Dev Day` |

## Install

The package name is `opencode-zcode-auth`, so it does not collide with the
upstream `@magpie-community/opencode-zcode-auth`. Both provide the `zcode`
provider, so **remove the upstream one first** or magpie has two plugins
for one provider id.

```sh
magpie plugin rm @magpie-community/opencode-zcode-auth
magpie plugin add github:player462/opencode-zcode-auth
```

Then turn the account's check-in on: **Settings → Usage → Plugins**. The
claim runs from there.

### If `magpie plugin add github:...` doesn't stick

Measured on magpie (Windows, 2026-10-23): `magpie plugin add` resolves the
GitHub package into `plugins/node_modules/`, but the plugin host looks the
package up by the name in `plugins.json`, so a `github:` spec there fails
with `no such plugin: ...\node_modules\github:player462\...`.

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
`provides: ["zcode"]`.

## What was wrong

### ZCode gates the gift list on the client version

The plugin read the gift list with

```
GET /api/v1/zcode-plan/billing/preview?app_version=3.14.3
```

and `app_version` was pinned at **3.14.3**. ZCode answers that list by
client version:

| `app_version` | `plans` |
| --- | --- |
| 3.14.3 … 3.16.0 | `[]` |
| **3.16.1** and newer | `[zcode-v3-start-plan-1024]` |

So the plugin was always told "nothing to claim" and the 1024 gift never
reached the card. The gift itself is **GLM-5.3-Flash 300M + GLM-5.3 200M
tokens**.

`GIFT_VERSION = "3.16.3"` is used for the preview and the claim, pinned on
its own so a future `APP_VERSION` change cannot take the gift list back
under the gate. Everything else uses `APP_VERSION`.

### The claim does not need the captcha

The upstream comment says only the ZCode app can claim, because the claim
takes an Aliyun captcha attestation the app's renderer makes. That is not
what the endpoint does — measured on a real account with no attestation
header at all:

```
POST /api/v1/zcode-plan/billing/claim   {"plan_id":"zcode-v3-start-plan-1024"}
→ 200 {"code":1003,"msg":"target already exists"}
```

`1003` is "already claimed", not `3007 captcha verify failed`. The
attestation is a risk-control path, not a precondition. So the plugin
claims the gift itself through magpie's daily check-in hook.

The claim is answered by its own codes:

| code | meaning | reported as |
| --- | --- | --- |
| `0` + a plan | claimed | `claimed` |
| `1003` | already claimed | `inactive` |
| `3007` | ZCode wants its captcha | `captcha` — never solved here |
| `1001` | the plan is gone | `inactive`, with the reason |

### An account with no plan could not be added

`signedIn()` threw "this account has no GLM Coding Plan … has ended or was
never started" whenever the account had no coding plan, no team seat and no
live Start Plan bucket. An unclaimed gift is exactly that state — it is not
on the account until it is claimed — so the account that most needed to
claim the gift could not be added to claim it.

A valid ZCode token with a claimable gift now signs in, and the gift's name
is the plan shown.

## Changes over upstream 0.1.26

All in `index.mjs`:

- `GIFT_VERSION` / `GIFT_UA` — the client version the gift list and the
  claim go as, pinned independently of `APP_VERSION`.
- `claimablePlans(s)` — the preview's list as `{planId, name}`.
- `claimCall(s, planId)` — the claim POST, envelope returned unread.
- `claimGifts(s)` — claims every gift ZCode holds; `{claimed, names}`,
  `{captcha}`, or nothing with a reason.
- `auth.checkin` — wires the above to magpie's daily check-in; a claim
  clears the route cache so the card and routing re-read at once.
- `signedIn()` — keeps a sign-in that holds a claimable gift but no plan.
- `claimHint()` — comment corrected: it no longer says only the app can
  claim.
- Upstream 0.1.25/0.1.26 additions (`NO_PLAN_KEY`, `giftSignIn`, the gift
  retry and the `-Trial` fallback) are kept as they are.

## Tests

`checkin.test.mjs` covers the claim succeeding, already claimed, the
captcha path, a vanished gift, an expired sign-in, the route cache being
cleared, and adding an account with no plan.

Run with an isolated home, as the upstream suite requires:

```sh
HOME=$(mktemp -d) bun test packages/zcode
```

**110 tests pass**: upstream 0.1.26's own 102 plus these 8. `bun scripts/check.mjs zcode` passes.

## Notes

- The gift's entitlements carry `effective_at`; until that time the
  balance shows the plan with no buckets and the Start Plan endpoint
  answers `1005 exceed quota limit`. That is expected, not a failure.
- A `github:` dependency in `plugins/package.json` carries no npm version,
  so magpie's plugin updater has no newer version to move it to — the
  fork stays installed instead of being replaced by upstream's `@latest`.
  That is the point of installing it this way.
- `prompt.mjs` is unchanged from upstream.

## License

MIT, as upstream. The upstream plugin is
[magpie-community/plugins](https://github.com/magpie-community/plugins).
