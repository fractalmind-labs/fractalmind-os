import type { NetworkName } from '@fractalmind-labs/fractalmind-sdk';

export type Deployment = {
  network: NetworkName;
  packageId: string;
  registryId: string;
  fullnodeUrl?: string;
  originalPackageId?: string;
  okrPackageId?: string;
  originalOkrPackageId?: string;
  directPackageId?: string;
  originalDirectPackageId?: string;
  chainIdentifier?: string;
};

export type Profile = {
  version: 1;
  network: NetworkName;
  deployment: Deployment;
  address: string;
  keyRef: string;
  label: string;
  organizationId: string;
  humanId: string;
  requestId?: string;
  grantId?: string;
  createdAt: string;
};

export type StoredKey = {
  signingSecret: string;
  encryptionSecret: string;
  encryptionPublicKey: string;
};

export type ParsedArgs = {
  command: string[];
  values: Record<string, string | boolean>;
};
