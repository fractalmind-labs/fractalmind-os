import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export async function verifyGoAuthority(packageId: string, capabilityId: string, expectedCode = '') {
  if (process.env.FM_HOST_AUTHORITY_VERIFY !== '1') return;
  const cwd = fileURLToPath(new URL('../../../../runtime/fractalmind-envd/', import.meta.url));
  const { stdout } = await promisify(execFile)('go', ['test', './internal/nodecommand', '-run', '^TestChainAuthorityLive$', '-count=1', '-v'], {
    cwd, timeout: 30000,
    env: { ...process.env, FM_CHAIN_AUTHORITY_CASE: JSON.stringify({ RPC: process.env.FM_LOCALNET_RPC ?? 'http://127.0.0.1:29000', PackageID: packageId, CapabilityID: capabilityId, ExpectedCode: expectedCode }) },
  });
  if (!stdout.includes('--- PASS: TestChainAuthorityLive')) throw new Error(`Real Go authorization check did not run: ${stdout}`);
  console.log(`Go gRPC authority: ${expectedCode || 'active'} PASS ${capabilityId}`);
}
