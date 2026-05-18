# Architecture

## Stack Choice

This is a static HTML/CSS/JavaScript canvas app with a Python preprocessing step. I chose this because the assignment data is small enough for browser delivery after compaction, and a static deployment avoids backend hosting, auth, databases, or server cold starts.

## Data Flow

1. Raw `.nakama-0` parquet files are read by `scripts/process_data.py` with `pyarrow`.
2. The script decodes the binary `event` column, detects bots by numeric `user_id`, groups rows by `match_id`, sorts each match by `ts`, and subtracts the first timestamp so playback starts at `t+0`.
3. Each match is stored in `data/dataset.json` with compact event rows: `[elapsedMs, x, z, eventCode]`.
4. The browser loads `data/dataset.json`, filters matches client-side, draws aggregate heatmaps on one canvas, and draws the selected match's paths and markers on a second canvas above the minimap image.

## Coordinate Mapping

The app uses the map scale and origin values from the supplied README. For every event, the browser converts world `(x, z)` into minimap pixels:

```text
u = (x - originX) / scale
v = (z - originZ) / scale
pixelX = u * 1024
pixelY = (1 - v) * 1024
```

The `y` column is ignored because it is elevation, not a 2D map coordinate. Heatmaps use the same transform and bin events into 16 px cells.

## Assumptions

- Numeric `user_id` values are bots; UUID-like `user_id` values are human players.
- `Kill` and `Killed` are player-vs-player events; `BotKill` and `BotKilled` represent human-bot combat.
- Timestamp deltas are preserved exactly, but playback stretches the selected match to a readable animation length because the raw deltas are very compact.
- Heatmaps aggregate all matches matching the selected map/date filters; player journeys and the event feed focus on the selected match.

## Tradeoffs

| Decision | Why | Tradeoff |
| --- | --- | --- |
| Static app | Easy to host and evaluate from a single repo | Requires preprocessing when raw data changes |
| Single JSON payload | 2.34 MB is small enough and keeps frontend simple | Initial load includes all matches |
| Canvas rendering | Fast for dense paths, heatmaps, and timeline redraws | Less accessible than DOM markers |
| Client-side filters | Instant interaction after load | Not ideal for much larger telemetry volumes |
