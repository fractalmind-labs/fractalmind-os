/**
 * Minimal Sui GraphQL RPC client.
 *
 * Sui decommissioned public-fullnode JSON-RPC (mainnet: July 2026, full
 * removal: October 2026 — see
 * https://docs.sui.io/develop/accessing-data/json-rpc-migration). GraphQL is
 * its replacement for the read patterns this app needs (single and batched
 * object lookups, dynamic field pagination, owned-objects-by-type queries).
 *
 * Object content comes back as raw BCS bytes (base64-encoded), not decoded
 * JSON fields like JSON-RPC used to return — see ./bcs.ts for the schemas
 * that decode it.
 */

export class SuiGraphQLError extends Error {}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

export async function graphqlQuery<T = Record<string, unknown>>(
  url: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new SuiGraphQLError(
      `GraphQL request failed: ${res.status} ${res.statusText}`,
    );
  }
  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new SuiGraphQLError(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) {
    throw new SuiGraphQLError("GraphQL response had no data");
  }
  return json.data;
}

// ── Shared fragments/types ──────────────────────────────────────────

export interface MoveContents {
  bcs: string;
  type: { repr: string };
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export type DynamicFieldValue =
  | { __typename: "MoveValue"; bcs: string; type: { repr: string } }
  | { __typename: "MoveObject"; contents: MoveContents };

export interface DynamicFieldNode {
  name: { bcs: string; type: { repr: string } };
  value: DynamicFieldValue;
}

/** One object's Move contents, or null if it doesn't exist / isn't a Move object. */
export async function getObjectContents(
  url: string,
  address: string,
): Promise<MoveContents | null> {
  interface Response {
    object: { asMoveObject: { contents: MoveContents } | null } | null;
  }
  const data = await graphqlQuery<Response>(
    url,
    `query($id: SuiAddress!) {
      object(address: $id) { asMoveObject { contents { bcs type { repr } } } }
    }`,
    { id: address },
  );
  return data.object?.asMoveObject?.contents ?? null;
}

/** Move contents for multiple objects, in the same order as `addresses`. */
export async function multiGetObjectContents(
  url: string,
  addresses: string[],
): Promise<(MoveContents | null)[]> {
  interface Response {
    multiGetObjects: ({ asMoveObject: { contents: MoveContents } | null } | null)[];
  }
  if (addresses.length === 0) return [];
  const results: (MoveContents | null)[] = [];
  // GraphQL connections are capped server-side; batch defensively.
  for (let i = 0; i < addresses.length; i += 50) {
    const batch = addresses.slice(i, i + 50);
    const data = await graphqlQuery<Response>(
      url,
      `query($keys: [ObjectKey!]!) {
        multiGetObjects(keys: $keys) { asMoveObject { contents { bcs type { repr } } } }
      }`,
      { keys: batch.map((address) => ({ address })) },
    );
    for (const obj of data.multiGetObjects) {
      results.push(obj?.asMoveObject?.contents ?? null);
    }
  }
  return results;
}

/** Every dynamic field on `parentId` (a Table's or an object's UID), paginated. */
export async function getAllDynamicFields(
  url: string,
  parentId: string,
): Promise<DynamicFieldNode[]> {
  interface Response {
    address: {
      dynamicFields: { pageInfo: PageInfo; nodes: DynamicFieldNode[] };
    } | null;
  }
  const nodes: DynamicFieldNode[] = [];
  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const data: Response = await graphqlQuery<Response>(
      url,
      `query($parentId: SuiAddress!, $cursor: String) {
        address(address: $parentId) {
          dynamicFields(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              name { bcs type { repr } }
              value {
                __typename
                ... on MoveValue { bcs type { repr } }
                ... on MoveObject { contents { bcs type { repr } } }
              }
            }
          }
        }
      }`,
      { parentId, cursor },
    );
    const page = data.address?.dynamicFields;
    if (!page) break;
    nodes.push(...page.nodes);
    hasNext = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return nodes;
}

/** Every object owned by `owner` whose type matches `structType`, paginated. */
export async function getOwnedObjectsByType(
  url: string,
  owner: string,
  structType: string,
): Promise<{ address: string; contents: MoveContents }[]> {
  interface Response {
    address: {
      objects: {
        pageInfo: PageInfo;
        nodes: { address: string; contents: MoveContents }[];
      };
    } | null;
  }
  const results: { address: string; contents: MoveContents }[] = [];
  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const data: Response = await graphqlQuery<Response>(
      url,
      `query($owner: SuiAddress!, $cursor: String, $filter: ObjectFilter) {
        address(address: $owner) {
          objects(first: 50, after: $cursor, filter: $filter) {
            pageInfo { hasNextPage endCursor }
            nodes { address contents { bcs type { repr } } }
          }
        }
      }`,
      { owner, cursor, filter: { type: structType } },
    );
    const page = data.address?.objects;
    if (!page) break;
    results.push(...page.nodes);
    hasNext = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return results;
}
