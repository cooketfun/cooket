export type TransactionModalPhase =
  | "review" | "preparing" | "awaiting_wallet" | "submitted" | "confirming" | "confirmed"
  | "awaiting_approval" | "approval_submitted" | "approval_confirmed" | "preparing_sell"
  | "awaiting_sell_signature" | "sell_submitted" | "sell_confirming"
  | "failed" | "rejected" | "expired" | "confirmation_unknown";

export type TransactionModalState = { open: boolean; phase: TransactionModalPhase };
export type TransactionModalAction =
  | { type: "review" }
  | { type: "progress"; phase: TransactionModalPhase }
  | { type: "close" };

export const closedTransactionModal: TransactionModalState = { open: false, phase: "review" };

export function transactionModalReducer(state: TransactionModalState, action: TransactionModalAction): TransactionModalState {
  if (action.type === "review") return { open: true, phase: "review" };
  if (action.type === "progress") return { open: true, phase: action.phase };
  return { ...state, open: false };
}

export const transactionPhaseIsBusy = (phase: TransactionModalPhase) => [
  "preparing", "awaiting_wallet", "submitted", "confirming", "awaiting_approval", "approval_submitted",
  "approval_confirmed", "preparing_sell", "awaiting_sell_signature", "sell_submitted", "sell_confirming",
].includes(phase);

export function transactionPhaseLabel(phase: TransactionModalPhase) {
  return ({
    review: "Review transaction", preparing: "Simulating transaction", awaiting_wallet: "Awaiting wallet confirmation",
    submitted: "Transaction submitted", confirming: "Confirming on Arc Testnet", confirmed: "Transaction confirmed",
    awaiting_approval: "Awaiting approval signature", approval_submitted: "Approval submitted",
    approval_confirmed: "Approval confirmed", preparing_sell: "Preparing sell", awaiting_sell_signature: "Awaiting sell signature",
    sell_submitted: "Sell submitted", sell_confirming: "Confirming sell on Arc Testnet", failed: "Transaction failed",
    rejected: "Wallet request rejected", expired: "Quote expired", confirmation_unknown: "Confirmation needs attention",
  } as const)[phase];
}
