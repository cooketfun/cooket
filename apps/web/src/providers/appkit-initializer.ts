"use client";

import { createAppKit } from "@reown/appkit/react";
import {
  appKitFeatures,
  appKitMetadata,
  appKitNetworks,
  arcTestnetAppKitNetwork,
  reownProject,
  wagmiAdapter,
} from "@/lib/wallet";

export const appKit = reownProject.configured
  ? createAppKit({
      adapters: [wagmiAdapter],
      projectId: reownProject.projectId,
      networks: [...appKitNetworks],
      defaultNetwork: arcTestnetAppKitNetwork,
      metadata: appKitMetadata,
      features: { ...appKitFeatures, connectMethodsOrder: [...appKitFeatures.connectMethodsOrder] },
      allWallets: "SHOW",
      enableWallets: true,
      enableNetworkSwitch: true,
      allowUnsupportedChain: false,
      coinbasePreference: "eoaOnly",
      defaultAccountTypes: { eip155: "eoa" },
    })
  : undefined;
