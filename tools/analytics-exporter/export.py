#!/usr/bin/env python3
"""Export public Cooket API projections into normalized Dune CSV datasets.

The Cooket indexer/PostgreSQL API remains authoritative. This program never
writes to Cooket and uploads only when DUNE_UPLOAD_ENABLED=true and --upload
are both present.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, getcontext
from pathlib import Path
from typing import Any, Iterable

getcontext().prec = 100

NETWORK = "Arc Testnet"
CHAIN_ID = 5_042_002
NATIVE_USDC_DECIMALS = 18
ERC20_USDC_DECIMALS = 6
DEFAULT_API_URL = "https://api.cooket.fun"
DEFAULT_RPC_URL = "https://rpc.testnet.arc.io"
DUNE_UPLOAD_URL = "https://api.dune.com/api/v1/uploads/csv"
DATASET_NAMES = (
    "cooket_overview",
    "cooket_daily_launches",
    "cooket_daily_trades",
    "cooket_top_tokens",
)

SCHEMAS = {
    "cooket_overview": [
        "network", "chain_id", "total_tokens", "total_trades",
        "unique_creators", "unique_traders", "curve_volume_native_usdc",
        "graduated_volume_erc20_usdc", "graduation_count",
        "latest_indexed_block", "latest_indexed_at", "generated_at",
    ],
    "cooket_daily_launches": [
        "day", "network", "tokens_created", "unique_creators",
        "latest_indexed_block", "generated_at",
    ],
    "cooket_daily_trades": [
        "day", "network", "trade_count", "unique_traders", "buy_count",
        "sell_count", "curve_volume_native_usdc",
        "graduated_volume_erc20_usdc", "latest_indexed_block", "generated_at",
    ],
    "cooket_top_tokens": [
        "token_address", "symbol", "name", "trade_count", "unique_traders",
        "curve_volume_native_usdc", "graduated_volume_erc20_usdc",
        "graduation_status", "graduation_progress", "latest_trade_at",
        "network", "latest_indexed_block", "generated_at",
    ],
}


class ExportError(RuntimeError):
    pass


def utc_iso(timestamp: int | float | None = None) -> str:
    value = time.time() if timestamp is None else timestamp
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def utc_day(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).date().isoformat()


def scaled(raw: int, decimals: int) -> str:
    sign = "-" if raw < 0 else ""
    digits = str(abs(raw)).rjust(decimals + 1, "0")
    whole, fraction = digits[:-decimals], digits[-decimals:]
    fraction = fraction.rstrip("0") or "0"
    return f"{sign}{whole}.{fraction}"


def request_json(url: str, *, method: str = "GET", headers: dict[str, str] | None = None,
                 body: bytes | None = None, timeout: int = 45) -> dict[str, Any]:
    request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read(512).decode("utf-8", "replace")
        raise ExportError(f"HTTP {exc.code} from {url}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise ExportError(f"request failed for {url}: {exc.reason}") from exc
    try:
        value = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ExportError(f"non-JSON response from {url}") from exc
    if not isinstance(value, dict):
        raise ExportError(f"unexpected JSON response from {url}")
    return value


class CooketAPI:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = self.base_url + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        return request_json(url)

    def all_tokens(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        cursor = ""
        while True:
            params: dict[str, Any] = {"limit": 100}
            if cursor:
                params["cursor"] = cursor
            page = self.get("/api/v1/tokens", params)
            batch = page.get("items")
            if not isinstance(batch, list):
                raise ExportError("token list response has no items array")
            items.extend(batch)
            cursor = str(page.get("next_cursor") or "")
            if not cursor:
                return items

    def token_bundle(self, address: str) -> tuple[dict[str, Any], list[dict[str, Any]], list[int]]:
        detail = self.get(f"/api/v1/tokens/{address}")
        detail_checkpoint = positive_checkpoint(detail, f"token {address}")
        checkpoints = [detail_checkpoint]
        trades: list[dict[str, Any]] = []
        cursor = ""
        while True:
            params: dict[str, Any] = {"limit": 100}
            if cursor:
                params["cursor"] = cursor
            page = self.get(f"/api/v1/tokens/{address}/trades", params)
            checkpoints.append(positive_checkpoint(page, f"trades {address}"))
            batch = page.get("items")
            if not isinstance(batch, list):
                raise ExportError(f"trade response for {address} has no items array")
            trades.extend(batch)
            cursor = str(page.get("next_cursor") or "")
            if not cursor:
                break
        validate_token_metrics(detail, trades, detail_checkpoint)
        return detail, trades, checkpoints


def positive_checkpoint(payload: dict[str, Any], label: str) -> int:
    try:
        value = int(payload["indexed_through_block"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ExportError(f"{label} has no valid indexed_through_block") from exc
    if value <= 0:
        raise ExportError(f"{label} returned a non-positive indexer checkpoint")
    return value


def block_timestamp(rpc_url: str, block_number: int) -> str:
    chain_request = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []}).encode()
    headers = {"Content-Type": "application/json", "User-Agent": "cooket-analytics-exporter/1.0"}
    chain = request_json(rpc_url, method="POST", headers=headers, body=chain_request)
    if int(str(chain.get("result", "0x0")), 16) != CHAIN_ID:
        raise ExportError("RPC chain ID does not match Arc Testnet 5042002")
    block_request = json.dumps({
        "jsonrpc": "2.0", "id": 2, "method": "eth_getBlockByNumber",
        "params": [hex(block_number), False],
    }).encode()
    block = request_json(rpc_url, method="POST", headers=headers, body=block_request).get("result")
    if not isinstance(block, dict) or "timestamp" not in block:
        raise ExportError(f"RPC did not return block {block_number}")
    return utc_iso(int(str(block["timestamp"]), 16))


def trade_key(trade: dict[str, Any]) -> tuple[str, int]:
    return str(trade["transaction_hash"]).lower(), int(trade["log_index"])


def require_int(item: dict[str, Any], key: str, label: str) -> int:
    try:
        value = int(item[key])
    except (KeyError, TypeError, ValueError) as exc:
        raise ExportError(f"{label} has invalid {key}") from exc
    if value < 0:
        raise ExportError(f"{label} has negative {key}")
    return value


def validate_token_metrics(token: dict[str, Any], trades: list[dict[str, Any]], checkpoint: int) -> None:
    """Reconcile paginated canonical trade rows with the token metric projection."""
    address = str(token.get("address", "unknown"))
    metrics = token.get("metrics")
    if not isinstance(metrics, dict):
        raise ExportError(f"token {address} has no metrics projection")
    rows = [trade for trade in trades if require_int(trade, "block_number", "trade") <= checkpoint]
    unique_rows = {trade_key(trade): trade for trade in rows}
    if len(unique_rows) != len(rows):
        raise ExportError(f"token {address} returned duplicate canonical trades")
    curve_raw = sum(require_int(t, "curve_value", "curve trade") for t in rows if t.get("source") == "curve")
    v3_raw = sum(require_int(t, "reserve_amount", "Uniswap V3 trade") for t in rows if t.get("source") == "uniswap_v3")
    checks = {
        "trade_count": len(rows) == require_int(metrics, "trade_count", f"token {address} metrics"),
        "buy_count": sum(t.get("side") == "buy" for t in rows) == require_int(metrics, "buy_count", f"token {address} metrics"),
        "sell_count": sum(t.get("side") == "sell" for t in rows) == require_int(metrics, "sell_count", f"token {address} metrics"),
        "unique_trader_count": len({str(t["trader"]).lower() for t in rows}) == require_int(metrics, "unique_trader_count", f"token {address} metrics"),
        "volume": curve_raw + v3_raw * (10 ** (NATIVE_USDC_DECIMALS - ERC20_USDC_DECIMALS))
                  == require_int(metrics, "volume", f"token {address} metrics"),
    }
    failed = [name for name, passed in checks.items() if not passed]
    if failed:
        raise ExportError(f"token {address} API metrics disagree with canonical trade rows: {', '.join(failed)}")


@dataclass(frozen=True)
class ExportResult:
    tables: dict[str, list[dict[str, Any]]]
    validation: dict[str, Any]


def build_export(tokens: list[dict[str, Any]], trades: list[dict[str, Any]], cutoff: int,
                 indexed_at: str, generated_at: str, since_block: int | None = None,
                 since_timestamp: int | None = None) -> ExportResult:
    source_tokens = [t for t in tokens if require_int(t["created_at"], "block_number", "token created_at") <= cutoff]
    deduped: dict[tuple[str, int], dict[str, Any]] = {}
    for trade in trades:
        block = require_int(trade, "block_number", "trade")
        if block <= cutoff:
            key = trade_key(trade)
            if key in deduped and deduped[key] != trade:
                raise ExportError(f"conflicting duplicate trade {key[0]}:{key[1]}")
            deduped[key] = trade
    source_trades = list(deduped.values())

    token_addresses = {str(t["address"]).lower() for t in source_tokens}
    if any(str(t["token_address"]).lower() not in token_addresses for t in source_trades):
        raise ExportError("trade references a token absent from the canonical token export")

    curve_raw = 0
    graduated_raw = 0
    for trade in source_trades:
        source = trade.get("source")
        if source == "curve":
            curve_raw += require_int(trade, "curve_value", "curve trade")
        elif source == "uniswap_v3":
            graduated_raw += require_int(trade, "reserve_amount", "Uniswap V3 trade")
        else:
            raise ExportError(f"unsupported trade source {source!r}")

    creators = {str(t["creator"]).lower() for t in source_tokens}
    traders = {str(t["trader"]).lower() for t in source_trades}
    graduation_count = sum(1 for t in source_tokens if graduation_status(t) == "graduated")

    overview = [{
        "network": NETWORK,
        "chain_id": CHAIN_ID,
        "total_tokens": len(source_tokens),
        "total_trades": len(source_trades),
        "unique_creators": len(creators),
        "unique_traders": len(traders),
        "curve_volume_native_usdc": scaled(curve_raw, NATIVE_USDC_DECIMALS),
        "graduated_volume_erc20_usdc": scaled(graduated_raw, ERC20_USDC_DECIMALS),
        "graduation_count": graduation_count,
        "latest_indexed_block": cutoff,
        "latest_indexed_at": indexed_at,
        "generated_at": generated_at,
    }]

    launch_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for token in source_tokens:
        launch_groups[utc_day(require_int(token["created_at"], "block_timestamp", "token created_at"))].append(token)
    daily_launches = [{
        "day": day,
        "network": NETWORK,
        "tokens_created": len(group),
        "unique_creators": len({str(t["creator"]).lower() for t in group}),
        "latest_indexed_block": cutoff,
        "generated_at": generated_at,
    } for day, group in sorted(launch_groups.items())]

    trade_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for trade in source_trades:
        trade_groups[utc_day(require_int(trade, "block_timestamp", "trade"))].append(trade)
    daily_trades = []
    for day, group in sorted(trade_groups.items()):
        day_curve = sum(require_int(t, "curve_value", "curve trade") for t in group if t["source"] == "curve")
        day_graduated = sum(require_int(t, "reserve_amount", "Uniswap V3 trade") for t in group if t["source"] == "uniswap_v3")
        daily_trades.append({
            "day": day,
            "network": NETWORK,
            "trade_count": len(group),
            "unique_traders": len({str(t["trader"]).lower() for t in group}),
            "buy_count": sum(1 for t in group if t["side"] == "buy"),
            "sell_count": sum(1 for t in group if t["side"] == "sell"),
            "curve_volume_native_usdc": scaled(day_curve, NATIVE_USDC_DECIMALS),
            "graduated_volume_erc20_usdc": scaled(day_graduated, ERC20_USDC_DECIMALS),
            "latest_indexed_block": cutoff,
            "generated_at": generated_at,
        })

    trades_by_token: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for trade in source_trades:
        trades_by_token[str(trade["token_address"]).lower()].append(trade)
    top_tokens = []
    for token in source_tokens:
        address = str(token["address"])
        group = trades_by_token[address.lower()]
        token_curve = sum(require_int(t, "curve_value", "curve trade") for t in group if t["source"] == "curve")
        token_graduated = sum(require_int(t, "reserve_amount", "Uniswap V3 trade") for t in group if t["source"] == "uniswap_v3")
        latest = max((require_int(t, "block_timestamp", "trade") for t in group), default=None)
        top_tokens.append({
            "token_address": address,
            "symbol": token.get("symbol", ""),
            "name": token.get("name", ""),
            "trade_count": len(group),
            "unique_traders": len({str(t["trader"]).lower() for t in group}),
            "curve_volume_native_usdc": scaled(token_curve, NATIVE_USDC_DECIMALS),
            "graduated_volume_erc20_usdc": scaled(token_graduated, ERC20_USDC_DECIMALS),
            "graduation_status": graduation_status(token),
            "graduation_progress": graduation_progress(token),
            "latest_trade_at": utc_iso(latest) if latest is not None else "",
            "network": NETWORK,
            "latest_indexed_block": cutoff,
            "generated_at": generated_at,
        })
    top_tokens.sort(key=lambda row: (-int(row["trade_count"]), str(row["token_address"]).lower()))

    tables = {
        "cooket_overview": overview,
        "cooket_daily_launches": daily_launches,
        "cooket_daily_trades": daily_trades,
        "cooket_top_tokens": top_tokens,
    }
    validate_schema(tables)

    if since_block is not None or since_timestamp is not None:
        def included(block: int, timestamp: int) -> bool:
            return ((since_block is None or block > since_block) and
                    (since_timestamp is None or timestamp > since_timestamp))
        launch_days = {utc_day(int(t["created_at"]["block_timestamp"])) for t in source_tokens
                       if included(int(t["created_at"]["block_number"]), int(t["created_at"]["block_timestamp"]))}
        trade_days = {utc_day(int(t["block_timestamp"])) for t in source_trades
                      if included(int(t["block_number"]), int(t["block_timestamp"]))}
        touched_tokens = {str(t["token_address"]).lower() for t in source_trades
                          if included(int(t["block_number"]), int(t["block_timestamp"]))}
        touched_tokens |= {str(t["address"]).lower() for t in source_tokens
                           if included(int(t["created_at"]["block_number"]), int(t["created_at"]["block_timestamp"]))}
        tables["cooket_daily_launches"] = [r for r in daily_launches if r["day"] in launch_days]
        tables["cooket_daily_trades"] = [r for r in daily_trades if r["day"] in trade_days]
        tables["cooket_top_tokens"] = [r for r in top_tokens if str(r["token_address"]).lower() in touched_tokens]

    checks = {
        "token_count_matches_source_rows": int(overview[0]["total_tokens"]) == len(source_tokens),
        "trade_count_matches_source_rows": int(overview[0]["total_trades"]) == len(source_trades),
        "unique_creator_count_matches_source_rows": int(overview[0]["unique_creators"]) == len(creators),
        "unique_trader_count_matches_source_rows": int(overview[0]["unique_traders"]) == len(traders),
        "graduation_count_matches_source_rows": int(overview[0]["graduation_count"]) == graduation_count,
        "curve_volume_matches_source_rows": sum(
            int(Decimal(str(r["curve_volume_native_usdc"])) * (10 ** NATIVE_USDC_DECIMALS))
            for r in daily_trades) == curve_raw,
        "graduated_volume_matches_source_rows": sum(
            int(Decimal(str(r["graduated_volume_erc20_usdc"])) * (10 ** ERC20_USDC_DECIMALS))
            for r in daily_trades) == graduated_raw,
        "latest_indexed_block_is_positive": cutoff > 0,
    }
    if not all(checks.values()):
        raise ExportError("export validation failed")
    validation = {
        "source": "Cooket canonical API projections backed by indexer/PostgreSQL",
        "source_api": "configured at runtime",
        "network": NETWORK,
        "chain_id": CHAIN_ID,
        "snapshot_cutoff_block": cutoff,
        "latest_indexed_at": indexed_at,
        "generated_at": generated_at,
        "mode": "incremental_delta" if since_block is not None or since_timestamp is not None else "full_snapshot",
        "incremental_after_block": since_block,
        "incremental_after_timestamp": utc_iso(since_timestamp) if since_timestamp is not None else None,
        "decimal_rules": {
            "curve_volume_native_usdc": NATIVE_USDC_DECIMALS,
            "graduated_volume_erc20_usdc": ERC20_USDC_DECIMALS,
        },
        "source_totals": overview[0],
        "source_totals_raw": {
            "curve_volume_native_usdc": str(curve_raw),
            "graduated_volume_erc20_usdc": str(graduated_raw),
        },
        "exported_row_counts": {name: len(rows) for name, rows in tables.items()},
        "validation_checks": checks,
    }
    return ExportResult(tables=tables, validation=validation)


def graduation_status(token: dict[str, Any]) -> str:
    graduation = token.get("graduation")
    if isinstance(graduation, dict) and graduation.get("phase"):
        return str(graduation["phase"])
    curve = token.get("curve")
    if isinstance(curve, dict) and curve.get("lifecycle"):
        return str(curve["lifecycle"])
    return "active"


def graduation_progress(token: dict[str, Any]) -> str:
    curve = token.get("curve")
    if not isinstance(curve, dict):
        return "0.0"
    sold = require_int(curve, "sold_supply", "curve")
    threshold = require_int(curve, "graduation_threshold", "curve")
    if threshold == 0:
        return "0.0"
    percent = min(Decimal(100), Decimal(sold) * Decimal(100) / Decimal(threshold))
    return format(percent.quantize(Decimal("0.000001")), "f")


def validate_schema(tables: dict[str, list[dict[str, Any]]]) -> None:
    if set(tables) != set(DATASET_NAMES):
        raise ExportError("dataset name set is invalid")
    for name, rows in tables.items():
        expected = SCHEMAS[name]
        for number, row in enumerate(rows, start=1):
            if list(row) != expected:
                raise ExportError(f"{name} row {number} columns do not match required schema")
    if not tables["cooket_overview"]:
        raise ExportError("overview dataset must contain a coverage row")


def csv_text(rows: list[dict[str, Any]], columns: list[str]) -> str:
    target = io.StringIO(newline="")
    writer = csv.DictWriter(target, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return target.getvalue()


def write_export(output_dir: Path, result: ExportResult, manifest: dict[str, Any]) -> dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    checksums: dict[str, str] = {}
    for name in DATASET_NAMES:
        content = csv_text(result.tables[name], SCHEMAS[name])
        path = output_dir / f"{name}.csv"
        path.write_text(content, encoding="utf-8")
        checksums[path.name] = hashlib.sha256(content.encode()).hexdigest()
    validation = dict(result.validation)
    validation["deployment_manifest"] = manifest
    validation["sha256"] = checksums
    (output_dir / "validation.json").write_text(json.dumps(validation, indent=2) + "\n", encoding="utf-8")
    return checksums


def load_deployment(repo_root: Path) -> dict[str, Any]:
    paths = [
        repo_root / "contracts/deployments/arc-testnet/cooket-v3.json",
        repo_root / "contracts/deployments/arc-testnet/uniswap-v3-periphery.json",
    ]
    loaded = []
    for path in paths:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ExportError(f"cannot read deployment manifest {path}") from exc
        if int(value.get("chainId", 0)) != CHAIN_ID or value.get("verified") is not True:
            raise ExportError(f"deployment manifest is not verified for chain {CHAIN_ID}: {path}")
        loaded.append((path, value))
    cooket, periphery = loaded[0][1], loaded[1][1]
    if str(cooket.get("canonicalUsdc", "")).lower() != "0x3600000000000000000000000000000000000000":
        raise ExportError("canonical Arc Testnet USDC address differs from the reviewed manifest")
    if str(cooket.get("uniswapV3Factory", "")).lower() != str(periphery.get("uniswapV3Factory", "")).lower():
        raise ExportError("Uniswap V3 factory differs between deployment manifests")
    return {
        "cooket_v3_path": str(paths[0].relative_to(repo_root)),
        "uniswap_v3_periphery_path": str(paths[1].relative_to(repo_root)),
        "canonical_usdc": cooket["canonicalUsdc"],
        "cooket_factory": cooket["cooketFactory"],
        "graduation_manager": cooket["graduationManager"],
        "uniswap_v3_factory": cooket["uniswapV3Factory"],
        "nonfungible_position_manager": cooket["nonfungiblePositionManager"],
        "swap_router": periphery["swapRouter"],
    }


def upload_tables(result: ExportResult) -> None:
    if os.getenv("DUNE_UPLOAD_ENABLED", "false").strip().lower() != "true":
        raise ExportError("upload refused: DUNE_UPLOAD_ENABLED must equal true")
    api_key = os.getenv("DUNE_API_KEY", "").strip()
    if not api_key:
        raise ExportError("upload refused: DUNE_API_KEY is not set")
    if result.validation["mode"] != "full_snapshot":
        raise ExportError("upload refused: CSV replacement is limited to full snapshots; incremental CSVs are export-only")
    descriptions = {
        "cooket_overview": "Arc Testnet Cooket overview synchronized from the canonical Cooket Indexer/API.",
        "cooket_daily_launches": "Arc Testnet Cooket daily launches synchronized from the canonical Cooket Indexer/API.",
        "cooket_daily_trades": "Arc Testnet Cooket daily trading, with native USDC (18 decimals) and ERC-20 USDC (6 decimals) separated.",
        "cooket_top_tokens": "Arc Testnet Cooket token activity synchronized from the canonical Cooket Indexer/API.",
    }
    headers = {"Content-Type": "application/json", "X-DUNE-API-KEY": api_key}
    for name in DATASET_NAMES:
        payload = json.dumps({
            "table_name": name,
            "data": csv_text(result.tables[name], SCHEMAS[name]),
            "description": descriptions[name],
            "is_private": False,
        }).encode()
        response = request_json(DUNE_UPLOAD_URL, method="POST", headers=headers, body=payload, timeout=120)
        if response.get("success") is False or response.get("error"):
            raise ExportError(f"Dune rejected dataset {name}")
        print(f"uploaded {name}")


def fetch_source(api: CooketAPI, workers: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[int]]:
    listed = api.all_tokens()
    addresses = [str(item.get("address", "")) for item in listed]
    if not addresses or any(not address.startswith("0x") for address in addresses):
        raise ExportError("Cooket API returned no valid token addresses")
    tokens: list[dict[str, Any]] = []
    trades: list[dict[str, Any]] = []
    checkpoints: list[int] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(api.token_bundle, address): address for address in addresses}
        for future in as_completed(futures):
            detail, token_trades, token_checkpoints = future.result()
            tokens.append(detail)
            trades.extend(token_trades)
            checkpoints.extend(token_checkpoints)
    tokens.sort(key=lambda token: (int(token["created_at"]["block_number"]), str(token["address"]).lower()))
    return tokens, trades, checkpoints


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default=os.getenv("COOKET_ANALYTICS_API_URL", DEFAULT_API_URL))
    parser.add_argument("--rpc-url", default=os.getenv("COOKET_ANALYTICS_RPC_URL", DEFAULT_RPC_URL))
    parser.add_argument("--output-dir", type=Path, default=Path("tmp/cooket-analytics"))
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--since-block", type=int)
    parser.add_argument("--since-timestamp", help="ISO-8601 UTC timestamp; produces delta daily/top rows")
    parser.add_argument("--upload", action="store_true", help="replace public Dune datasets after validation")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    if args.workers < 1 or args.workers > 8:
        raise ExportError("workers must be between 1 and 8")
    since_timestamp = None
    if args.since_timestamp:
        try:
            since_timestamp = int(datetime.fromisoformat(args.since_timestamp.replace("Z", "+00:00")).timestamp())
        except ValueError as exc:
            raise ExportError("since-timestamp must be ISO-8601") from exc
    repo_root = Path(__file__).resolve().parents[2]
    deployment = load_deployment(repo_root)
    api = CooketAPI(args.api_url)
    tokens, trades, checkpoints = fetch_source(api, args.workers)
    cutoff = min(checkpoints)
    generated_at = utc_iso()
    result = build_export(
        tokens, trades, cutoff, block_timestamp(args.rpc_url, cutoff), generated_at,
        since_block=args.since_block, since_timestamp=since_timestamp,
    )
    result.validation["source_api"] = args.api_url
    result.validation["observed_checkpoint_min"] = min(checkpoints)
    result.validation["observed_checkpoint_max"] = max(checkpoints)
    result.validation["validation_checks"]["per_token_api_metrics_reconciled"] = True
    checksums = write_export(args.output_dir, result, deployment)
    print(f"validated {result.validation['mode']} at block {cutoff}")
    for name in DATASET_NAMES:
        print(f"{name}: {len(result.tables[name])} rows, sha256={checksums[name + '.csv']}")
    if args.upload:
        upload_tables(result)
    else:
        print("dry-run only; no Dune upload requested")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ExportError as exc:
        print(f"cooket-analytics-export: {exc}", file=sys.stderr)
        raise SystemExit(1)
