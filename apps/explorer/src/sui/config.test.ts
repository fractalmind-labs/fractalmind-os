import { describe, expect, it } from "vitest";
import { SUI_CONFIG, suiScanUrl } from "./config.ts";

describe("sui config", () => {
  it("uses testnet explorer", () => {
    expect(SUI_CONFIG.explorerBase).toContain("suiscan.xyz/testnet");
  });

  it("builds object and txblock urls", () => {
    const objectUrl = suiScanUrl("object", "0xabc");
    const txUrl = suiScanUrl("txblock", "0xdef");

    expect(objectUrl).toBe("https://suiscan.xyz/testnet/object/0xabc");
    expect(txUrl).toBe("https://suiscan.xyz/testnet/txblock/0xdef");
  });
});
