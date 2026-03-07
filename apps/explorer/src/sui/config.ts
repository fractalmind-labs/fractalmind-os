/** Known on-chain object IDs from FractalMind testnet deployment */
export const SUI_CONFIG = {
  rpcUrl: "https://fullnode.testnet.sui.io:443",
  explorerBase: "https://suiscan.xyz/testnet",

  /** fractalmind_protocol package */
  protocolPackage:
    "0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24",
  /** Registry shared object */
  registry:
    "0xfb8611bf2eb94b950e4ad47a76adeaab8ddda23e602c77e7464cc20572a547e3",

  /** fractalmind_envd package */
  envdPackage:
    "0x74aef8ff3bb0da5d5626780e6c0e5f1f36308a40580e519920fdc9204e73d958",
  /** PeerRegistry shared object */
  peerRegistry:
    "0xe557465293df033fd6ba1347706d7e9db2a35de4667a3b6a2e20252587b6e505",
  /** SponsorRegistry shared object */
  sponsorRegistry:
    "0x22db6a75b60b1f530e9779188c62c75a44340723d9d78e21f7e25ded29718511",
} as const;

export function suiScanUrl(type: "object" | "txblock", id: string): string {
  return `${SUI_CONFIG.explorerBase}/${type}/${id}`;
}
