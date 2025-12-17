import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { bsc, bscTestnet } from 'wagmi/chains';

// Only allow BSC mainnet and BSC testnet in the wallet.
export const config = getDefaultConfig({
  appName: 'CINA Dex Frontend',
  projectId:
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? 'CINA_DEX_DEMO_PROJECT',
  chains: [bsc, bscTestnet],
  ssr: true,
});
