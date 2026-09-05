import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { ChartPage } from "@cooket/types";
import { api } from "@/lib/api";
import { TokenChart } from "./token-chart";

const mock = vi.hoisted(() => {
  const price = { setData: vi.fn(), priceScale: () => ({ applyOptions: vi.fn() }) };
  const scale = { scrollToRealTime: vi.fn(), setVisibleLogicalRange: vi.fn(), subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn() };
  const chart = { addSeries: () => price, panes: () => [], timeScale: () => scale, subscribeCrosshairMove: vi.fn(), applyOptions: vi.fn(), remove: vi.fn() };
  return { price, scale, chart, create: vi.fn(() => chart) };
});
vi.mock("lightweight-charts", () => ({ createChart: mock.create, CandlestickSeries: {}, HistogramSeries: {}, ColorType: { Solid: "solid" }, CrosshairMode: { Normal: 0 }, LineStyle: { Dashed: 2 } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("keeps the chart and historical pan across same-bucket refreshes and rollovers", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const point = (time: number) => ({ bucket_start: time, open_price: "12000000000000", high_price: "12300000000000", low_price: "12000000000000", close_price: "12200000000000", volume: "1000000000000000000", trade_count: 1, buy_count: 1, sell_count: 0, unique_trader_count: 1 });
  const page: ChartPage = { interval: "5m", supported_intervals: ["5m"], indexed_through_block: 20, candles: [point(300)] };
  vi.spyOn(api, "chart").mockResolvedValue(page);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rendered = render(<QueryClientProvider client={client}><TokenChart tokenAddress="0xtoken" symbol="COOK" /></QueryClientProvider>);
  await waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
  const observe = mock.scale.subscribeVisibleLogicalRangeChange.mock.calls[0][0] as unknown as (range: { from: number; to: number }) => void;
  act(() => { observe({ from: -40, to: -10 }); client.setQueryData(["token-chart", "0xtoken", "5m"], { ...page, candles: [point(300), point(600)] }); });
  expect(mock.create).toHaveBeenCalledOnce();
  expect(mock.scale.scrollToRealTime).not.toHaveBeenCalled();
  expect(mock.scale.setVisibleLogicalRange).toHaveBeenCalledOnce();
  act(() => observe({ from: -10, to: 5 }));
  await act(async () => { client.setQueryData(["token-chart", "0xtoken", "5m"], { ...page, candles: [point(300), point(600), point(900)] }); });
  await waitFor(() => expect(mock.scale.scrollToRealTime).toHaveBeenCalledOnce());
  await act(async () => { client.setQueryData(["token-chart", "0xtoken", "5m"], { ...page, indexed_through_block: 21, candles: [point(300), point(600), point(900)] }); });
  expect(mock.scale.scrollToRealTime).toHaveBeenCalledOnce();
  expect(mock.create).toHaveBeenCalledOnce();
  rendered.unmount(); expect(mock.chart.remove).toHaveBeenCalledOnce();
  expect(mock.scale.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledOnce();
});
