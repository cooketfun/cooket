import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("export.py")
SPEC = importlib.util.spec_from_file_location("cooket_analytics_export", MODULE_PATH)
export = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = export
SPEC.loader.exec_module(export)


def token(address, creator, day, *, graduated=False):
    return {
        "address": address,
        "creator": creator,
        "name": "Token " + address[-1],
        "symbol": "T" + address[-1],
        "created_at": {"block_number": day, "block_timestamp": 1_700_000_000 + day},
        "curve": {
            "sold_supply": "800000000000000000000000000" if graduated else "400000000000000000000000000",
            "graduation_threshold": "800000000000000000000000000",
            "lifecycle": "graduated" if graduated else "active",
        },
        "graduation": {"phase": "graduated"} if graduated else None,
    }


def trade(address, trader, block, log_index, source, amount, side="buy"):
    return {
        "token_address": address,
        "trader": trader,
        "block_number": block,
        "block_timestamp": 1_700_000_000 + block,
        "transaction_hash": "0x" + f"{block:064x}",
        "log_index": log_index,
        "source": source,
        "reserve_amount": str(amount),
        "curve_value": str(amount),
        "side": side,
    }


class ExportTests(unittest.TestCase):
    def test_separates_volume_units_and_validates_totals(self):
        tokens = [token("0x1", "0xa", 10), token("0x2", "0xb", 11, graduated=True)]
        trades = [
            trade("0x1", "0xc", 12, 0, "curve", 1_250_000_000_000_000_000),
            trade("0x2", "0xc", 13, 0, "uniswap_v3", 2_500_000, "sell"),
        ]
        result = export.build_export(tokens, trades, 20, "2023-11-14T00:00:00Z", "2023-11-14T01:00:00Z")
        overview = result.tables["cooket_overview"][0]
        self.assertEqual(overview["total_tokens"], 2)
        self.assertEqual(overview["total_trades"], 2)
        self.assertEqual(overview["unique_traders"], 1)
        self.assertEqual(overview["curve_volume_native_usdc"], "1.25")
        self.assertEqual(overview["graduated_volume_erc20_usdc"], "2.5")
        self.assertEqual(overview["graduation_count"], 1)
        self.assertTrue(all(result.validation["validation_checks"].values()))

    def test_cutoff_and_incremental_rows(self):
        tokens = [token("0x1", "0xa", 10), token("0x2", "0xb", 30)]
        trades = [trade("0x1", "0xc", 12, 0, "curve", 10**18), trade("0x1", "0xd", 25, 0, "curve", 10**18)]
        result = export.build_export(
            tokens, trades, 20, "2023-11-14T00:00:00Z", "2023-11-14T01:00:00Z", since_block=11,
        )
        self.assertEqual(result.tables["cooket_overview"][0]["total_tokens"], 1)
        self.assertEqual(result.tables["cooket_overview"][0]["total_trades"], 1)
        self.assertEqual(len(result.tables["cooket_daily_trades"]), 1)
        self.assertEqual(result.validation["mode"], "incremental_delta")

    def test_csv_headers_are_stable(self):
        result = export.build_export(
            [token("0x1", "0xa", 10)], [], 20,
            "2023-11-14T00:00:00Z", "2023-11-14T01:00:00Z",
        )
        with tempfile.TemporaryDirectory() as directory:
            export.write_export(Path(directory), result, {"verified": True})
            header = Path(directory, "cooket_overview.csv").read_text().splitlines()[0]
        self.assertEqual(header.split(","), export.SCHEMAS["cooket_overview"])

    def test_upload_gate_defaults_closed(self):
        old = export.os.environ.pop("DUNE_UPLOAD_ENABLED", None)
        try:
            with self.assertRaisesRegex(export.ExportError, "DUNE_UPLOAD_ENABLED"):
                export.upload_tables(type("Result", (), {"validation": {"mode": "full_snapshot"}})())
        finally:
            if old is not None:
                export.os.environ["DUNE_UPLOAD_ENABLED"] = old


if __name__ == "__main__":
    unittest.main()
