# LILA BLACK Player Journey Explorer

A browser-based visualization tool for exploring LILA BLACK player telemetry on top of the supplied minimaps. It is built for level designers who need to see movement paths, combat locations, loot concentration, storm deaths, and match playback without opening data tools.

## Live Demo

Deployment URL: https://lila-games-pe.netlify.app/
## What It Does

- Plots human and bot journeys on the correct minimap using the provided world-to-minimap transform.
- Filters by map, date, and match.
- Shows kill, death, loot, and storm events as distinct markers.
- Plays a selected match forward with a timeline slider.
- Renders heatmaps for traffic, kills, deaths, and loot across the selected map/date filter.
- Ships with a preprocessed `data/dataset.json` so the deployed site is fully static.

## Tech Stack

- Frontend: plain HTML, CSS, and JavaScript canvas.
- Data pipeline: Python plus `pyarrow` to read the `.nakama-0` parquet files.
- Hosting target: static site hosting. No backend is needed after preprocessing.

## Setup

The generated dataset is already included, so local usage only needs a static server:

```powershell
py -m http.server 5173
```

Then open:

```text
http://localhost:5173
```

To regenerate the browser dataset from raw parquet:

```powershell
py -m pip install -r requirements.txt
py scripts/process_data.py --data-root . --output data/dataset.json
```

If you use the bundled Codex Python runtime, make sure `pyarrow` is installed into the active environment or expose the local target folder through `PYTHONPATH`.

## Data Layout

The raw telemetry lives in the `February_10` through `February_14` folders. Each `.nakama-0` file is a parquet file for one player or bot in one match. Minimap images live in `minimaps/`.

The preprocessing script decodes event bytes, detects bots from numeric `user_id` values, groups rows by match, converts timestamps to match-relative offsets, and writes one compact JSON payload at `data/dataset.json`.


## Notes

- The timestamp values are treated as relative telemetry deltas after subtracting each match's first event time. Playback maps each selected match to a usable animation duration rather than real-time wall-clock speed.
- Heatmaps aggregate all matches matching the current map/date filters, while paths and event feed show the selected match.
- February 14 is a partial day, so date-level comparisons should account for lower collection volume.
