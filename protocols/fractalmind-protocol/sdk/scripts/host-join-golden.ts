/** Offline interoperability vector. All keys/IDs are deterministic test fixtures;
 * no chain objects, credentials or RPC requests are involved. */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { bcs } from "@mysten/sui/bcs";
import { toBase58 } from "@mysten/bcs";
import {
  HostJoinIntentBcs,
  encodeHostInviteCode,
  parseHostInviteCode,
} from "../src/host.js";

const id = (n: number) => normalizeSuiAddress(`0x${n.toString(16)}`);
const entropy = Uint8Array.from({ length: 32 }, (_, i) => i);
const host = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(77));
const pub = host.getPublicKey().toRawBytes();
const enc = new Uint8Array(32).fill(88);
const invitation = parseHostInviteCode(
  encodeHostInviteCode("localnet", id(17), entropy),
  "localnet",
);
const expiry = 1700000120000;
const signature = await invitation.signer.sign(
  HostJoinIntentBcs.serialize({
    domain: new TextEncoder().encode("fractalmind.host-invite.v1"),
    invite_id: id(17),
    org_id: id(2),
    coordinator_binding: id(16),
    binding_version: "1",
    host_address: host.toSuiAddress(),
    host_public_key: pub,
    encryption_public_key: enc,
    proof_expires_at_ms: String(expiry),
  }).toBytes(),
);
const tx = new Transaction();
tx.setSender(host.toSuiAddress());
tx.setGasBudget(10000000);
tx.setGasPrice(1000);
tx.setGasPayment([]);
const chain = toBase58(new Uint8Array(32).fill(99));
const expiration = {
  ValidDuring: {
    minEpoch: "42",
    maxEpoch: "43",
    minTimestamp: null,
    maxTimestamp: null,
    chain,
    nonce: 42,
  },
};
tx.setExpiration(expiration);
const object = (n: number, mutable: boolean) =>
  tx.sharedObjectRef({ objectId: id(n), initialSharedVersion: 11, mutable });
tx.moveCall({
  target: `${id(66)}::host::redeem_invite`,
  arguments: [
    object(2, true),
    object(17, true),
    object(16, false),
    object(3, false),
    object(8, false),
    tx.pure.vector("u8", pub),
    tx.pure.vector("u8", enc),
    tx.pure.string("fixture-host"),
    tx.pure.u64(expiry),
    tx.pure.vector("u8", signature),
    object(6, false),
  ],
});
const raw = await tx.build();
const coin = {
  objectId: id(50),
  version: "12",
  digest: toBase58(new Uint8Array(32).fill(55)),
};
const withCoin = Transaction.from(tx);
withCoin.setGasPayment([coin]);
const coinRaw = await withCoin.build();
const vector = {
  provenance:
    "Offline @mysten/sui 2.33.1 + FractalMind Host SDK; deterministic test keys and nonexistent IDs.",
  request: {
    PackageID: id(66),
    Sender: host.toSuiAddress(),
    OrganizationID: id(2),
    InviteID: id(17),
    BindingID: id(16),
    IssuerHuman: id(3),
    IssuerGrant: id(8),
    HostPublicKey: Buffer.from(pub).toString("base64"),
    EncryptionPublicKey: Buffer.from(enc).toString("base64"),
    ProofSignature: Buffer.from(signature).toString("base64"),
    Name: "fixture-host",
    ProofExpiresAtMS: expiry,
    GasBudget: 10000000,
    ChainIdentifier: chain,
  },
  proofPublicKey: Buffer.from(
    invitation.signer.getPublicKey().toRawBytes(),
  ).toString("base64"),
  txBytes: Buffer.from(raw).toString("base64"),
  digest: await tx.getDigest(),
  sharedVersion: 11,
  expiration: Buffer.from(
    bcs.TransactionExpiration.serialize(expiration).toBytes(),
  ).toString("base64"),
  coinTxBytes: Buffer.from(coinRaw).toString("base64"),
  coinDigest: await withCoin.getDigest(),
  coin,
};
const output = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../runtime/fractalmind-envd/internal/sui/testdata/host_join_mysten.json",
);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(vector, null, 2) + "\n");
console.log(JSON.stringify({ output, offline: true, digest: vector.digest }));
