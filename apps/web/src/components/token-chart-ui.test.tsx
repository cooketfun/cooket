import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChartInterval, ChartPage } from "@cooket/types";
import { api } from "@/lib/api";
import { TIMEFRAMES, TokenChart } from "./token-chart";

const token = "0x0000000000000000000000000000000000000011";
const supported: ChartInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderChart(initialSupply?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><TokenChart tokenAddress={token} initialSupply={initialSupply} /></QueryClientProvider>);
}

function emptyPage(interval: ChartInterval): ChartPage {
  return { interval, supported_intervals: supported, candles: [] };
}

describe("TokenChart terminal controls", () => {
  it("requests only supported canonical timeframes through a compact selector", async () => {
    const chart = vi.spyOn(api, "chart").mockImplementation(async (_address, query = "") => {
      const interval = new URLSearchParams(query.slice(1)).get("interval") as ChartInterval;
      return emptyPage(interval);
    });
    const user = userEvent.setup();
    renderChart();

    await waitFor(() => expect(chart).toHaveBeenCalledWith(token, "?interval=5m&limit=500"));
    const selector = screen.getByRole("combobox", { name: "Chart timeframe" }) as HTMLSelectElement;
    expect(Array.from(selector.options).map(({ value }) => value)).toEqual(TIMEFRAMES);
    expect(Array.from(selector.options).some(({ value }) => value === "1s")).toBe(false);
    for (const interval of supported) {
      await user.selectOptions(selector, interval);
      await waitFor(() => expect(chart).toHaveBeenCalledWith(token, `?interval=${interval}&limit=500`));
      expect(selector.value).toBe(interval);
    }
  });

  it("keeps selectors usable while loading and disables FDV without initial supply", () => {
    vi.spyOn(api, "chart").mockReturnValue(new Promise<ChartPage>(() => undefined));
    renderChart();

    expect(screen.getByText("Loading canonical 5m candles and volume…")).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Chart timeframe" }) as HTMLSelectElement).disabled).toBe(false);
    const metric = screen.getByRole("combobox", { name: "Chart metric" }) as HTMLSelectElement;
    expect(metric.value).toBe("price");
    expect(Array.from(metric.options).find(({ value }) => value === "fdv")?.disabled).toBe(true);
  });

  it("keeps Price as default and enables FDV when initial supply is available", async () => {
    vi.spyOn(api, "chart").mockResolvedValue(emptyPage("1h"));
    const user = userEvent.setup();
    renderChart("1000000000000000000000000000");
    const metric = screen.getByRole("combobox", { name: "Chart metric" }) as HTMLSelectElement;
    expect(metric.value).toBe("price");
    expect(Array.from(metric.options).find(({ value }) => value === "fdv")?.disabled).toBe(false);
    await user.selectOptions(metric, "fdv");
    expect(metric.value).toBe("fdv");
  });
});
