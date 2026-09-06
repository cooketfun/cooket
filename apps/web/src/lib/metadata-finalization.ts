import { ApiClientError } from "@/lib/api";

export function metadataClaimMessage(chainId: number, draftId: string, tokenAddress: string, transactionHash: string) {
  return `Cooket metadata finalization\n\nChain ID: ${chainId}\nDraft ID: ${draftId}\nToken address: ${tokenAddress.toLowerCase()}\nCreation transaction: ${transactionHash.toLowerCase()}`;
}

export async function tryMetadataFinalization<T>(finalize: () => Promise<T>): Promise<T | undefined> {
  try {
    return await finalize();
  } catch (error) {
    if (error instanceof ApiClientError && error.code === "not_indexed") return undefined;
    throw error;
  }
}

export async function retryPendingMetadataFinalization<T>(
  finalize: () => Promise<T>,
  attempts: number,
  delay: () => Promise<void>,
): Promise<T | undefined> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await delay();
    const token = await tryMetadataFinalization(finalize);
    if (token) return token;
  }
  return undefined;
}
