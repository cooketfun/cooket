import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/app/token/[address]/page.tsx"), "utf8");
const graduation = readFileSync(resolve(process.cwd(), "src/components/token-graduation.tsx"), "utf8");
const trading = readFileSync(resolve(process.cwd(), "src/components/token-trading.tsx"), "utf8");
const activity = readFileSync(resolve(process.cwd(), "src/components/token-activity.tsx"), "utf8");

describe("token terminal responsive layout", () => {
  it("stacks without horizontal overflow in the required mobile order", () => {
    expect(css).toContain(".token-terminal-layout, .token-terminal-main, .token-terminal-primary, .token-terminal-sidebar, .token-terminal-support, .token-terminal-history { width: 100%; min-width: 0; max-width: 100%; }");
    expect(css).toContain('grid-template-areas: "primary" "sidebar" "support"');
    expect(page.indexOf('className="terminal-chart"')).toBeLessThan(page.indexOf('className="terminal-trade"'));
    expect(page.indexOf('className="terminal-trade"')).toBeLessThan(page.indexOf('className="terminal-market"'));
    expect(page.indexOf('className="terminal-market"')).toBeLessThan(page.indexOf('className="terminal-graduation"'));
    expect(page.indexOf('className="terminal-graduation"')).toBeLessThan(page.indexOf('className="terminal-cto"'));
    expect(page.indexOf('className="terminal-cto"')).toBeLessThan(page.indexOf('className="token-terminal-history"'));
  });

  it("uses a token-specific wide container and a chart-dominant desktop grid", () => {
    expect(css).toContain(".token-terminal-container { width: min(calc(100% - 2rem), 96rem)");
    expect(css).toContain("grid-template-columns: minmax(0, 3fr) minmax(18rem, 1fr)");
    expect(css).toContain('grid-template-areas: "primary sidebar" "support sidebar"');
    expect(css).toContain(".token-terminal-support { grid-template-columns: repeat(2, minmax(0, 1fr)); }");
    expect(css).toContain(".token-terminal-support > aside > .terminal-panel { height: 100%; }");
    expect(css).not.toContain(".terminal-layout {");
    expect(css).not.toContain('grid-template-areas: "history center right"');
  });

  it("keeps chart and trading in the main grid while moving history below it", () => {
    const mainStart = page.indexOf('className="token-terminal-main"');
    const primaryStart = page.indexOf('className="token-terminal-primary"');
    const sidebarStart = page.indexOf('className="token-terminal-sidebar"');
    const supportStart = page.indexOf('className="token-terminal-support"');
    const historyStart = page.indexOf('className="token-terminal-history"');
    const primarySource = page.slice(primaryStart, sidebarStart);
    const sidebarSource = page.slice(sidebarStart, supportStart);
    const supportSource = page.slice(supportStart, historyStart);

    expect(mainStart).toBeGreaterThan(-1);
    expect(historyStart).toBeGreaterThan(mainStart);
    expect(primaryStart).toBeGreaterThan(mainStart);
    expect(sidebarStart).toBeGreaterThan(primaryStart);
    expect(supportStart).toBeGreaterThan(sidebarStart);
    expect(historyStart).toBeGreaterThan(supportStart);
    expect(primarySource).toContain("<TokenAdvancedChart ");
    expect(sidebarSource).toContain("<TokenTrading ");
    expect(sidebarSource).not.toContain("<MarketOverview ");
    expect(sidebarSource).not.toContain("<TokenGraduation ");
    expect(sidebarSource).not.toContain("<TokenCTO ");
    expect(sidebarSource).not.toContain("<TokenTradeHistory ");
    expect(supportSource).toContain("<MarketOverview ");
    expect(supportSource).toContain("<TokenGraduation ");
    expect(supportSource).toContain("<TokenCTO ");
    expect(supportSource).not.toContain("<TokenTrading ");
    expect(page.slice(historyStart)).toContain("<TokenTradeHistory ");
    expect(page.match(/<TokenAdvancedChart /g)).toHaveLength(1);
    expect(page.match(/<TokenTrading /g)).toHaveLength(1);
    expect(page.match(/<TokenTradeHistory /g)).toHaveLength(1);
    expect(page).not.toContain('className="terminal-history"');
  });

  it("keeps bounded recent trades and activity in normal page flow", () => {
    expect(trading).toContain('api.trades(tokenAddress, "?limit=20")');
    expect(trading).not.toContain("max-h-[32rem]");
    expect(trading).not.toContain("overflow-y-auto");
    expect(activity).toContain('api.activity(tokenAddress, "?limit=20")');
    expect(activity).not.toContain("max-h-[36rem]");
    expect(activity).not.toContain("overflow-y-auto");
  });

  it("keeps curve reserves and raw V3 liquidity semantically separate", () => {
    expect(page).toContain('label="Curve reserve"');
    expect(page).toContain('label="LP custody"');
    expect(page).not.toContain('label="Liquidity"');
    expect(page).toContain("graduated={graduated}");
    expect(graduation).toContain('label="V3 liquidity"');
    expect(graduation).toContain("native_usdc_amount");
    expect(graduation).toContain("formatMarketUSDC(graduation.native_usdc_amount)");
    expect(graduation).not.toContain("eth_amount");
    expect(graduation).not.toContain("ethAmount");
    expect(graduation).not.toContain("formatNative(graduation.liquidity");
    expect(graduation).not.toContain("formatWeiUsd(graduation.liquidity");
  });
});
