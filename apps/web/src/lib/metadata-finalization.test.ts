import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./api";
import { metadataClaimMessage, retryPendingMetadataFinalization, tryMetadataFinalization } from "./metadata-finalization";

describe("durable metadata finalization UX", () => {
  it("binds the wallet signature message to chain, draft, token, and transaction", () => {
    expect(metadataClaimMessage(5042002, "draft-a", "0xABCD", "0xEF01")).toBe("Cooket metadata finalization\n\nChain ID: 5042002\nDraft ID: draft-a\nToken address: 0xabcd\nCreation transaction: 0xef01");
  });

  it("treats a server-linked not-indexed response as pending success", async () => {
    const finalize = vi.fn().mockRejectedValue(new ApiClientError(409, "not_indexed", "durably pending"));
    await expect(tryMetadataFinalization(finalize)).resolves.toBeUndefined();
    expect(finalize).toHaveBeenCalledOnce();
  });

  it("can exhaust the browser retry window without failing confirmed creation", async () => {
    const finalize = vi.fn().mockRejectedValue(new ApiClientError(409, "not_indexed", "durably pending"));
    const delay = vi.fn().mockResolvedValue(undefined);
    await expect(retryPendingMetadataFinalization(finalize, 3, delay)).resolves.toBeUndefined();
    expect(finalize).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(3);
  });

  it("returns a later canonical token and does not retry identity failures", async () => {
    const canonical = { address: "0x0000000000000000000000000000000000000011" };
    const finalize = vi.fn()
      .mockRejectedValueOnce(new ApiClientError(409, "not_indexed", "durably pending"))
      .mockResolvedValueOnce(canonical);
    await expect(retryPendingMetadataFinalization(finalize, 3, async () => undefined)).resolves.toBe(canonical);
    expect(finalize).toHaveBeenCalledTimes(2);

    const mismatch = vi.fn().mockRejectedValue(new ApiClientError(409, "metadata_mismatch", "wrong identity"));
    await expect(tryMetadataFinalization(mismatch)).rejects.toThrow("wrong identity");
    expect(mismatch).toHaveBeenCalledOnce();
  });
});
