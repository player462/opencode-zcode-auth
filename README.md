# opencode-zcode-auth

An OpenCode / [magpie](https://usemagpie.ai) provider plugin for **ZCode**
(Z.ai and BigModel / 智谱 GLM Coding Plan), with two fixes the upstream
package (`@magpie-community/opencode-zcode-auth`) does not have yet:

1. **The 1024 Dev Day gift is found and claimed.**
2. **An account with no plan can still be added**, which is what claiming
   the gift needs in the first place.

Everything else is the upstream plugin's own behaviour.

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

`GIFT_VERSION = "3.16.3"` is now used for the preview and the claim. Every
other call keeps `APP_VERSION = "3.14.3"`, the identity the Start Plan's
requests are tuned to.

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

## Changes

All in `index.mjs`:

- `GIFT_VERSION` / `GIFT_UA` — the client version the gift list and the
  claim go as.
- `claimablePlans(s)` — the preview's list as `{planId, name}`.
- `claimCall(s, planId)` — the claim POST, envelope returned unread.
- `claimGifts(s)` — claims every gift ZCode holds; `{claimed, names}`,
  `{captcha}`, or nothing with a reason.
- `auth.checkin` — wires the above to magpie's daily check-in; a claim
  clears the route cache so the card and routing re-read at once.
- `signedIn()` — keeps a sign-in that holds a claimable gift but no plan.

## Tests

`checkin.test.mjs` covers the claim succeeding, already claimed, the
captcha path, a vanished gift, an expired sign-in, the route cache being
cleared, and adding an account with no plan.

Run with an isolated home, as the upstream suite requires:

```sh
HOME=$(mktemp -d) bun test .
```

95 tests pass across the upstream suite plus these.

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
