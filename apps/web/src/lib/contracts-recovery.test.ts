import { describe, expect, it } from "vitest";
import type { Address, Hash, Transaction, TransactionReceipt } from "viem";
import { recoverTransactionReceipt } from "./contracts";
import type { TradeRecovery } from "./transactions";

const sender = "0x0000000000000000000000000000000000000011" as Address;
const target = "0x0000000000000000000000000000000000000022" as Address;
const originalHash = `0x${"11".repeat(32)}` as Hash;
const replacementHash = `0x${"22".repeat(32)}` as Hash;
const recovery: TradeRecovery = {
  sender,
  nonce: 7,
  to: target,
  value: "100",
  input: "0x1234",
  nextScanBlock: "100",
};

const receipt = (hash: Hash, status: "success" | "reverted" = "success") => ({
  transactionHash: hash,
  status,
  logs: [],
}) as unknown as TransactionReceipt;

const transaction = (overrides: Partial<Transaction> = {}) => ({
  from: sender,
  nonce: 7,
  to: target,
  value: BigInt(100),
  input: "0x1234",
  hash: replacementHash,
  ...overrides,
}) as Transaction;

function receiptMissing() {
  const error = new Error("Transaction receipt could not be found");
  error.name = "TransactionReceiptNotFoundError";
  return error;
}

type RecoveryClient = Parameters<typeof recoverTransactionReceipt>[0];

function client(overrides: Partial<RecoveryClient> = {}): RecoveryClient {
  return {
    getTransactionReceipt: async () => { throw receiptMissing(); },
    getTransaction: async () => transaction({ hash: originalHash }),
    getBlockNumber: async () => BigInt(100),
    getTransactionCount: async () => 8,
    getBlock: async () => ({ transactions: [] }),
    ...overrides,
  };
}

describe("transaction receipt recovery", () => {
  it("returns the original confirmed or reverted receipt without replacement scanning", async () => {
    for (const status of ["success", "reverted"] as const) {
      const result = await recoverTransactionReceipt(client({ getTransactionReceipt: async () => receipt(originalHash, status) }), originalHash, recovery);
      expect(result).toMatchObject({ kind: "receipt", receipt: { status, transactionHash: originalHash } });
    }
  });

  it("keeps the transaction pending while its sender nonce is unconsumed", async () => {
    const result = await recoverTransactionReceipt(client({ getTransactionCount: async () => 7 }), originalHash, recovery);
    expect(result).toEqual({ kind: "pending", recovery });
  });

  it("detects a repriced transaction by sender, nonce, target, value, and calldata", async () => {
    const replacement = transaction();
    const result = await recoverTransactionReceipt(client({
      getTransactionReceipt: async ({ hash }) => {
        if (hash === originalHash) throw receiptMissing();
        return receipt(hash);
      },
      getBlock: async () => ({ transactions: [replacement] }),
    }), originalHash, recovery);
    expect(result).toMatchObject({ kind: "replacement", reason: "repriced", receipt: { transactionHash: replacementHash } });
  });

  it("distinguishes cancellation and semantic replacement", async () => {
    const cases = [
      [transaction({ to: sender, value: BigInt(0), input: "0x" }), "cancelled"],
      [transaction({ to: "0x0000000000000000000000000000000000000033", input: "0xabcd" }), "replaced"],
    ] as const;
    for (const [replacement, reason] of cases) {
      const result = await recoverTransactionReceipt(client({
        getTransactionReceipt: async ({ hash }) => {
          if (hash === originalHash) throw receiptMissing();
          return receipt(hash);
        },
        getBlock: async () => ({ transactions: [replacement] }),
      }), originalHash, recovery);
      expect(result).toMatchObject({ kind: "replacement", reason });
    }
  });

  it("persists forward scan progress while the consumed nonce is outside the bounded batch", async () => {
    const result = await recoverTransactionReceipt(client({ getBlockNumber: async () => BigInt(300) }), originalHash, recovery);
    expect(result).toEqual({ kind: "pending", recovery: { ...recovery, nextScanBlock: "228" } });
  });

  it("fails to confirmation unknown instead of reporting pending after a consumed nonce is fully scanned", async () => {
    await expect(recoverTransactionReceipt(client(), originalHash, recovery)).rejects.toThrow(/nonce was consumed.*provenance was unavailable/i);
  });
});
