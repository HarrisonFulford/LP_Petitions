import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

import { baseSepoliaChain } from "./chains";

export const wagmiConfig = createConfig({
  chains: [baseSepoliaChain],
  connectors: [injected()],
  transports: {
    [baseSepoliaChain.id]: http(
      process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || baseSepoliaChain.rpcUrls.default.http[0],
    ),
  },
  ssr: true,
});
