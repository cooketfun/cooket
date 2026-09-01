-- Canonical V3 hourly candle fields. Values are wei per whole token and are
-- nullable as a unit when a bucket cannot be priced safely from every trade.

ALTER TABLE token_trade_buckets ADD COLUMN open_price NUMERIC(78,0);
ALTER TABLE token_trade_buckets ADD COLUMN high_price NUMERIC(78,0);
ALTER TABLE token_trade_buckets ADD COLUMN low_price NUMERIC(78,0);

COMMENT ON COLUMN token_trade_buckets.open_price IS
    'V3 price after the first canonical trade in the UTC hour; null with the full candle when any trade is not safely priceable.';
COMMENT ON COLUMN token_trade_buckets.high_price IS
    'Maximum safely derived V3 post-trade price in the UTC hour; null with the full candle when any trade is not safely priceable.';
COMMENT ON COLUMN token_trade_buckets.low_price IS
    'Minimum safely derived V3 post-trade price in the UTC hour; null with the full candle when any trade is not safely priceable.';
COMMENT ON COLUMN token_trade_buckets.close_price IS
    'V3 price after the final canonical trade in the UTC hour; null with the full candle when any trade is not safely priceable.';
