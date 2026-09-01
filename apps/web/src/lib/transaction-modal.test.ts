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
});
