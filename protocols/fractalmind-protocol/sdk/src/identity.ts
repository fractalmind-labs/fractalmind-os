import { bcs } from '@mysten/sui/bcs';
import type { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { FractalMindClient, toBigInt } from './client.js';
import { recoveryKeys } from './identity-crypto.js';
import { bytesArgument } from './wire-bytes.js';
import type { NetworkName } from './types.js';

const ID = bcs.Address;
const Bytes = bcs.vector(bcs.u8());
const Table = bcs.struct('Table', { id: ID, size: bcs.u64() });
// Move encodes a fieldless struct with the compiler's false dummy field.
export const RegistryBindingBcs = bcs.struct('RegistryBinding', { dummy_field: bcs.bool() });
export const IdentityRegistryBcs = bcs.struct('IdentityRegistry', {
  id: ID, protocol_registry: ID, recoveries: Table, devices: Table,
});
export const RecoveryLocationBcs = bcs.struct('RecoveryLocation', {
  human_id: ID, record_id: ID, version: bcs.u64(),
});
export const HumanIdentityBcs = bcs.struct('HumanIdentity', {
  id: ID, registry_id: ID, network: bcs.string(), generation: bcs.u64(),
  recovery_version: bcs.u64(), recovery_record: ID, recovery_address: ID,
  admin_caps: Table, roles: Table, organizations: bcs.vector(ID), grants: bcs.vector(ID),
});
export const DeviceGrantBcs = bcs.struct('DeviceGrant', {
  id: ID, human_id: ID, device: ID, org_scope: bcs.option(ID), actions: Bytes,
  expires_at_ms: bcs.u64(), revoked: bcs.bool(), version: bcs.u64(), generation: bcs.u64(),
  encryption_public_key: Bytes, encrypted_keys: Bytes,
});
export const RecoveryRecordBcs = bcs.struct('RecoveryRecord', {
  id: ID, human_id: ID, registry_id: ID, format_version: bcs.u8(), network: bcs.string(),
  version: bcs.u64(), active: bcs.bool(), recovery_address: ID,
  signing_public_key: Bytes, encryption_public_key: Bytes, encrypted_backup: Bytes,
  backup_version: bcs.u64(),
});

export type DeviceAction = 'read' | 'operate' | 'approve' | 'manage_hosts';
export const DEVICE_ACTIONS: Readonly<Record<DeviceAction, number>> = Object.freeze({ read: 1, operate: 2, approve: 3, manage_hosts: 4 });
type TxInput = { tx?: Transaction };
type DeviceKeys = { device: string; deviceEncryptionKey: Uint8Array; encryptedDeviceKeys: Uint8Array };
type RecoveryKeys = { recoverySigningKey: Uint8Array; recoveryEncryptionKey: Uint8Array; encryptedBackup: Uint8Array };
type Authorized = { humanId: string; grantId: string };

/** Public methods build transactions; caller retains signing and gas ownership.
 * Recovery signer proves possession via a normal Sui transaction signature.
 * Pass only public keys and encrypted bytes, never a recovery code as an arg. */
export class IdentityApi {
  private readonly typesPackageId: string;
  constructor(private readonly fm: FractalMindClient, typesPackageId?: string) {
    this.typesPackageId = normalizeSuiAddress(typesPackageId ?? fm.typesPackageId);
  }
  private call(name: string, tx: Transaction, args: Parameters<Transaction['moveCall']>[0]['arguments']): Transaction {
    tx.moveCall({ target: `${this.fm.packageId}::identity::${name}`, arguments: args });
    return tx;
  }
  private recoveryArguments(tx: Transaction, input: RecoveryKeys) {
    return [tx.pure.vector('u8', input.recoverySigningKey), tx.pure.vector('u8', input.recoveryEncryptionKey), bytesArgument(tx, this.fm.packageId, input.encryptedBackup)];
  }
  private deviceArguments(tx: Transaction, input: DeviceKeys) {
    return [tx.pure.address(input.device), tx.pure.vector('u8', input.deviceEncryptionKey), bytesArgument(tx, this.fm.packageId, input.encryptedDeviceKeys)];
  }
  initializeRegistry(input: TxInput & { protocolRegistryId?: string } = {}): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('initialize_registry', tx, [tx.object(this.fm.resolveRegistryId(input.protocolRegistryId))]);
  }
  createIdentity(input: TxInput & DeviceKeys & RecoveryKeys & { identityRegistryId: string; network: NetworkName }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('create_identity', tx, [tx.object(input.identityRegistryId), tx.pure.string(input.network), ...this.recoveryArguments(tx, input), ...this.deviceArguments(tx, input), tx.object('0x6')]);
  }
  createOrganization(input: TxInput & Authorized & { protocolRegistryId?: string; name: string; description: string }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('create_organization', tx, [tx.object(this.fm.resolveRegistryId(input.protocolRegistryId)), tx.object(input.humanId), tx.object(input.grantId), tx.pure.string(input.name), tx.pure.string(input.description), tx.object('0x6')]);
  }
  migrateOrganization(input: TxInput & Authorized & { organizationId: string; adminCapId: string }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('migrate_organization', tx, [tx.object(input.humanId), tx.object(input.grantId), tx.object(input.organizationId), tx.object(input.adminCapId), tx.object('0x6')]);
  }
  addReadDevice(input: TxInput & Authorized & DeviceKeys & { identityRegistryId: string; organizationId: string }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('add_read_device', tx, [tx.object(input.identityRegistryId), tx.object(input.humanId), tx.object(input.grantId), tx.object(input.organizationId), ...this.deviceArguments(tx, input), tx.object('0x6')]);
  }
  addRootDevice(input: TxInput & Authorized & DeviceKeys & { identityRegistryId: string; expiresAtMs: bigint | string | number }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('add_root_device', tx, [tx.object(input.identityRegistryId), tx.object(input.humanId), tx.object(input.grantId), ...this.deviceArguments(tx, input), tx.pure.u64(toBigInt(input.expiresAtMs)), tx.object('0x6')]);
  }
  changeDevicePermissions(input: TxInput & Authorized & { targetGrantId: string; organizationId: string; actions: DeviceAction[]; expiresAtMs: bigint | string | number }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    const actions = input.actions.map(action => DEVICE_ACTIONS[action]);
    if (actions.some(action => !action) || actions.length < 1 || actions.length > 4 || new Set(actions).size !== actions.length) throw new Error('Invalid device actions.');
    return this.call('change_device_permissions', tx, [tx.object(input.humanId), tx.object(input.grantId), tx.object(input.targetGrantId), tx.object(input.organizationId), tx.pure.vector('u8', actions), tx.pure.u64(toBigInt(input.expiresAtMs)), tx.object('0x6')]);
  }
  revokeDevice(input: TxInput & Authorized & { targetGrantId: string }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('revoke_device', tx, [tx.object(input.humanId), tx.object(input.grantId), tx.object(input.targetGrantId), tx.object('0x6')]);
  }
  updateDeviceKeys(input: TxInput & Authorized & { targetGrantId: string; organizationId: string; expectedVersion: bigint | string | number; encryptedKeys: Uint8Array }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    if (normalizeSuiAddress(input.targetGrantId) === normalizeSuiAddress(input.grantId)) {
      return this.call('update_root_device_keys', tx, [tx.object(input.humanId), tx.object(input.grantId), tx.pure.u64(toBigInt(input.expectedVersion)), bytesArgument(tx, this.fm.packageId, input.encryptedKeys), tx.object('0x6')]);
    }
    return this.call('update_device_keys', tx, [tx.object(input.humanId), tx.object(input.grantId), tx.object(input.targetGrantId), tx.object(input.organizationId), tx.pure.u64(toBigInt(input.expectedVersion)), bytesArgument(tx, this.fm.packageId, input.encryptedKeys), tx.object('0x6')]);
  }
  updateOrganizationDescription(input: TxInput & Authorized & { organizationId: string; description: string }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('update_organization_description', tx, [tx.object(input.humanId), tx.object(input.grantId), tx.object(input.organizationId), tx.pure.string(input.description), tx.object('0x6')]);
  }
  updateRecoveryBackup(input: TxInput & Authorized & { recordId: string; expectedBackupVersion: bigint | string | number; encryptedBackup: Uint8Array }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('update_recovery_backup', tx, [tx.object(input.humanId), tx.object(input.grantId), tx.object(input.recordId), tx.pure.u64(toBigInt(input.expectedBackupVersion)), bytesArgument(tx, this.fm.packageId, input.encryptedBackup), tx.object('0x6')]);
  }
  recoverIdentity(input: TxInput & DeviceKeys & RecoveryKeys & { identityRegistryId: string; humanId: string; recordId: string }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('recover_identity', tx, [tx.object(input.identityRegistryId), tx.object(input.humanId), tx.object(input.recordId), ...this.recoveryArguments(tx, input), ...this.deviceArguments(tx, input), tx.object('0x6')]);
  }
  replaceRecoveryCode(input: TxInput & Authorized & RecoveryKeys & { identityRegistryId: string; recordId: string }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('replace_recovery_code', tx, [tx.object(input.identityRegistryId), tx.object(input.humanId), tx.object(input.grantId), tx.object(input.recordId), ...this.recoveryArguments(tx, input), tx.object('0x6')]);
  }
  private async content(objectId: string, kind: string): Promise<Uint8Array> {
    const { object } = await this.fm.client.core.getObject({ objectId, include: { content: true } });
    if (object.type !== `${this.typesPackageId}::identity::${kind}` || !object.content) throw new Error(`Unexpected ${kind} object type or missing BCS content.`);
    return object.content;
  }
  async getHuman(humanId: string) { return HumanIdentityBcs.parse(await this.content(humanId, 'HumanIdentity')); }
  async getDeviceGrant(grantId: string) { return DeviceGrantBcs.parse(await this.content(grantId, 'DeviceGrant')); }
  async getRecoveryRecord(recordId: string) { return RecoveryRecordBcs.parse(await this.content(recordId, 'RecoveryRecord')); }
  async getRegistry(registryId: string) { return IdentityRegistryBcs.parse(await this.content(registryId, 'IdentityRegistry')); }
  async resolveRegistry(protocolRegistryId?: string): Promise<string> {
    const protocolId = this.fm.resolveRegistryId(protocolRegistryId);
    const response = await this.fm.client.core.getDynamicField({ parentId: protocolId, name: { type: `${this.typesPackageId}::identity::RegistryBinding`, bcs: RegistryBindingBcs.serialize({ dummy_field: false }).toBytes() } });
    const id = ID.parse(response.dynamicField.value.bcs);
    const registry = await this.getRegistry(id);
    if (registry.protocol_registry !== protocolId) throw new Error('Identity registry does not belong to the configured protocol registry.');
    return id;
  }
  /** Only locates records. It never authorizes the calling device. */
  async locateRecovery(code: string, network: NetworkName) {
    const keys = recoveryKeys(code, network);
    const registryId = await this.resolveRegistry();
    const registry = await this.getRegistry(registryId);
    const response = await this.fm.client.core.getDynamicField({ parentId: registry.recoveries.id, name: { type: 'address', bcs: ID.serialize(keys.address).toBytes() } });
    const location = RecoveryLocationBcs.parse(response.dynamicField.value.bcs);
    const record = await this.getRecoveryRecord(location.record_id);
    const human = await this.getHuman(location.human_id);
    keys.encryptionSecret.fill(0);
    if (!record.active || record.recovery_address !== keys.address || record.network !== network
      || record.registry_id !== registryId || record.human_id !== human.id
      || human.recovery_record !== record.id || human.recovery_version !== record.version
      || location.version !== record.version) throw new Error('Recovery code is consumed, superseded, or belongs to another identity/network.');
    return { registryId, human, record };
  }
}
