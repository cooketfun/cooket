import { describe, expect, it } from "vitest";
import { closedTransactionModal, transactionModalReducer, transactionPhaseIsBusy, transactionPhaseLabel } from "./transaction-modal";

describe("shared transaction modal state", () => {
  it("moves through review, wallet, receipt, and confirmation states", () => {
    let state = transactionModalReducer(closedTransactionModal, { type: "review" });
    for (const phase of ["awaiting_wallet", "submitted", "confirming", "confirmed"] as const) state = transactionModalReducer(state, { type: "progress", phase });
    expect(state).toEqual({ open: true, phase: "confirmed" });
    expect(transactionPhaseIsBusy("confirming")).toBe(true);
  });

  it("represents approval then sell as receipt-safe distinct steps", () => {
    let state = transactionModalReducer(closedTransactionModal, { type: "review" });
    const sequence = ["awaiting_approval", "approval_submitted", "approval_confirmed", "preparing_sell", "awaiting_sell_signature", "sell_submitted", "sell_confirming", "confirmed"] as const;
    for (const phase of sequence) state = transactionModalReducer(state, { type: "progress", phase });
    expect(state.phase).toBe("confirmed");
    expect(transactionPhaseLabel("approval_confirmed")).toBe("Approval confirmed");
  });

  it("keeps rejection, failure, and expiry visually distinct", () => {
    expect(transactionPhaseLabel("rejected")).toMatch(/rejected/i);
    expect(transactionPhaseLabel("failed")).toMatch(/failed/i);
    expect(transactionPhaseLabel("expired")).toMatch(/expired/i);
  });

  it("keeps approval refresh and swap simulation distinct from preparing a sell", () => {
    expect(transactionPhaseLabel("preparing_sell")).toBe("Preparing sell");
    expect(transactionPhaseLabel("refreshing_state")).toBe("Refreshing approval and balances");
    expect(transactionPhaseLabel("simulating_swap")).toBe("Simulating swap on Arc Testnet");
    expect(transactionPhaseLabel("preparing")).toBe("Simulating transaction");
    expect(transactionPhaseIsBusy("refreshing_state")).toBe(true);
    expect(transactionPhaseIsBusy("simulating_swap")).toBe(true);
  });
});
