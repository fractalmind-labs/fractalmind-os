import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import type { Transaction } from '@mysten/sui/transactions';
import { deriveDynamicFieldID, normalizeSuiAddress } from '@mysten/sui/utils';

import {
  FractalMindClient,
  readAddress,
  readBigInt,
  readBoolean,
  readOptionId,
  readString,
} from './client.js';
import type {
  CreateOrganizationInput,
  ObjectId,
  OrganizationData,
  UpdateDescriptionInput,
} from './types.js';

const ID = bcs.Address;
const Table = bcs.struct('Table', { id: ID, size: bcs.u64() });
const ProtocolRegistry = bcs.struct('ProtocolRegistry', {
  id: ID,
  organizations: Table,
  name_registry: Table,
  org_count: bcs.u64(),
});

/** This is deliberately a point lookup, rather than a paginated scan of the
 * public directory. The chain's name table is the authority for names across
 * every Human, including organizations the current Human cannot list. */
export type OrganizationNameLookup = {
  organizationId: string | null;
  registryId: string;
};

function missingNameField(error: unknown, parentId: string, name: Uint8Array) {
  const objectId = deriveDynamicFieldID(
    parentId,
    TypeTagSerializer.parseFromStr('0x1::string::String'),
    name,
  );
  return (
    !!error &&
    typeof error === 'object' &&
    'reason' in error &&
    error.reason === 'notFound' &&
    'objectId' in error &&
    error.objectId === objectId
  );
}

export class OrganizationApi {
  constructor(private readonly fm: FractalMindClient) {}

  createOrganization(input: CreateOrganizationInput): Transaction {
    const tx = this.fm.useTransaction(input.tx);

    tx.moveCall({
      target: this.fm.target('create_organization'),
      arguments: [
        tx.object(this.fm.resolveRegistryId(input.registryId)),
        tx.pure.string(input.name),
        tx.pure.string(input.description),
      ],
    });

    return tx;
  }

  updateDescription(input: UpdateDescriptionInput): Transaction {
    const tx = this.fm.useTransaction(input.tx);

    tx.moveCall({
      target: this.fm.target('update_org_description'),
      arguments: [
        tx.object(input.adminCapId),
        tx.object(input.organizationId),
        tx.pure.string(input.newDescription),
      ],
    });

    return tx;
  }

  /** Resolve one trimmed organization name through
   * `ProtocolRegistry.name_registry: Table<String, ID>`. A missing dynamic
   * field is a definite free name; all other read failures deliberately reach
   * the caller so the UI can warn without falsely declaring it available. */
  async findByName(name: string, protocolRegistryId?: ObjectId): Promise<OrganizationNameLookup> {
    if (!name || name !== name.trim()) throw new Error('Organization name must be trimmed and non-empty.');
    const registryId = this.fm.resolveRegistryId(protocolRegistryId);
    const { object } = await this.fm.client.core.getObject({
      objectId: registryId,
      include: { content: true },
    });
    if (
      object.objectId !== registryId ||
      object.type !== (await this.fm.coreType('organization', 'ProtocolRegistry')) ||
      object.owner.$kind !== 'Shared' ||
      !object.content
    )
      throw new Error('Configured registry is not a shared ProtocolRegistry.');
    const registry = ProtocolRegistry.parse(object.content);
    if (registry.id !== registryId) throw new Error('ProtocolRegistry UID mismatch.');
    const key = bcs.string().serialize(name).toBytes();
    try {
      const { dynamicField } = await this.fm.client.core.getDynamicField({
        parentId: registry.name_registry.id,
        name: { type: '0x1::string::String', bcs: key },
      });
      const organizationId = normalizeSuiAddress(ID.parse(dynamicField.value.bcs));
      return { registryId, organizationId };
    } catch (error) {
      if (missingNameField(error, registry.name_registry.id, key))
        return { registryId, organizationId: null };
      throw error;
    }
  }

  async getOrganization(organizationId: ObjectId): Promise<OrganizationData> {
    const obj = await this.fm.getMoveObject(organizationId);

    if (!obj.type.endsWith('::organization::Organization')) {
      throw new Error(`Object ${organizationId} is not an Organization.`);
    }

    return {
      objectId: obj.objectId,
      type: obj.type,
      name: readString(obj.fields, 'name'),
      description: readString(obj.fields, 'description'),
      admin: readAddress(obj.fields, 'admin'),
      isActive: readBoolean(obj.fields, 'is_active'),
      agentCount: readBigInt(obj.fields, 'agent_count'),
      taskCount: readBigInt(obj.fields, 'task_count'),
      depth: readBigInt(obj.fields, 'depth'),
      childOrgCount: readBigInt(obj.fields, 'child_org_count'),
      parentOrgId: readOptionId(obj.fields, 'parent_org'),
    };
  }
}
