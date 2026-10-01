import type { AppContext, PlatformState } from "../context.ts";
import { lanAddresses } from "../net/addresses.ts";
import { firewallStatus, networkProfiles, networkWarningFor } from "../platform/network.ts";
import type { SleepGuard } from "../platform/sleep.ts";
import { tailscaleStatus } from "../platform/tailscale.ts";
import { getOrgSettings } from "./org.ts";

/**
 * Keeps ctx.runtime in step with the machine: addresses after a DHCP change,
 * Windows network category, firewall rules, Tailscale, and the sleep setting.
 */
export function startPlatformMonitor(ctx: AppContext, sleepGuard: SleepGuard) {
  let busy = false;
  const refresh = async () => {
    if (busy) return;
    busy = true;
    try {
      const settings = getOrgSettings(ctx.db);
      sleepGuard.set(ctx.config.sleepGuard && settings.sleepGuard);
      const addresses = lanAddresses();
      if (addresses.join() !== ctx.runtime.addresses.join()) {
        ctx.log.info("Network addresses changed", { from: ctx.runtime.addresses, to: addresses });
        ctx.runtime.addresses = addresses;
      }
      const [networks, firewall, tailscale] = await Promise.all([
        networkProfiles(),
        firewallStatus(),
        tailscaleStatus(),
      ]);
      const state: PlatformState = {
        checkedAt: ctx.now(),
        // Live view: reflects the helper exiting between checks.
        sleepGuard,
        networks,
        firewall,
        tailscale,
      };
      ctx.runtime.platform = state;
      ctx.runtime.networkWarning = networkWarningFor(networks);
    } catch (e) {
      ctx.log.warn("Platform check failed", e);
    } finally {
      busy = false;
    }
  };
  void refresh();
  const t = setInterval(refresh, 5 * 60_000);
  return {
    refresh,
    stop() {
      clearInterval(t);
      sleepGuard.stop();
    },
  };
}
