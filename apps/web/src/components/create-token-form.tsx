"use client";

import Link from "next/link";
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import type { Address, Hash } from "viem";
import { canCreateToken, DevBuyFailure, idleTransaction, isHTTPSImageURL, parseDevBuyNativeUsdcAmount, validateCreateToken, type CreateTokenInput, type TransactionState } from "@/lib/transactions";
import { selectedCooketChainId, selectedCooketChainName } from "@/lib/chain";
import { TransactionModal } from "@/components/transaction-modal";
import { closedTransactionModal, transactionModalReducer, type TransactionModalPhase } from "@/lib/transaction-modal";

export type CreateResult = { tokenAddress: Address; hash: Hash; devBuyHash?: Hash };
export type CreateExecution = (input: CreateTokenInput, report: (state: TransactionState) => void) => Promise<CreateResult>;
type Props = { walletConnected: boolean; walletReady?: boolean; walletStatusMessage?: string; chainId: number | undefined; walletAddress: Address | undefined; walletMode?: "browser"; execute: CreateExecution; onSuccess: (address: Address) => void; onDevBuyChange?: (enabled: boolean) => void };

export function CreateTokenForm({ walletConnected, walletReady = true, walletStatusMessage, chainId, walletAddress, walletMode = "browser", execute, onSuccess, onDevBuyChange }: Props) {
  const [input, setInput] = useState<CreateTokenInput>({ name: "", symbol: "", description: "", websiteUrl: "", xUrl: "", telegramUrl: "", discordUrl: "", imageFile: null, imageUrl: "", imageSource: "file", devBuyNativeUsdc: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const [tx, setTx] = useState<TransactionState>(idleTransaction);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [devBuyFailure, setDevBuyFailure] = useState<DevBuyFailure | null>(null);
  const [modal, dispatchModal] = useReducer(transactionModalReducer, closedTransactionModal);
  const [preview, setPreview] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submissionRef = useRef(false);
  const pending = ["preparing", "awaiting_wallet", "submitted", "confirming", "dev_buy_preparing", "dev_buy_awaiting_wallet", "dev_buy_submitted", "dev_buy_confirming"].includes(tx.status);

  useEffect(() => {
    const phase = createModalPhase(tx.status);
    if (phase) dispatchModal({ type: "progress", phase });
  }, [tx.status]);

  useEffect(() => {
    if (input.imageSource === "file") {
      if (!input.imageFile) return;
      const reader = new FileReader();
      reader.onload = () => setPreview(typeof reader.result === "string" ? reader.result : "");
      reader.readAsDataURL(input.imageFile);
      return () => reader.abort();
    }
    const imageURL = input.imageUrl.trim();
    if (!imageURL) return;
    const image = new Image();
    image.onload = () => setErrors((current) => current.image === "Image URL could not be loaded." ? { ...current, image: "" } : current);
    image.onerror = () => setErrors((current) => ({ ...current, image: "Image URL could not be loaded." }));
    image.src = imageURL;
  }, [input.imageFile, input.imageSource, input.imageUrl]);

  const update = (key: keyof CreateTokenInput, value: string | File | null) => {
    setInput((current) => ({ ...current, [key]: value, ...(key === "imageFile" ? { imageUrl: "" } : key === "imageUrl" ? { imageFile: null } : {}) }));
    setErrors((current) => ({ ...current, [key]: "", ...(key === "imageFile" || key === "imageUrl" ? { image: "" } : {}) }));
    if (key === "imageFile" && !value) setPreview("");
    if (key === "imageUrl") setPreview(typeof value === "string" && isHTTPSImageURL(value.trim()) ? value.trim() : "");
    if (key === "devBuyNativeUsdc" && typeof value === "string") {
      try { onDevBuyChange?.(parseDevBuyNativeUsdcAmount(value) > BigInt(0)); } catch { onDevBuyChange?.(false); }
    }
  };
  const switchImageSource = (imageSource: CreateTokenInput["imageSource"]) => {
    setInput((current) => ({ ...current, imageSource, imageFile: imageSource === "file" ? current.imageFile : null, imageUrl: imageSource === "url" ? current.imageUrl : "" }));
    if (imageSource === "url" && fileInputRef.current) fileInputRef.current.value = "";
    setPreview("");
    setErrors((current) => ({ ...current, image: "", imageFile: "", imageUrl: "" }));
  };
  const openReview = () => { const next = validateCreateToken(input); setErrors(next); if (Object.keys(next).length === 0) setReview(true); };
  const submit = async () => {
    if (submissionRef.current) return;
    const next = validateCreateToken(input);
    if (Object.keys(next).length) { setErrors(next); setReview(false); return; }
    if (!canCreateToken(chainId, walletConnected && walletReady, false)) { setErrors({ network: walletStatusMessage || `Connect the ${walletMode} wallet on ${selectedCooketChainName} before submitting.` }); return; }
    submissionRef.current = true;
    setErrors({});
    setResult(null);
    setDevBuyFailure(null);
    try {
      const created = await execute(input, setTx);
      setResult(created);
      setTx({ status: "confirmed", hash: created.hash });
      onSuccess(created.tokenAddress);
    } catch (error) {
      if (error instanceof DevBuyFailure) {
        setResult({ tokenAddress: error.tokenAddress, hash: error.creationHash, devBuyHash: error.buyHash });
        setDevBuyFailure(error);
        setTx({ status: error.rejected ? "dev_buy_rejected" : error.retryable ? "dev_buy_failed" : "dev_buy_confirming", hash: error.buyHash ?? error.creationHash, error: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : "Token creation failed.";
      setTx((current) => ({ status: /reject|denied/i.test(message) ? "rejected" : "failed", hash: current.hash, error: message }));
    } finally { submissionRef.current = false; }
  };
  const retryDevBuy = async () => {
    if (!devBuyFailure || submissionRef.current) return;
    submissionRef.current = true;
    setTx({ status: "dev_buy_preparing", hash: devBuyFailure.creationHash });
    try {
      const devBuyHash = await devBuyFailure.retryDevBuy(setTx);
      setResult((current) => current ? { ...current, devBuyHash } : current);
      setDevBuyFailure(null);
      setTx({ status: "dev_buy_confirmed", hash: devBuyHash });
      onSuccess(devBuyFailure.tokenAddress);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Dev buy could not be completed.";
      setTx((current) => ({ status: /reject|denied/i.test(message) ? "dev_buy_rejected" : "dev_buy_failed", hash: current.hash, error: message }));
    } finally { submissionRef.current = false; }
  };

  return <section className="panel mt-6 max-w-3xl md:mt-8" aria-label="Create token form">
    <div className="mb-5 flex items-start justify-between gap-3 border-b border-white/8 pb-4 md:mb-6 md:pb-5"><div><h2 className="text-lg font-semibold text-white">{review ? "Review your launch" : "Token details"}</h2><p className="mt-1 text-sm text-zinc-500">{review ? "These metadata details will define the launch." : "Give people enough context to recognize and understand the token."}</p></div><span className="badge-violet">{review ? "Step 2 of 2" : "Step 1 of 2"}</span></div>
    {!walletConnected && <p className="status-box status-warning mb-5">Connect an external wallet to create a token.</p>}
    {walletConnected && chainId !== selectedCooketChainId && <p className="status-box status-warning mb-5">Wrong network. Use {selectedCooketChainName} ({selectedCooketChainId}).</p>}
    {walletConnected && chainId === selectedCooketChainId && !walletReady && <p className="status-box status-warning mb-5">{walletStatusMessage || "Preparing the active wallet…"}</p>}
    {walletAddress && <div className="mb-5 rounded-xl border border-white/8 bg-black/15 px-3 py-2"><p className="text-xs text-zinc-500">Active transaction signer</p><p className="address mt-1 hidden sm:block">{walletAddress}</p><p className="address mt-1 truncate sm:hidden" title={walletAddress}>{`${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`}</p></div>}
    {errors.network && <p className="status-box status-error mb-4" role="alert">{errors.network}</p>}
    {!review ? <div className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Token name" hint="Up to 64 characters." error={errors.name}><input aria-label="Name" aria-invalid={Boolean(errors.name)} value={input.name} disabled={pending} onChange={(event) => update("name", event.target.value)} maxLength={64} placeholder="e.g. Cooket Community" /></Field>
        <Field label="Symbol" hint="Shown in uppercase, up to 16 characters." error={errors.symbol}><input aria-label="Symbol" aria-invalid={Boolean(errors.symbol)} value={input.symbol} disabled={pending} onChange={(event) => update("symbol", event.target.value.toUpperCase())} maxLength={16} placeholder="e.g. COOKET" /></Field>
      </div>
      <Field label="About (optional)" hint={`${input.description.length}/1000 characters. Explain the idea clearly; this appears on the public token page.`} error={errors.description}><textarea aria-label="About" aria-invalid={Boolean(errors.description)} value={input.description} disabled={pending} onChange={(event) => update("description", event.target.value)} maxLength={1000} placeholder="What is this token and who is it for?" /></Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Website URL (optional)" error={errors.websiteUrl}><input aria-label="Website URL" aria-invalid={Boolean(errors.websiteUrl)} type="url" value={input.websiteUrl} disabled={pending} onChange={(event) => update("websiteUrl", event.target.value)} placeholder="https://example.com" /></Field>
        <Field label="X / Twitter URL (optional)" error={errors.xUrl}><input aria-label="X / Twitter URL" aria-invalid={Boolean(errors.xUrl)} type="url" value={input.xUrl} disabled={pending} onChange={(event) => update("xUrl", event.target.value)} placeholder="https://x.com/project" /></Field>
        <Field label="Telegram URL (optional)" error={errors.telegramUrl}><input aria-label="Telegram URL" aria-invalid={Boolean(errors.telegramUrl)} type="url" value={input.telegramUrl} disabled={pending} onChange={(event) => update("telegramUrl", event.target.value)} placeholder="https://t.me/project" /></Field>
        <Field label="Discord URL (optional)" error={errors.discordUrl}><input aria-label="Discord URL" aria-invalid={Boolean(errors.discordUrl)} type="url" value={input.discordUrl} disabled={pending} onChange={(event) => update("discordUrl", event.target.value)} placeholder="https://discord.gg/invite" /></Field>
      </div>
      <Field label="Token image" hint={input.imageSource === "file" ? "PNG, JPEG, WebP, or GIF. This becomes the public token identity." : "Use an HTTPS image URL. Cooket stores a durable copy when you launch."} error={errors.image}><div className="flex rounded-xl border border-white/8 bg-black/20 p-1" role="group" aria-label="Token image source"><button aria-label="Upload file" type="button" className={`min-h-10 flex-1 rounded-lg px-3 text-sm font-semibold ${input.imageSource === "file" ? "bg-white/10 text-white" : "text-zinc-500"}`} aria-pressed={input.imageSource === "file"} disabled={pending} onClick={() => switchImageSource("file")}>Upload file</button><button aria-label="Image URL" type="button" className={`min-h-10 flex-1 rounded-lg px-3 text-sm font-semibold ${input.imageSource === "url" ? "bg-cyan-300/10 text-cyan-200" : "text-zinc-500"}`} aria-pressed={input.imageSource === "url"} disabled={pending} onClick={() => switchImageSource("url")}>Image URL</button></div>{input.imageSource === "file" ? <input key="image-file" ref={fileInputRef} aria-label="Image file" aria-invalid={Boolean(errors.image)} type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={pending} onChange={(event) => update("imageFile", event.target.files?.[0] ?? null)} /> : <input key="image-url" aria-label="Image URL" aria-invalid={Boolean(errors.image)} type="url" inputMode="url" value={input.imageUrl ?? ""} disabled={pending} onChange={(event) => update("imageUrl", event.target.value)} placeholder="https://example.com/token.png" />}</Field>
      {preview && <div className="flex items-center gap-4 rounded-xl border border-white/8 bg-black/15 p-3"><div role="img" aria-label="Token image preview" className="h-20 w-20 flex-none rounded-xl border border-white/10 bg-cover bg-center" style={{ backgroundImage: `url(${preview})` }} /><div><p className="text-sm font-medium text-white">Image preview</p><p className="mt-1 break-all text-xs text-zinc-500">{input.imageSource === "file" ? input.imageFile?.name : input.imageUrl}</p></div></div>}
      <Field label="Optional Dev buy" hint="Uses Arc native USDC. Token creation and an optional Dev buy require two wallet confirmations; your token remains created if the optional buy fails." error={errors.devBuyNativeUsdc}><div className="relative"><input aria-label="Dev buy" inputMode="decimal" value={input.devBuyNativeUsdc} disabled={pending} onChange={(event) => update("devBuyNativeUsdc", event.target.value)} placeholder="0.0" /><span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-500">native USDC</span></div></Field>
      <button className="button-primary w-full md:w-fit" type="button" disabled={pending} onClick={openReview}>Review metadata</button>
    </div> : <div className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-[8rem_minmax(0,1fr)]">{preview && <div role="img" aria-label="Token image preview" className="aspect-square w-full max-w-32 rounded-2xl border border-white/10 bg-cover bg-center" style={{ backgroundImage: `url(${preview})` }} />}<dl className="grid min-w-0 gap-3 text-sm"><Summary label="Name" value={input.name} /><Summary label="Symbol" value={input.symbol} /><Summary label="About" value={input.description || "Not provided"} /><Summary label="Website" value={input.websiteUrl || "Not provided"} /><Summary label="X / Twitter" value={input.xUrl || "Not provided"} /><Summary label="Community" value={[input.telegramUrl, input.discordUrl].filter(Boolean).join(" · ") || "Not provided"} /><Summary label="Image" value={input.imageSource === "file" ? input.imageFile?.name || "Selected file" : input.imageUrl} />{parseDevBuyNativeUsdcAmount(input.devBuyNativeUsdc) > BigInt(0) && <Summary label="Dev buy" value={`${input.devBuyNativeUsdc.trim()} native USDC`} />}</dl></div>
      <p className="text-sm leading-6 text-zinc-400">Submitting uploads the metadata draft, asks your active wallet to create the token, then waits for confirmation and indexing. {hasDevBuy(input.devBuyNativeUsdc) ? "The optional Arc native USDC Dev buy is a separate second wallet confirmation; the token remains created if that buy fails." : "Only "}{!hasDevBuy(input.devBuyNativeUsdc) && `${selectedCooketChainName} network gas is required for the nonpayable factory transaction.`}</p>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button className="button-secondary min-h-11" disabled={pending} onClick={() => setReview(false)}>Edit</button><button className="button-primary min-h-11 w-full sm:w-auto" disabled={pending || !canCreateToken(chainId, walletConnected && walletReady, pending)} onClick={() => dispatchModal({ type: "review" })}>{pending ? "Creation pending…" : "Confirm factory transaction"}</button></div>
    </div>}
    {result && <div className="status-box status-success mt-5">Token created successfully. <Link className="font-semibold underline" href={`/token/${result.tokenAddress}`}>Open token</Link>{devBuyFailure && <>{devBuyFailure.retryable && <button className="button-secondary ml-3" type="button" disabled={pending} onClick={() => void retryDevBuy()}>Retry dev buy</button>}<p className="mt-2 text-sm text-zinc-300">Your token exists even though the Dev buy did not complete.</p></>}</div>}
    <TransactionModal open={modal.open} title={tx.status.startsWith("dev_buy") ? `Buy ${input.symbol || "token"}` : "Create token"} phase={modal.phase} statusLabel={createStatusLabel(tx.status)} wallet={walletAddress} hash={tx.hash} error={tx.error} onClose={() => dispatchModal({ type: "close" })} onConfirm={() => void submit()} confirmLabel="Confirm in wallet" confirmDisabled={!walletReady} details={[
      { label: "Token", value: `${input.name} (${input.symbol})` },
      { label: "Factory value", value: "0 native USDC · gas only" },
      ...(hasDevBuy(input.devBuyNativeUsdc) ? [{ label: "Optional Dev buy", value: `${input.devBuyNativeUsdc.trim()} native USDC` }] : []),
    ]} />
  </section>;
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) { return <label className="grid gap-2 text-sm text-zinc-300"><span className="font-medium text-zinc-200">{label}</span>{children}<span className={error ? "text-red-300" : "text-xs leading-5 text-zinc-500"} role={error ? "alert" : undefined}>{error || hint}</span></label>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-1 break-words font-medium text-zinc-100">{value}</dd></div>; }
function createModalPhase(status: TransactionState["status"]): TransactionModalPhase | undefined {
  return ({ idle: undefined, preparing: "preparing", awaiting_wallet: "awaiting_wallet", submitted: "submitted", confirming: "confirming", confirmed: "confirmed", failed: "failed", rejected: "rejected", dev_buy_preparing: "preparing", dev_buy_awaiting_wallet: "awaiting_wallet", dev_buy_submitted: "submitted", dev_buy_confirming: "confirming", dev_buy_confirmed: "confirmed", dev_buy_failed: "failed", dev_buy_rejected: "rejected" } as const)[status];
}
function createStatusLabel(status: TransactionState["status"]) { return ({ preparing: "Preparing metadata and factory transaction…", awaiting_wallet: "Confirm the transaction in your connected wallet to create the token…", submitted: "Creation transaction submitted.", confirming: `Waiting for ${selectedCooketChainName} creation confirmation and indexing…`, confirmed: "Token creation confirmed.", failed: "Token creation failed.", rejected: "Transaction rejected. Token creation was not completed.", dev_buy_preparing: "Token created. Preparing a fresh protected Dev buy quote…", dev_buy_awaiting_wallet: "Token created. Confirm the Dev buy in your connected wallet…", dev_buy_submitted: "Dev buy transaction submitted.", dev_buy_confirming: "Waiting for Dev buy confirmation…", dev_buy_confirmed: "Dev buy confirmed.", dev_buy_failed: "Token created, but Dev buy failed.", dev_buy_rejected: "Token created, but Dev buy was rejected.", idle: "Review transaction" })[status]; }
function hasDevBuy(value: string) { try { return parseDevBuyNativeUsdcAmount(value) > BigInt(0); } catch { return false; } }
