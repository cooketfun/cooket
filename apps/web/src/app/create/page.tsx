"use client";

import { FIXED_TOKEN_SUPPLY } from "@cooket/contracts-sdk";
import { useRouter } from "next/navigation";
import { getAddress, type Address } from "viem";
import { CreateTokenForm, type CreateExecution } from "@/components/create-token-form";
import { api, ApiClientError } from "@/lib/api";
import { confirmCreatedToken, configuredCurveInitialization, submitCreateToken } from "@/lib/contracts";
import { executeDevBuy, DevBuyAttemptError } from "@/lib/dev-buy";
import { DevBuyFailure, parseDevBuyAmount, type TransactionState } from "@/lib/transactions";
import { activeWalletStatusMessage, useActiveWallet } from "@/providers/active-wallet-provider";
import { useState } from "react";
import { selectedCooketChainId, selectedCooketChainName } from "@/lib/chain";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function CreatePage() {
  return <BrowserWalletCreatePage />;
}

function BrowserWalletCreatePage() {
  const { connected, canTransact, status, activeAddress, activeChainId: chainId, walletClient } = useActiveWallet();
  const router = useRouter();
  const creator = activeAddress;
  const [hasDevBuy, setHasDevBuy] = useState(false);

  const performDevBuy = async (tokenAddress: Address, creatorAddress: Address, amount: bigint, creationHash: `0x${string}`, report: (state: TransactionState) => void) => {
    if (!walletClient) throw new Error("The connected browser wallet is unavailable.");
    return executeDevBuy({ tokenAddress, creatorAddress, amount, creationHash, walletClient, report });
  };

  const execute: CreateExecution = async (input, report) => {
    if (chainId !== selectedCooketChainId) throw new Error(`Switch the connected wallet to ${selectedCooketChainName} before creating a token.`);
    if (!creator || !walletClient) throw new Error("Connect a browser wallet before creating a token.");
    const config = configuredCurveInitialization();
    const creatorAddress = getAddress(creator);
    const form = new FormData();
    form.set("name", input.name.trim());
    form.set("symbol", input.symbol.trim());
    form.set("description", input.description.trim());
    form.set("website_url", input.websiteUrl.trim());
    form.set("x_url", input.xUrl.trim());
    form.set("telegram_url", input.telegramUrl.trim());
    form.set("discord_url", input.discordUrl.trim());
    form.set("initial_supply", FIXED_TOKEN_SUPPLY.toString());
    if (input.imageSource === "file") form.set("image", input.imageFile!);
    else form.set("image_url", input.imageUrl.trim());
    report({ status: "preparing" });
    const draft = await api.uploadMetadata(form);
    report({ status: "awaiting_wallet" });
    const hash = await submitCreateToken(walletClient, creatorAddress, input.name.trim(), input.symbol.trim(), config.userSalt);
    report({ status: "submitted", hash });
    report({ status: "confirming", hash });
    const { created } = await confirmCreatedToken(hash);
    if (getAddress(created.creator) !== creatorAddress) throw new Error("Confirmed creator does not match the connected wallet.");
    let token;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { token = await api.finalizeMetadata(draft.draft_id, created.token, hash); break; }
      catch (error) { if (!(error instanceof ApiClientError) || error.code !== "not_indexed") throw error; await pause(2000); }
    }
    if (!token) throw new Error("The transaction confirmed, but indexing did not finish in time.");
    const tokenAddress = getAddress(created.token);
    const devBuyAmount = parseDevBuyAmount(input.devBuyEth);
    if (devBuyAmount === BigInt(0)) return { tokenAddress, hash };
    const retryDevBuy = (retryReport: (state: TransactionState) => void) => performDevBuy(tokenAddress, creatorAddress, devBuyAmount, hash, retryReport);
    try {
      const devBuyHash = await retryDevBuy(report);
      return { tokenAddress, hash, devBuyHash };
    } catch (error) {
      if (error instanceof DevBuyAttemptError) {
        throw new DevBuyFailure(`Token created successfully, but the Dev buy ${error.rejected ? "was rejected" : error.retryable ? "could not be completed" : "needs confirmation"}.`, tokenAddress, hash, retryDevBuy, error.retryable, error.buyHash, error.rejected);
      }
      throw error;
    }
  };

  return <main className="container page-shell flex-1">
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8">
      <div className="min-w-0">
        <p className="eyebrow">Token launch</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">Create your token</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 sm:mt-4 sm:text-base sm:leading-7">Publish its identity, then confirm your {selectedCooketChainName} launch transaction{hasDevBuy ? " and optional initial buy" : ""}.</p>
        <details className="panel mt-5 lg:hidden">
          <summary className="min-h-11 cursor-pointer text-sm font-semibold text-white">What happens</summary>
          <LaunchOverview hasDevBuy={hasDevBuy} compact />
        </details>
        <CreateTokenForm walletConnected={connected} walletReady={canTransact} walletStatusMessage={activeWalletStatusMessage(status)} chainId={chainId} walletAddress={creator as Address | undefined} walletMode="browser" execute={execute} onSuccess={(address) => router.push(`/token/${address}`)} onDevBuyChange={setHasDevBuy} />
      </div>
      <aside className="panel hidden lg:sticky lg:top-24 lg:block" aria-label="Launch overview">
        <p className="eyebrow">What happens</p>
        <LaunchOverview hasDevBuy={hasDevBuy} />
      </aside>
    </div>
  </main>;
}

function LaunchOverview({ hasDevBuy, compact = false }: { hasDevBuy: boolean; compact?: boolean }) {
  return <>
    <ol className={compact ? "mt-4 grid gap-3" : "mt-5 grid gap-5"}>
      <LaunchStep number="1" title="Metadata" copy="Your image and description are uploaded as a draft." />
      <LaunchStep number="2" title="Factory transaction" copy="Your wallet creates the token and its bonding curve atomically." />
      {hasDevBuy && <LaunchStep number="3" title="Initial buy" copy="A separate browser-wallet confirmation buys from the bonding curve." />}
      <LaunchStep number={hasDevBuy ? "4" : "3"} title={hasDevBuy ? "Complete" : "Confirmation"} copy={`After ${selectedCooketChainName} confirms and the indexer catches up, your token page opens.`} />
    </ol>
    <div className={`${compact ? "mt-4" : "mt-6"} border-t border-white/8 pt-4 text-sm leading-6 text-zinc-400`}>
      <p><span className="font-medium text-zinc-200">Cost:</span> network gas{hasDevBuy ? " plus your optional Dev buy amount; each transaction is confirmed separately" : " only"}.</p>
    </div>
  </>;
}

function LaunchStep({ number, title, copy }: { number: string; title: string; copy: string }) {
  return <li className="flex gap-3"><span className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/8 font-mono text-xs text-cyan-200">{number}</span><div><p className="text-sm font-semibold text-white">{title}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{copy}</p></div></li>;
}
