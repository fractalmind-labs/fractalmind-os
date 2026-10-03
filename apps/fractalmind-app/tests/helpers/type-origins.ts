import { FractalMindClient } from "@fractalmind-labs/fractalmind-sdk";
import type { ClientWithCoreApi } from "@mysten/sui/client";

/** Use the production fresh-deployment type API in existing object fixtures.
 * Upgraded fixtures supply actual package BCS to a real SDK client separately. */
export function fixtureCoreTypes(packageId: string) {
  const client = new FractalMindClient({
    packageId,
    client: { network: "localnet", core: {} } as ClientWithCoreApi,
  });
  return {
    coreType: client.coreType.bind(client),
    coreTypeTag: client.coreTypeTag.bind(client),
    loadCoreTypeOrigins: client.loadCoreTypeOrigins.bind(client),
  };
}
