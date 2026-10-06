# Remote access

Stint works on the office network with no extra setup. This guide is for firms that want people
to sync from home or from site as well. It's optional and off by default. Even without it,
people can track time offline and sync when they're back in the office.

## Which option?

| | **Tailscale** (recommended) | **Cloudflare Tunnel** |
| --- | --- | --- |
| What it is | A private network between your own devices, over the internet | A public web address that Cloudflare forwards to your server |
| Free plan | *Personal*: up to 6 users, unlimited devices | *Zero Trust Free*: up to 50 users. A payment card is required on the account |
| You also need | The Tailscale app on the server PC and each laptop | A domain name on Cloudflare (a few hundred rand a year), plus Cloudflare Access rules |
| Exposed to the internet | **No.** Only signed-in devices can connect | Yes: a public hostname, which you must protect with Cloudflare Access |
| Certificate | Stint's own (already trusted on computers where you installed it) | Cloudflare's, trusted everywhere |
| Setup time | About 10 minutes | About an hour |

**We recommend Tailscale.** It needs no domain and no router changes. Nothing is reachable
from the public internet.

> **Check current pricing.** These plan details were collected in September 2026 from
> third-party summaries, because the vendors' own sites couldn't be reached while this guide
> was written. Plans change often. Confirm them on
> [tailscale.com/pricing](https://tailscale.com/pricing) and
> [cloudflare.com/plans/zero-trust-services](https://www.cloudflare.com/plans/zero-trust-services/)
> before you rely on them.

## Tailscale, step by step

### On the server PC

1. Download Tailscale from [tailscale.com/download](https://tailscale.com/download) and install
   it.
2. Sign in. Use an account that belongs to the firm (a Microsoft or Google work account
   works), not someone's personal one. This account owns your private network (the
   *tailnet*).
3. In the Tailscale admin console ([login.tailscale.com/admin](https://login.tailscale.com/admin)),
   find the server PC under **Machines**, open its menu and choose **Disable key expiry**.
   Otherwise the server drops off the tailnet every few months until someone signs in again.
4. Optional but recommended: under **DNS**, turn on **MagicDNS**, so the server gets a stable
   name like `office-pc.tail1234.ts.net`.
5. In Stint, open **Settings → Remote access**, turn on **Allow Stint to be reached over
   Tailscale**, then restart the *Stint Server* service (or the PC). The page then shows the
   remote address, for example `https://office-pc.tail1234.ts.net:47600`.

### On each laptop

1. Install Tailscale and sign in to the **same** tailnet. Either invite the person from the
   admin console (**Users → Invite**), or sign in with the firm's account.
2. In the browser, open the remote address shown in Settings → Remote access (for example
   `https://office-pc.tail1234.ts.net:47600`) and install it as an app from the browser menu.
   Use that address both in the office and away: offline copies belong to one address, so
   switching between addresses means signing in on each.

### Limiting access (recommended)

By default every device on a tailnet can reach every other one. To let laptops reach only
Stint, set an access control policy in the Tailscale admin console (**Access controls**). For
example:

```jsonc
{
  "tagOwners": { "tag:stint-server": ["autogroup:admin"] },
  "acls": [
    // Everyone in the firm may reach Stint (HTTPS) on the server, and nothing else.
    { "action": "accept", "src": ["autogroup:member"], "dst": ["tag:stint-server:47600"] }
  ]
}
```

Then tag the server PC with `tag:stint-server` (Machines → … → *Edit ACL tags*).

### More than 6 people working remotely

Tailscale's paid plans lift the 6-user limit. Only people who need remote access have to be on
the tailnet; everyone in the office keeps using the office network.

## Cloudflare Tunnel (alternative)

Use this only if you already run your domain on Cloudflare and want browser access for more
people than Tailscale's free plan covers.

1. Add your domain to Cloudflare, and enable Zero Trust (a payment card is required, even on the
   free plan).
2. **Zero Trust → Networks → Tunnels → Create a tunnel** (type *Cloudflared*). Install the
   connector on the server PC with the command Cloudflare shows. It runs as a Windows service.
3. Add a **public hostname**, for example `stint.yourfirm.co.za`, with the service
   `https://localhost:47600`. Under *Additional application settings → TLS*, turn on **No TLS
   Verify**, because Stint's own certificate isn't one Cloudflare knows.
4. **Zero Trust → Access → Applications → Add an application** for that hostname, with a
   policy that allows only your staff's email addresses (or your firm's identity provider).
   Don't skip this: without it, the Stint sign-in page is on the open internet.
5. People open `https://stint.yourfirm.co.za` in a browser and install it as an app from the
   browser menu.

## What Stint does when remote access is on

- With Tailscale running, the server's certificate also covers its Tailscale name (after a
  restart), and the Health page shows whether Tailscale is connected.
- Stint never changes Tailscale or Cloudflare settings itself. It only reads Tailscale's
  status.
- Sign-in limits, roles and locking work exactly as they do in the office.
