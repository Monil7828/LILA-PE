from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pyarrow.parquet as pq


MAP_CONFIGS = {
    "AmbroseValley": {
        "label": "Ambrose Valley",
        "scale": 900,
        "originX": -370,
        "originZ": -473,
        "image": "minimaps/AmbroseValley_Minimap.png",
    },
    "GrandRift": {
        "label": "Grand Rift",
        "scale": 581,
        "originX": -290,
        "originZ": -290,
        "image": "minimaps/GrandRift_Minimap.png",
    },
    "Lockdown": {
        "label": "Lockdown",
        "scale": 1000,
        "originX": -500,
        "originZ": -500,
        "image": "minimaps/Lockdown_Minimap.jpg",
    },
}

EVENT_CODES = {
    "Position": "P",
    "BotPosition": "BP",
    "Kill": "K",
    "Killed": "D",
    "BotKill": "BK",
    "BotKilled": "BD",
    "KilledByStorm": "S",
    "Loot": "L",
}

CODE_TO_EVENT = {value: key for key, value in EVENT_CODES.items()}
POSITION_EVENTS = {"Position", "BotPosition"}
KILL_EVENTS = {"Kill", "BotKill"}
DEATH_EVENTS = {"Killed", "BotKilled", "KilledByStorm"}
COMBAT_EVENTS = KILL_EVENTS | DEATH_EVENTS
EPOCH = datetime(1970, 1, 1)


def is_bot(user_id: str) -> bool:
    return user_id.isdigit()


def decode_event(value: object) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value)


def timestamp_ms(value: object) -> int:
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return int(value.timestamp() * 1000)
        return int((value - EPOCH).total_seconds() * 1000)
    if hasattr(value, "timestamp"):
        return int(value.timestamp() * 1000)
    return int(value)


def day_sort_key(day: str) -> tuple[int, int]:
    match = re.search(r"_(\d+)$", day)
    return (0, int(match.group(1))) if match else (1, 0)


def round_coord(value: object) -> float:
    number = float(value)
    if math.isnan(number) or math.isinf(number):
        return 0.0
    return round(number, 2)


def pixel_for(map_id: str, x: float, z: float) -> tuple[float, float]:
    config = MAP_CONFIGS[map_id]
    u = (x - config["originX"]) / config["scale"]
    v = (z - config["originZ"]) / config["scale"]
    return (u * 1024, (1 - v) * 1024)


def empty_event_counts() -> Counter:
    return Counter({event: 0 for event in EVENT_CODES})


def build_dataset(data_root: Path) -> dict:
    parquet_files = sorted(data_root.glob("February_*/*.nakama-0"))
    if not parquet_files:
        raise FileNotFoundError(f"No .nakama-0 parquet files found under {data_root}")

    match_rows: dict[str, list[dict]] = defaultdict(list)
    file_errors: list[dict] = []

    columns = ["user_id", "match_id", "map_id", "x", "z", "ts", "event"]
    for path in parquet_files:
        try:
            table = pq.read_table(path, columns=columns)
        except Exception as exc:  # pragma: no cover - keeps bad source files visible.
            file_errors.append({"file": str(path.relative_to(data_root)), "error": str(exc)})
            continue

        values = {name: table[name].to_pylist() for name in columns}
        day = path.parent.name
        row_count = len(values["user_id"])

        for index in range(row_count):
            event = decode_event(values["event"][index])
            if event not in EVENT_CODES:
                file_errors.append(
                    {
                        "file": str(path.relative_to(data_root)),
                        "error": f"Unknown event type {event!r}",
                    }
                )
                continue

            match_id = str(values["match_id"][index])
            user_id = str(values["user_id"][index])
            map_id = str(values["map_id"][index])
            x = round_coord(values["x"][index])
            z = round_coord(values["z"][index])

            match_rows[match_id].append(
                {
                    "day": day,
                    "user": user_id,
                    "type": "bot" if is_bot(user_id) else "human",
                    "map": map_id,
                    "x": x,
                    "z": z,
                    "ts": timestamp_ms(values["ts"][index]),
                    "event": event,
                }
            )

    matches = []
    summary = {
        "sourceFiles": len(parquet_files),
        "readErrors": file_errors,
        "totalRows": 0,
        "humans": set(),
        "bots": set(),
        "maps": defaultdict(lambda: {"matches": 0, "rows": 0, "humans": set(), "bots": set(), "eventCounts": empty_event_counts()}),
        "dates": defaultdict(lambda: {"matches": 0, "rows": 0, "humans": set(), "bots": set(), "eventCounts": empty_event_counts()}),
        "events": empty_event_counts(),
    }

    for match_id, rows in match_rows.items():
        rows.sort(key=lambda row: row["ts"])
        start_ms = rows[0]["ts"]
        end_ms = rows[-1]["ts"]
        map_counts = Counter(row["map"] for row in rows)
        day_counts = Counter(row["day"] for row in rows)
        map_id = map_counts.most_common(1)[0][0]
        day = day_counts.most_common(1)[0][0]
        event_counts = Counter(row["event"] for row in rows)

        players_by_id: dict[str, dict] = {}
        for row in rows:
            player = players_by_id.setdefault(
                row["user"],
                {"id": row["user"], "type": row["type"], "events": []},
            )
            player["events"].append(
                [
                    row["ts"] - start_ms,
                    row["x"],
                    row["z"],
                    EVENT_CODES[row["event"]],
                ]
            )

        players = sorted(
            players_by_id.values(),
            key=lambda player: (player["type"] != "human", player["id"]),
        )
        human_count = sum(1 for player in players if player["type"] == "human")
        bot_count = len(players) - human_count
        duration_ms = max(1, end_ms - start_ms)

        match_record = {
            "id": match_id,
            "shortId": match_id.replace(".nakama-0", "")[:8],
            "date": day,
            "mapId": map_id,
            "durationMs": duration_ms,
            "rows": len(rows),
            "humanPlayers": human_count,
            "botPlayers": bot_count,
            "eventCounts": {event: event_counts.get(event, 0) for event in EVENT_CODES},
            "players": players,
        }
        matches.append(match_record)

        summary["totalRows"] += len(rows)
        summary["events"].update(event_counts)
        map_summary = summary["maps"][map_id]
        date_summary = summary["dates"][day]
        map_summary["matches"] += 1
        map_summary["rows"] += len(rows)
        map_summary["eventCounts"].update(event_counts)
        date_summary["matches"] += 1
        date_summary["rows"] += len(rows)
        date_summary["eventCounts"].update(event_counts)

        for player in players:
            target = summary["bots"] if player["type"] == "bot" else summary["humans"]
            target.add(player["id"])
            map_target = map_summary["bots"] if player["type"] == "bot" else map_summary["humans"]
            date_target = date_summary["bots"] if player["type"] == "bot" else date_summary["humans"]
            map_target.add(player["id"])
            date_target.add(player["id"])

    matches.sort(key=lambda match: (day_sort_key(match["date"]), match["mapId"], match["id"]))

    def finalize_group(group: dict) -> dict:
        return {
            "matches": group["matches"],
            "rows": group["rows"],
            "humans": len(group["humans"]),
            "bots": len(group["bots"]),
            "eventCounts": {event: group["eventCounts"].get(event, 0) for event in EVENT_CODES},
        }

    aggregate = {
        "sourceFiles": summary["sourceFiles"],
        "totalRows": summary["totalRows"],
        "uniqueHumans": len(summary["humans"]),
        "uniqueBots": len(summary["bots"]),
        "matches": len(matches),
        "eventCounts": {event: summary["events"].get(event, 0) for event in EVENT_CODES},
        "maps": {map_id: finalize_group(group) for map_id, group in sorted(summary["maps"].items())},
        "dates": {date: finalize_group(group) for date, group in sorted(summary["dates"].items(), key=lambda item: day_sort_key(item[0]))},
        "readErrors": summary["readErrors"],
    }

    insights = build_insight_evidence(matches)

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "eventCodes": EVENT_CODES,
        "codeToEvent": CODE_TO_EVENT,
        "positionEvents": sorted(POSITION_EVENTS),
        "mapConfigs": MAP_CONFIGS,
        "dates": sorted({match["date"] for match in matches}, key=day_sort_key),
        "maps": sorted({match["mapId"] for match in matches}),
        "summary": aggregate,
        "insightEvidence": insights,
        "matches": matches,
    }


def build_insight_evidence(matches: list[dict]) -> dict:
    map_totals = {}
    date_totals = {}
    kill_cells = defaultdict(Counter)
    death_cells = defaultdict(Counter)
    traffic_cells = defaultdict(Counter)
    storm_cells = defaultdict(Counter)
    loot_cells = defaultdict(Counter)

    for match in matches:
        map_id = match["mapId"]
        date = match["date"]
        map_totals.setdefault(map_id, empty_event_counts()).update(match["eventCounts"])
        date_totals.setdefault(date, empty_event_counts()).update(match["eventCounts"])

        for player in match["players"]:
            for elapsed_ms, x, z, code in player["events"]:
                event = CODE_TO_EVENT[code]
                px, py = pixel_for(map_id, x, z)
                cell = (max(0, min(31, int(px // 32))), max(0, min(31, int(py // 32))))
                if event in POSITION_EVENTS:
                    traffic_cells[map_id][cell] += 1
                elif event in KILL_EVENTS:
                    kill_cells[map_id][cell] += 1
                elif event in DEATH_EVENTS:
                    death_cells[map_id][cell] += 1
                    if event == "KilledByStorm":
                        storm_cells[map_id][cell] += 1
                elif event == "Loot":
                    loot_cells[map_id][cell] += 1

    def top_cells(counter: Counter, limit: int = 5) -> list[dict]:
        cells = []
        for (cell_x, cell_y), count in counter.most_common(limit):
            cells.append({"cellX": cell_x, "cellY": cell_y, "count": count})
        return cells

    return {
        "mapEventTotals": {
            map_id: {event: totals.get(event, 0) for event in EVENT_CODES}
            for map_id, totals in sorted(map_totals.items())
        },
        "dateEventTotals": {
            date: {event: totals.get(event, 0) for event in EVENT_CODES}
            for date, totals in sorted(date_totals.items(), key=lambda item: day_sort_key(item[0]))
        },
        "topTrafficCells": {map_id: top_cells(counter) for map_id, counter in sorted(traffic_cells.items())},
        "topKillCells": {map_id: top_cells(counter) for map_id, counter in sorted(kill_cells.items())},
        "topDeathCells": {map_id: top_cells(counter) for map_id, counter in sorted(death_cells.items())},
        "topStormCells": {map_id: top_cells(counter) for map_id, counter in sorted(storm_cells.items())},
        "topLootCells": {map_id: top_cells(counter) for map_id, counter in sorted(loot_cells.items())},
    }


def write_dataset(dataset: dict, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as file:
        json.dump(dataset, file, separators=(",", ":"))
    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(
        f"Wrote {output_path} with {dataset['summary']['matches']} matches, "
        f"{dataset['summary']['totalRows']} rows ({size_mb:.2f} MB)."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert LILA parquet telemetry into static JSON.")
    parser.add_argument("--data-root", default=".", help="Folder containing February_* parquet folders.")
    parser.add_argument("--output", default="data/dataset.json", help="Output JSON path for the web app.")
    args = parser.parse_args()

    data_root = Path(args.data_root).resolve()
    output_path = Path(args.output).resolve()
    dataset = build_dataset(data_root)
    write_dataset(dataset, output_path)


if __name__ == "__main__":
    main()
