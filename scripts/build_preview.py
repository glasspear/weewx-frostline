#!/usr/bin/env python3
"""Render the frostline WeeWX v5 skin into a static preview directory using Cheetah3."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta
from functools import partial
import http.server
import math
import os
from pathlib import Path
import re
import shutil
import socketserver
import sys
from typing import Any

from Cheetah.Template import Template


REPO_ROOT = Path(__file__).resolve().parent.parent
SKIN_DIR = REPO_ROOT / "frostline"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "preview"


class UnknownObservationError(AttributeError):
    """Simulates a missing schema observation type in WeeWX."""


class MockValueHelper:
    """Minimal WeeWX ValueHelper equivalent for Cheetah template rendering."""

    def __init__(
        self,
        raw: Any,
        label: str = "",
        fmt: str = "%.1f",
        is_time: bool = False,
        ordinal_compass: str | None = None,
    ) -> None:
        self.raw = raw
        self._label = label
        self._fmt = fmt
        self._is_time = is_time
        self._ordinal_compass = ordinal_compass

    @property
    def has_data(self) -> bool:
        return self.raw is not None

    @property
    def ordinal_compass(self) -> str:
        return self._ordinal_compass or ""

    def format(self, format_string: str | None = None, add_label: bool = True) -> str:
        if self.raw is None:
            return "N/A"
        if self._is_time:
            dt = datetime.fromtimestamp(float(self.raw))
            return dt.strftime(format_string or self._fmt)
        fmt = format_string or self._fmt
        try:
            text = fmt % float(self.raw)
        except (TypeError, ValueError):
            text = str(self.raw)
        if add_label and self._label:
            joiner = "" if self._label.startswith("%") else " "
            return f"{text}{joiner}{self._label}"
        return text

    def __str__(self) -> str:
        return self.format(add_label=True)


class MockSeriesHelper:
    """Minimal WeeWX SeriesHelper equivalent."""

    def __init__(self, timestamps: list[int], values: list[float | None]) -> None:
        self.start = MockValueHelper(timestamps)
        self.data = MockValueHelper(values)


class MockObsSpanBinder:
    """Minimal WeeWX ObsSpanBinder for $day/$week/$month/$year.<obs>."""

    def __init__(
        self,
        *,
        label: str,
        fmt: str,
        timestamps: list[int],
        values: list[float | None],
        agg_sum: float | None = None,
        override_max: tuple[float, int] | None = None,
        override_min: tuple[float, int] | None = None,
        override_avg: float | None = None,
        last_time: int | None = None,
    ) -> None:
        self._label = label
        self._fmt = fmt
        self._timestamps = timestamps
        self._values = values
        valid = [(v, ts) for ts, v in zip(timestamps, values) if v is not None]

        if override_max is not None:
            max_val, max_ts = override_max
        elif valid:
            max_val, max_ts = max(valid, key=lambda pair: pair[0])
        else:
            max_val, max_ts = None, None

        if override_min is not None:
            min_val, min_ts = override_min
        elif valid:
            min_val, min_ts = min(valid, key=lambda pair: pair[0])
        else:
            min_val, min_ts = None, None

        if override_avg is not None:
            avg_val = override_avg
        elif valid:
            avg_val = sum(v for v, _ in valid) / len(valid)
        else:
            avg_val = None

        if agg_sum is not None:
            sum_val = agg_sum
        elif valid:
            sum_val = sum(v for v, _ in valid)
        else:
            sum_val = None

        self.max = MockValueHelper(max_val, label=label, fmt=fmt)
        self.maxtime = MockValueHelper(max_ts, is_time=True, fmt="%I:%M %p")
        self.min = MockValueHelper(min_val, label=label, fmt=fmt)
        self.mintime = MockValueHelper(min_ts, is_time=True, fmt="%I:%M %p")
        self.avg = MockValueHelper(avg_val, label=label, fmt=fmt)
        self.sum = MockValueHelper(sum_val, label=label, fmt=fmt)
        self.lasttime = MockValueHelper(last_time, is_time=True, fmt="%I:%M %p")

    def series(
        self,
        time_series: str = "start",
        aggregate_type: str = "avg",
        aggregate_interval: int = 300,
    ) -> MockSeriesHelper:
        del time_series, aggregate_type, aggregate_interval
        return MockSeriesHelper(self._timestamps, self._values)


class MockBinder:
    """Attribute lookup wrapper for $current, $day, $week, $month, $year."""

    def __init__(self, mapping: dict[str, Any], raise_missing: bool = False) -> None:
        self._mapping = mapping
        self._raise_missing = raise_missing

    def __getattr__(self, name: str) -> Any:
        if name in self._mapping:
            return self._mapping[name]
        if self._raise_missing:
            raise UnknownObservationError(f"Unknown observation type: {name}")
        return MockObsSpanBinder(label="", fmt="%.1f", timestamps=[], values=[])


class MockUnitSection:
    """Represents $unit.label and $unit.unit_type."""

    def __init__(self, labels: dict[str, str], unit_types: dict[str, str]) -> None:
        self.label = MockSimpleLookup(labels)
        self.unit_type = MockSimpleLookup(unit_types)


class MockSimpleLookup:
    def __init__(self, data: dict[str, str]) -> None:
        self._data = data

    def __getattr__(self, name: str) -> str:
        return self._data.get(name, "")


class MockStationInfo:
    def __init__(self, lat: float, lon: float) -> None:
        self.latitude_f = lat
        self.longitude_f = lon


class MockStation:
    def __init__(self, location: str, lat: float, lon: float, altitude: str) -> None:
        self.location = location
        self.stn_info = MockStationInfo(lat, lon)
        self.latitude = MockValueHelper(lat)
        self.longitude = MockValueHelper(lon)
        self.altitude = altitude
        self.hardware = "Generic 5-in-1 Station (Preview Mock)"
        self.version = "5.1.0"
        self.uptime = "14 days, 6 hours"
        self.os_uptime = "29 days, 11 hours"


class MockAlmanac:
    def __init__(self) -> None:
        self.sunrise = "7:25 AM"
        self.sunset = "4:42 PM"
        self.moon_phase = "Waxing Gibbous"
        self.moon_fullness = "78"


def parse_skin_conf(skin_conf_path: Path) -> tuple[dict[str, str], list[str], list[str]]:
    """Parse [Extras], templates, and copy_once globs from skin.conf."""
    extras: dict[str, str] = {}
    templates: list[str] = []
    copy_globs: list[str] = []
    section_stack: list[str] = []

    for raw_line in skin_conf_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        sec_match = re.match(r"^(\[+)([^\[\]]+)(\]+)$", line)
        if sec_match:
            depth = len(sec_match.group(1))
            name = sec_match.group(2).strip()
            section_stack = section_stack[: depth - 1]
            section_stack.append(name)
            continue
        if "=" not in line:
            continue
        key, val = [part.strip() for part in line.split("=", 1)]
        if section_stack == ["Extras"]:
            extras[key] = val
        elif section_stack[:1] == ["CheetahGenerator"] and key == "template":
            templates.append(val)
        elif section_stack == ["CopyGenerator"] and key == "copy_once":
            copy_globs.extend([g.strip() for g in val.split(",") if g.strip()])

    return extras, templates, copy_globs


def _generate_curve(
    end_dt: datetime,
    points: int,
    step_seconds: int,
    base: float,
    amp: float,
    phase_shift: float = 0.0,
) -> tuple[list[int], list[float]]:
    start_dt = end_dt - timedelta(seconds=step_seconds * (points - 1))
    timestamps: list[int] = []
    values: list[float] = []
    for idx in range(points):
        ts = int((start_dt + timedelta(seconds=idx * step_seconds)).timestamp())
        wave = math.sin((idx / max(1, points - 1)) * 2.4 * math.pi + phase_shift)
        ripple = 0.18 * math.cos(idx * 0.45)
        timestamps.append(ts)
        values.append(round(base + amp * wave + ripple, 2))
    return timestamps, values


def _build_span(
    end_dt: datetime,
    points: int,
    step_seconds: int,
    rain_step_seconds: int,
    rain_points: int,
    is_today: bool,
    missing_optional: bool,
) -> MockBinder:
    ts, out_temp = _generate_curve(end_dt, points, step_seconds, base=4.1, amp=0.55, phase_shift=1.9)
    if is_today and len(out_temp) >= 12:
        # Mirror screenshot readings closely for Today
        out_temp[-1] = 4.3
        out_temp[int(len(out_temp) * 0.48)] = 3.5
        out_temp[int(len(out_temp) * 0.72)] = 4.7

    dewpoint = [round(v - 0.8, 1) for v in out_temp]
    out_humid = [min(99, max(62, round(91 - (v - 4.0) * 5.0, 1))) for v in out_temp]
    if is_today:
        out_humid[-1] = 93.0

    baro = [round(1025.5 + 1.8 * math.sin(i * 0.08), 1) for i in range(points)]
    if is_today:
        baro[-1] = 1027.0

    wind_speed = [round(max(1.0, 6.2 + 2.8 * math.sin(i * 0.25)), 1) for i in range(points)]
    wind_gust = [round(v + 3.4, 1) for v in wind_speed]

    rain_ts, _ = _generate_curve(end_dt, rain_points, rain_step_seconds, base=0.0, amp=0.0)
    if is_today:
        rain_vals = [0.0 for _ in range(rain_points)]
        rain_rate_vals = [0.0 for _ in range(points)]
        rain_sum = 0.0
    else:
        rain_vals = [
            round(2.4 if i % 5 == 2 else (0.8 if i % 3 == 1 else 0.0), 2)
            for i in range(rain_points)
        ]
        rain_rate_vals = [
            round(4.6 if i % 19 == 5 else (1.2 if i % 11 == 3 else 0.0), 2)
            for i in range(points)
        ]
        rain_sum = round(sum(rain_vals), 2)

    t_low_dt = end_dt.replace(hour=3, minute=37, second=0, microsecond=0)
    t_high_dt = end_dt.replace(hour=4, minute=52, second=0, microsecond=0)
    d_high_dt = end_dt.replace(hour=4, minute=47, second=0, microsecond=0)
    r_high_dt = end_dt.replace(hour=6, minute=57, second=0, microsecond=0)

    tower_temp = [round(v - 1.0, 1) for v in out_temp]
    tower_hum = [min(99.0, round(h + 5.0, 1)) for h in out_humid]

    span_map: dict[str, Any] = {
        "outTemp": MockObsSpanBinder(
            label="°C",
            fmt="%.1f",
            timestamps=ts,
            values=out_temp,
            override_max=(4.7, int(t_high_dt.timestamp())) if is_today else None,
            override_min=(3.5, int(t_low_dt.timestamp())) if is_today else None,
        ),
        "dewpoint": MockObsSpanBinder(
            label="°C",
            fmt="%.0f",
            timestamps=ts,
            values=dewpoint,
            override_max=(4.0, int(d_high_dt.timestamp())) if is_today else None,
            override_min=(3.0, int(t_low_dt.timestamp())) if is_today else None,
        ),
        "outHumidity": MockObsSpanBinder(label="%", fmt="%.0f", timestamps=ts, values=out_humid),
        "barometer": MockObsSpanBinder(label="hPa", fmt="%.0f", timestamps=ts, values=baro),
        "windSpeed": MockObsSpanBinder(label="km/h", fmt="%.0f", timestamps=ts, values=wind_speed),
        "windGust": MockObsSpanBinder(label="km/h", fmt="%.0f", timestamps=ts, values=wind_gust),
        "rain": MockObsSpanBinder(
            label="mm",
            fmt="%.2f",
            timestamps=rain_ts,
            values=rain_vals,
            agg_sum=rain_sum,
        ),
        "rainRate": MockObsSpanBinder(
            label="mm/h",
            fmt="%.2f",
            timestamps=ts,
            values=rain_rate_vals,
            override_max=(0.0, int(r_high_dt.timestamp())) if is_today else None,
        ),
        "inTemp": MockObsSpanBinder(label="°C", fmt="%.1f", timestamps=ts, values=[20.5 for _ in ts]),
        "inHumidity": MockObsSpanBinder(label="%", fmt="%.0f", timestamps=ts, values=[45.0 for _ in ts]),
    }

    if not missing_optional:
        span_map["appTemp"] = MockObsSpanBinder(
            label="°C",
            fmt="%.1f",
            timestamps=ts,
            values=[round(v - 1.9, 1) for v in out_temp],
        )
        span_map["extraTemp1"] = MockObsSpanBinder(label="°C", fmt="%.1f", timestamps=ts, values=tower_temp)
        span_map["extraHumid1"] = MockObsSpanBinder(label="%", fmt="%.0f", timestamps=ts, values=tower_hum)
        span_map["lightning_strike_count"] = MockObsSpanBinder(
            label="",
            fmt="%.0f",
            timestamps=ts,
            values=[0.0 for _ in ts],
            agg_sum=0.0,
        )

    return MockBinder(span_map, raise_missing=missing_optional)


def _build_alltime_span(now_dt: datetime, missing_optional: bool) -> MockBinder:
    """Create a multi-year historical span for $alltime / $span(day_delta=36500)."""
    base = _build_span(
        now_dt,
        points=180,
        step_seconds=86400,
        rain_step_seconds=604800,
        rain_points=46,
        is_today=False,
        missing_optional=missing_optional,
    )
    high_dt = int((now_dt - timedelta(days=118)).replace(hour=15, minute=14).timestamp())
    low_dt = int((now_dt - timedelta(days=284)).replace(hour=6, minute=12).timestamp())
    gust_dt = int((now_dt - timedelta(days=64)).replace(hour=19, minute=40).timestamp())
    rain_dt = int((now_dt - timedelta(days=42)).replace(hour=14, minute=22).timestamp())
    baro_hi_dt = int((now_dt - timedelta(days=190)).replace(hour=9, minute=5).timestamp())
    baro_lo_dt = int((now_dt - timedelta(days=51)).replace(hour=22, minute=48).timestamp())

    overrides = {
        "outTemp": MockObsSpanBinder(
            label="°C",
            fmt="%.1f",
            timestamps=[],
            values=[],
            override_max=(31.4, high_dt),
            override_min=(-18.2, low_dt),
        ),
        "dewpoint": MockObsSpanBinder(
            label="°C",
            fmt="%.0f",
            timestamps=[],
            values=[],
            override_max=(22.0, high_dt),
            override_min=(-23.0, low_dt),
        ),
        "windGust": MockObsSpanBinder(
            label="km/h",
            fmt="%.0f",
            timestamps=[],
            values=[],
            override_max=(78.0, gust_dt),
        ),
        "windSpeed": MockObsSpanBinder(
            label="km/h",
            fmt="%.0f",
            timestamps=[],
            values=[],
            override_max=(52.0, gust_dt),
            override_avg=11.4,
        ),
        "rain": MockObsSpanBinder(label="mm", fmt="%.2f", timestamps=[], values=[], agg_sum=1142.6),
        "rainRate": MockObsSpanBinder(
            label="mm/h",
            fmt="%.2f",
            timestamps=[],
            values=[],
            override_max=(64.2, rain_dt),
        ),
        "barometer": MockObsSpanBinder(
            label="hPa",
            fmt="%.0f",
            timestamps=[],
            values=[],
            override_max=(1042.0, baro_hi_dt),
            override_min=(974.0, baro_lo_dt),
        ),
        "outHumidity": MockObsSpanBinder(
            label="%",
            fmt="%.0f",
            timestamps=[],
            values=[],
            override_max=(100.0, rain_dt),
            override_min=(24.0, high_dt),
        ),
    }
    base._mapping.update(overrides)
    return base


def build_namespace(
    extras: dict[str, str],
    missing_optional: bool = False,
    stale: bool = False,
) -> dict[str, Any]:
    """Create a complete WeeWX v5 template searchList namespace."""
    now_dt = datetime.now()
    if stale:
        now_dt = now_dt - timedelta(minutes=45)
    now_ts = int(now_dt.timestamp())

    current_map: dict[str, Any] = {
        "dateTime": MockValueHelper(now_ts, is_time=True, fmt="%m/%d/%Y %I:%M %p"),
        "outTemp": MockValueHelper(4.3, label="°C", fmt="%.1f"),
        "windchill": MockValueHelper(2.4, label="°C", fmt="%.1f"),
        "heatindex": MockValueHelper(4.3, label="°C", fmt="%.1f"),
        "dewpoint": MockValueHelper(3.0, label="°C", fmt="%.0f"),
        "outHumidity": MockValueHelper(93, label="%", fmt="%.0f"),
        "barometer": MockValueHelper(1027, label="hPa", fmt="%.0f"),
        "windSpeed": MockValueHelper(6, label="km/h", fmt="%.0f"),
        "windGust": MockValueHelper(11, label="km/h", fmt="%.0f"),
        "windDir": MockValueHelper(247.5, label="°", fmt="%.0f", ordinal_compass="WSW"),
        "rainRate": MockValueHelper(0.0, label="mm/h", fmt="%.2f"),
        "inTemp": MockValueHelper(20.5, label="°C", fmt="%.1f"),
        "inHumidity": MockValueHelper(45, label="%", fmt="%.0f"),
    }
    if not missing_optional:
        current_map["appTemp"] = MockValueHelper(2.4, label="°C", fmt="%.1f")
        current_map["extraTemp1"] = MockValueHelper(3.3, label="°C", fmt="%.1f")
        current_map["extraHumid1"] = MockValueHelper(99, label="%", fmt="%.0f")
        current_map["lightning_distance"] = MockValueHelper(None, label="km", fmt="%.1f")
        current_map["rxCheckPercent"] = MockValueHelper(98, label="%", fmt="%.0f")
        current_map["txBatteryStatus"] = MockValueHelper(0, label="", fmt="%.0f")
        current_map["consBatteryVoltage"] = MockValueHelper(4.62, label="V", fmt="%.2f")

    trend_binder = MockBinder({"barometer": MockValueHelper(1.4, label=" hPa", fmt="%+.1f")})
    alltime_span = _build_alltime_span(now_dt, missing_optional=missing_optional)

    def trend_fn(time_delta: int = 10800) -> MockBinder:
        del time_delta
        return trend_binder

    def span_fn(day_delta: int = 1, **kwargs: Any) -> MockBinder:
        del day_delta, kwargs
        return alltime_span

    unit_labels = {
        "outTemp": " °C",
        "dewpoint": " °C",
        "outHumidity": "%",
        "barometer": " hPa",
        "windSpeed": " km/h",
        "rain": " mm",
        "rainRate": " mm/h",
        "inTemp": " °C",
        "inHumidity": "%",
        "extraTemp1": " °C",
        "extraHumid1": "%",
    }
    unit_types = {
        "outTemp": "degree_C",
        "dewpoint": "degree_C",
        "outHumidity": "percent",
        "barometer": "hPa",
        "windSpeed": "km_per_hour",
        "rain": "mm",
        "rainRate": "mm_per_hour",
        "inTemp": "degree_C",
        "inHumidity": "percent",
        "extraTemp1": "degree_C",
        "extraHumid1": "percent",
    }

    return {
        "Extras": extras,
        "station": MockStation("Harborview", 44.65, -63.58, "18.0 m"),
        "almanac": MockAlmanac(),
        "unit": MockUnitSection(unit_labels, unit_types),
        "current": MockBinder(current_map, raise_missing=missing_optional),
        "trend": trend_fn,
        "span": span_fn,
        "day": _build_span(now_dt, points=85, step_seconds=300, rain_step_seconds=1800, rain_points=15, is_today=True, missing_optional=missing_optional),
        "week": _build_span(now_dt, points=168, step_seconds=3600, rain_step_seconds=21600, rain_points=28, is_today=False, missing_optional=missing_optional),
        "month": _build_span(now_dt, points=130, step_seconds=14400, rain_step_seconds=86400, rain_points=22, is_today=False, missing_optional=missing_optional),
        "year": _build_span(now_dt, points=180, step_seconds=86400, rain_step_seconds=604800, rain_points=46, is_today=False, missing_optional=missing_optional),
    }


def render_preview(
    output_dir: Path,
    missing_optional: bool = False,
    stale: bool = False,
    extra_overrides: dict[str, str] | None = None,
) -> list[Path]:
    """Render all skin templates and copy assets into output_dir."""
    extras, templates, copy_globs = parse_skin_conf(SKIN_DIR / "skin.conf")
    if extra_overrides:
        extras.update(extra_overrides)
    ns = build_namespace(extras, missing_optional=missing_optional, stale=stale)

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    for tmpl_rel in templates:
        tmpl_path = SKIN_DIR / tmpl_rel
        out_rel = tmpl_rel[:-5] if tmpl_rel.endswith(".tmpl") else tmpl_rel
        out_path = output_dir / out_rel
        out_path.parent.mkdir(parents=True, exist_ok=True)
        rendered = str(Template(file=str(tmpl_path), searchList=[ns]))
        out_path.write_text(rendered, encoding="utf-8")
        written.append(out_path)

    for pattern in copy_globs:
        for src in SKIN_DIR.glob(pattern):
            if src.is_file():
                rel = src.relative_to(SKIN_DIR)
                dst = output_dir / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
                written.append(dst)

    return written


def serve_directory(directory: Path, port: int) -> None:
    handler = partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Serving frostline preview at http://127.0.0.1:{port}/index.html")
        print(f"Charts preview: http://127.0.0.1:{port}/charts.html")
        print(f"Records preview: http://127.0.0.1:{port}/records.html")
        httpd.serve_forever()


def main() -> int:
    parser = argparse.ArgumentParser(description="Build static preview of the frostline WeeWX skin.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_DIR, help="Output directory (default: preview/)")
    parser.add_argument("--missing-optional", action="store_true", help="Simulate missing optional sensors (extraTemp1, lightning)")
    parser.add_argument("--stale", action="store_true", help="Simulate a stale station timestamp (45 min old) to test red offline status")
    parser.add_argument("--serve", type=int, nargs="?", const=8765, help="Start local HTTP preview server on PORT (default: 8765)")
    args = parser.parse_args()

    demo_overrides = {
        "station_code": "HBR",
        "tide_title": "Local Tides",
        "tide_station_name": "Harborview Cove",
        "tide_provider": "harmonic",
        "show_tides": "true",
        "show_wear_running": "true",
        "show_wear_sar": "true",
        "stale_threshold_minutes": "0",
    }
    written = render_preview(
        args.output,
        missing_optional=args.missing_optional,
        stale=args.stale,
        extra_overrides=demo_overrides,
    )
    print(f"Generated {len(written)} preview files in {args.output}")
    if args.serve is not None:
        serve_directory(args.output, args.serve)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
