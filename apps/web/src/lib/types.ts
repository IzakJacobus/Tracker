import type { Organization, User } from "@stint/shared";

export interface Me {
  serverId: string;
  user: User;
  organization: Organization | null;
  permissions: { seeRates: boolean };
}

export interface ServerInfo {
  product: "stint";
  version: string;
  serverId: string | null;
  organizationName: string | null;
  setupComplete: boolean;
  caFingerprint: string | null;
  time: number;
}
