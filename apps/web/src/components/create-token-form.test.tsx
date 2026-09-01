import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { CreateTokenForm, type CreateExecution } from "./create-token-form";

const token = "0x0000000000000000000000000000000000000011" as const;
const hash = `0x${"ab".repeat(32)}` as const;
const wallet = "0x0000000000000000000000000000000000000022" as const;
const image = () => new File([new Uint8Array([1, 2, 3])], "token.png", { type: "image/png" });

afterEach(cleanup);

async function completeForm(user: ReturnType<typeof userEvent.setup>, file = image()) {
  await user.type(screen.getByLabelText("Name"), "Cooket");
  await user.type(screen.getByLabelText("Symbol"), "ZK");
  await user.type(screen.getByLabelText("About"), "A test token");
  await user.upload(screen.getByLabelText("Image file"), file);
}

function renderForm(overrides: Partial<ComponentProps<typeof CreateTokenForm>> = {}) {
  const execute = vi.fn<CreateExecution>().mockResolvedValue({ tokenAddress: token, hash });
  const onSuccess = vi.fn();
  render(<CreateTokenForm walletConnected chainId={5042002} walletAddress={wallet} execute={execute} onSuccess={onSuccess} {...overrides} />);
  return { execute, onSuccess };
}

describe("CreateTokenForm", () => {
  it("keeps the form focused on editable metadata and omits supply presentation", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.queryByText("Permanent supply settings")).toBeNull();
    expect(screen.queryByText("Fixed supply")).toBeNull();
    expect(screen.queryByText("Creator allocation")).toBeNull();
    expect(screen.queryByText("Curve inventory")).toBeNull();
    expect(screen.queryByText("Full allocation")).toBeNull();
    expect(screen.queryByText("1,000,000,000")).toBeNull();
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("Symbol")).toBeTruthy();
    expect(screen.getByLabelText("About")).toBeTruthy();
    expect(screen.getByLabelText("Website URL")).toBeTruthy();
    expect(screen.getByLabelText("X / Twitter URL")).toBeTruthy();
    expect(screen.getByLabelText("Telegram URL")).toBeTruthy();
    expect(screen.getByLabelText("Discord URL")).toBeTruthy();
    expect((screen.getByLabelText("Image file") as HTMLInputElement).type).toBe("file");

    await completeForm(user);
    await user.click(screen.getByRole("button", { name: "Review metadata" }));

    expect(screen.queryByText("Permanent supply settings")).toBeNull();
    expect(screen.queryByText("Fixed supply")).toBeNull();
    expect(screen.queryByText("Creator allocation")).toBeNull();
    expect(screen.queryByText("Curve inventory")).toBeNull();
    expect(screen.queryByText("Full allocation")).toBeNull();
    expect(screen.queryByText("Initial purchase")).toBeNull();
    expect(screen.queryByText("1,000,000,000")).toBeNull();
    expect(screen.getByText("Cooket")).toBeTruthy();
    expect(screen.getByText("ZK")).toBeTruthy();
  });

  it("rejects invalid metadata and unsupported images", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { execute } = renderForm();
    await user.click(screen.getByRole("button", { name: "Review metadata" }));
    expect(screen.getByText(/Name must be/)).toBeTruthy();
    await completeForm(user, new File(["text"], "bad.txt", { type: "text/plain" }));
    await user.click(screen.getByRole("button", { name: "Review metadata" }));
    expect(screen.getByText(/Use PNG/)).toBeTruthy();
    expect(execute).not.toHaveBeenCalled();
  });

  it("supports one image source at a time and submits HTTPS image URLs", async () => {
    const user = userEvent.setup();
    const { execute } = renderForm();
    await user.click(screen.getByRole("button", { name: "Image URL" }));
    expect(screen.queryByLabelText("Image file")).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "Image URL" }), "http://example.com/token.png");
    await user.click(screen.getByRole("button", { name: "Review metadata" }));
    expect(screen.getByText("Image URL must use HTTPS.")).toBeTruthy();
    await user.clear(screen.getByRole("textbox", { name: "Image URL" }));
    await user.type(screen.getByLabelText("Name"), "Cooket");
    await user.type(screen.getByLabelText("Symbol"), "ZK");
    await user.type(screen.getByRole("textbox", { name: "Image URL" }), "https://example.com/token.png");
    expect((screen.getByRole("textbox", { name: "Image URL" }) as HTMLInputElement).value).toBe("https://example.com/token.png");
    await user.click(screen.getByRole("button", { name: "Upload file" }));
    expect(screen.queryByRole("textbox", { name: "Image URL" })).toBeNull();
    await user.upload(screen.getByLabelText("Image file"), image());
    expect((screen.getByLabelText("Image file") as HTMLInputElement).files).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Review metadata" }));
    await user.click(screen.getByRole("button", { name: "Confirm factory transaction" }));
    await user.click(screen.getByRole("button", { name: "Confirm in wallet" }));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ imageSource: "file", imageFile: expect.any(File), imageUrl: "" }), expect.any(Function));
  });

  it("rejects oversized images", async () => {
    const user = userEvent.setup();
    renderForm();
    await completeForm(user, new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "Review metadata" }));
    expect(screen.getByText(/at most 5 MB/)).toBeTruthy();
  });

  it("validates optional social URLs", async () => {
    const user = userEvent.setup();
    renderForm();
    await completeForm(user);
    await user.type(screen.getByLabelText("X / Twitter URL"), "https://example.com/not-x");
    await user.click(screen.getByRole("button", { name: "Review metadata" }));
    expect(screen.getByText(/X\/Twitter must be/)).toBeTruthy();
  });

  it("blocks creation on the wrong chain", async () => {
    const user = userEvent.setup();
    const { execute } = renderForm({ chainId: 1 });
    await completeForm(user);
    await user.click(screen.getByRole("button", { name: "Review metadata" }));
    expect(screen.getByText(/Wrong network/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm factory transaction" }) as HTMLButtonElement).disabled).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it("renders submission state, confirms, and navigates", async () => {
    const user = userEvent.setup();
    let finish: ((value: { tokenAddress: typeof token; hash: typeof hash }) => void) | undefined;
    const execute = vi.fn<CreateExecution>((_input, report) => {
      report({ status: "awaiting_wallet" });
      return new Promise((resolve) => { finish = resolve; });
    });
    const onSuccess = vi.fn();
    renderForm({ execute, onSuccess });
    await completeForm(user);
    await user.click(screen.getByRole("button", { name: "Review metadata" }));
    await user.click(screen.getByRole("button", { name: "Confirm factory transaction" }));
    await user.click(screen.getByRole("button", { name: "Confirm in wallet" }));
    expect(await screen.findByText(/Confirm the transaction in your connected wallet/)).toBeTruthy();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].devBuyEth).toBe("");
    finish?.({ tokenAddress: token, hash });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(token));
    expect(screen.getByText(/Token creation confirmed/)).toBeTruthy();
  });

  it("rejects a Dev buy before review instead of applying the Base graduation limit", async () => {
    const user = userEvent.setup();
    const execute = vi.fn<CreateExecution>();
    renderForm({ execute });
    await completeForm(user);
    await user.type(screen.getByLabelText("Dev buy"), "0.10");
    await user.click(screen.getByRole("button", { name: "Review metadata" }));
    expect(screen.getByText(/Dev buy is disabled until Arc native-USDC curve economics are approved/)).toBeTruthy();
    expect(execute).not.toHaveBeenCalled();
  });

  it("shows a rejected transaction failure", async () => {
    const user = userEvent.setup();
    renderForm({ execute: vi.fn<CreateExecution>().mockRejectedValue(new Error("User rejected the request")) });
    await completeForm(user);
    await user.click(screen.getByRole("button", { name: "Review metadata" }));
    await user.click(screen.getByRole("button", { name: "Confirm factory transaction" }));
    await user.click(screen.getByRole("button", { name: "Confirm in wallet" }));
    expect(await screen.findByText(/Transaction rejected\./)).toBeTruthy();
    expect(screen.getByText("User rejected the request")).toBeTruthy();
  });

  it("prevents duplicate submission while pending", async () => {
    const user = userEvent.setup();
    const execute = vi.fn<CreateExecution>((_input, report) => {
      report({ status: "preparing" });
      return new Promise(() => undefined);
    });
    renderForm({ execute });
    await completeForm(user);
    await user.click(screen.getByRole("button", { name: "Review metadata" }));
    const submit = screen.getByRole("button", { name: "Confirm factory transaction" });
    await user.dblClick(submit);
    await user.dblClick(screen.getByRole("button", { name: "Confirm in wallet" }));
    expect(execute).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: /Creation pending/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
