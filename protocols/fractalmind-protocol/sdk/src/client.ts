import type { ClientWithCoreApi, SuiClientTypes } from '@mysten/sui/client';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';

import type {
  Address,
  FractalMindClientOptions,
  MoveObjectData,
  NetworkName,
  ObjectId,
} from './types.js';

const DEFAULT_NETWORK: NetworkName = 'testnet';
const MAX_U64 = (1n << 64n) - 1n;

export class FractalMindClient {
  public readonly client: ClientWithCoreApi;
  public readonly packageId: ObjectId;
  public readonly registryId?: ObjectId;

  constructor(options: FractalMindClientOptions) {
    this.packageId = normalizeSuiAddress(options.packageId);
    this.registryId = options.registryId ? normalizeSuiAddress(options.registryId) : undefined;

    if (options.client) {
      this.client = options.client;
      return;
    }

    const network = options.network ?? DEFAULT_NETWORK;
    const url = options.fullnodeUrl ?? (network === 'localnet' ? 'http://127.0.0.1:9000' : `https://fullnode.${network}.sui.io:443`);
    this.client = new SuiGrpcClient({ baseUrl: url, network });
  }

  newTransaction(): Transaction {
    return new Transaction();
  }

  target(entryFunction: string): string {
    return `${this.packageId}::entry::${entryFunction}`;
  }

  resolveRegistryId(registryId?: ObjectId): ObjectId {
    if (registryId) {
      return normalizeSuiAddress(registryId);
    }
    if (this.registryId) {
      return this.registryId;
    }
    throw new Error('Missing registry object id. Pass registryId in call args or client options.');
  }

  useTransaction(tx?: Transaction): Transaction {
    return tx ?? this.newTransaction();
  }

  async getMoveObject(objectId: ObjectId): Promise<MoveObjectData> {
    const response = await this.client.core.getObject({
      objectId,
      include: { json: true },
    });

    const parsed = parseMoveObject(response);
    if (!parsed) {
      throw new Error(`Object ${objectId} was not found or is not a Move object.`);
    }
    return parsed;
  }

  async getOwnedMoveObjects(owner: Address, structType: string): Promise<MoveObjectData[]> {
    let cursor: string | null | undefined = null;
    const data: MoveObjectData[] = [];

    do {
      const page: SuiClientTypes.ListOwnedObjectsResponse<{ json: true }> = await this.client.core.listOwnedObjects({
        owner: normalizeSuiAddress(owner),
        type: structType,
        include: { json: true },
        cursor,
      });

      for (const item of page.objects) {
        const parsed = parseMoveObject({ object: item });
        if (parsed) {
          data.push(parsed);
        }
      }

      if (page.hasNextPage && (!page.cursor || page.cursor === cursor)) {
        throw new Error("Owned-object pagination returned a missing or repeated cursor.");
      }
      cursor = page.hasNextPage ? page.cursor : null;
    } while (cursor);

    return data;
  }

  async signAndExecuteTransaction(
    params: SuiClientTypes.SignAndExecuteTransactionOptions<SuiClientTypes.TransactionInclude>,
  ): Promise<SuiClientTypes.TransactionResult<SuiClientTypes.TransactionInclude>> {
    const { signer, transaction } = params as {
      signer?: { getPublicKey?: () => { toSuiAddress: () => string } };
      transaction?: Transaction;
    };

    if (transaction && signer?.getPublicKey) {
      const signerAddress = normalizeSuiAddress(signer.getPublicKey().toSuiAddress());
      const sender = transaction.getData().sender;
      if (!sender || normalizeSuiAddress(sender) !== signerAddress) {
        transaction.setSender(signerAddress);
      }
    }

    return this.client.core.signAndExecuteTransaction(params);
  }
}

function parseMoveObject(response: unknown): MoveObjectData | null {
  const { object } = response as {
    object?: { objectId: string; type: string; json?: Record<string, unknown> | null };
  };
  if (!object?.objectId || !object.type || !object.json || object.type === 'package') {
    return null;
  }
  return {
    objectId: normalizeSuiAddress(object.objectId),
    type: object.type,
    fields: object.json,
  };
}

export function readString(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  if (typeof value !== 'string') {
    throw new Error(`Expected string field '${key}'.`);
  }
  return value;
}

export function readAddress(fields: Record<string, unknown>, key: string): Address {
  const value = readString(fields, key);
  return normalizeSuiAddress(value);
}

export function readBoolean(fields: Record<string, unknown>, key: string): boolean {
  const value = fields[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Expected boolean field '${key}'.`);
  }
  return value;
}

export function readNumber(fields: Record<string, unknown>, key: string): number {
  const value = fields[key];
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number.parseInt(value, 10);
  }
  throw new Error(`Expected numeric field '${key}'.`);
}

export function readBigInt(fields: Record<string, unknown>, key: string): bigint {
  const value = fields[key];
  if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string') {
    return toBigInt(value);
  }
  throw new Error(`Expected bigint-like field '${key}'.`);
}

export function readNumberVector(fields: Record<string, unknown>, key: string): number[] {
  const value = fields[key];
  if (!Array.isArray(value)) {
    throw new Error(`Expected array field '${key}'.`);
  }
  return value.map((item) => {
    if (typeof item === 'number') {
      return item;
    }
    if (typeof item === 'string') {
      return Number.parseInt(item, 10);
    }
    throw new Error(`Expected numeric element in '${key}'.`);
  });
}

export function readStringVector(fields: Record<string, unknown>, key: string): string[] {
  const value = fields[key];
  if (!Array.isArray(value)) {
    throw new Error(`Expected array field '${key}'.`);
  }
  return value.map((item) => {
    if (typeof item !== 'string') {
      throw new Error(`Expected string element in '${key}'.`);
    }
    return item;
  });
}

// gRPC/GraphQL render Option as a scalar/null or a vector. Also accept the
// older { vec } rendering for callers using their own Core API adapter.
function optionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value[0] ?? null;
  if (value && typeof value === 'object' && 'vec' in value) {
    const vec = (value as { vec: unknown }).vec;
    return Array.isArray(vec) ? vec[0] ?? null : null;
  }
  return value ?? null;
}

export function readOptionId(fields: Record<string, unknown>, key: string): ObjectId | null {
  const value = optionValue(fields[key]);
  return typeof value === 'string' ? normalizeSuiAddress(value) : null;
}

export function readOptionBigInt(fields: Record<string, unknown>, key: string): bigint | null {
  const value = optionValue(fields[key]);
  return typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string'
    ? toBigInt(value)
    : null;
}

export function toBigInt(value: bigint | number | string): bigint {
  let parsed: bigint;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error('u64 number inputs must be safe integers; use bigint or a decimal string.');
    }
    parsed = BigInt(value);
  } else if (typeof value === 'string') {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
      throw new Error('u64 string inputs must be unsigned decimal integers.');
    }
    parsed = BigInt(value);
  } else {
    parsed = value;
  }

  if (parsed < 0n || parsed > MAX_U64) {
    throw new Error('u64 input is outside the range 0..18446744073709551615.');
  }
  return parsed;
}
