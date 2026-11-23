#!/usr/bin/env python3
"""Automated regression test suite for the frostline WeeWX v5 skin."""

from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import unittest
import xml.etree.ElementTree as ET


REPO_ROOT = Path(__file__).resolve().parent.parent
SKIN_DIR = REPO_ROOT / "frostline"
SCRIPTS_DIR = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import build_preview  # noqa: E402


class TestFrostlineSkin(unittest.TestCase):
    def test_skin_conf_structure_and_files(self) -> None:
        skin_conf = SKIN_DIR / "skin.conf"
        self.assertTrue(skin_conf.is_file(), "skin.conf missing")
        raw_text = skin_conf.read_text(encoding="utf-8")
        self.assertRegex(raw_text, r"(?m)^\[Units\]")
        self.assertRegex(raw_text, r"(?m)^\s*group_rain\s*=\s*mm\s*$")
        self.assertRegex(raw_text, r"(?m)^\s*group_rainrate\s*=\s*mm_per_hour\s*$")
        for inherited in ("group_temperature", "group_speed", "group_pressure"):
            self.assertNotIn(inherited, raw_text, f"skin.conf must inherit {inherited} from weewx.conf")

        extras, templates, copy_globs = build_preview.parse_skin_conf(skin_conf)
        self.assertIn("station_code", extras)
        self.assertEqual(extras.get("stale_threshold_minutes"), "15")
        self.assertEqual(extras.get("show_alerts"), "true")
        self.assertEqual(extras.get("show_station_health"), "true")
        self.assertEqual(extras.get("show_quip"), "true")
        self.assertEqual(extras.get("quip_tone"), "snarky")
        self.assertEqual(extras.get("show_tides"), "true")
        self.assertEqual(extras.get("show_air_quality"), "true")
        self.assertEqual(extras.get("show_wear_running"), "false")
        self.assertEqual(extras.get("show_wear_sar"), "false")
        self.assertEqual(extras.get("rain_units"), "auto")
        self.assertEqual(extras.get("tide_provider"), "auto")
        self.assertEqual(extras.get("aqi_standard"), "auto")
        self.assertIn("records.html.tmpl", templates)
        self.assertIn("wear.html.tmpl", templates)
        self.assertIn("station.html.tmpl", templates)
        self.assertGreaterEqual(len(templates), 10)
        for tmpl in templates:
            self.assertTrue((SKIN_DIR / tmpl).is_file(), f"Missing template: {tmpl}")

        self.assertTrue(copy_globs, "No copy_once globs configured")
        for pattern in copy_globs:
            matches = list(SKIN_DIR.glob(pattern))
            self.assertTrue(matches, f"copy_once glob matched no files: {pattern}")

    def test_cheetah_directives_balanced_and_valid(self) -> None:
        pairs = {"if": "end if", "for": "end for", "def": "end def", "try": "end try"}
        open_re = re.compile(r"^#(if|for|def|try)\b")
        close_re = re.compile(r"^#(end\s+(?:if|for|def|try))\b")
        bad_dollar_re = re.compile(r"\$(?:None|True|False|float|int|round|str|math|json)\b")

        for tmpl in sorted(SKIN_DIR.rglob("*.tmpl")):
            stack: list[tuple[str, int]] = []
            for lineno, raw_line in enumerate(tmpl.read_text(encoding="utf-8").splitlines(), 1):
                line = raw_line.strip()
                if line.startswith("##"):
                    continue
                m_open = open_re.match(line)
                if m_open:
                    stack.append((m_open.group(1), lineno))
                else:
                    m_close = close_re.match(line)
                    if m_close:
                        norm = " ".join(m_close.group(1).split())
                        self.assertTrue(stack, f"{tmpl.name}:{lineno}: unexpected #{norm}")
                        top, start_line = stack.pop()
                        self.assertEqual(
                            norm,
                            pairs[top],
                            f"{tmpl.name}:{lineno}: #{norm} mismatched #{top} on line {start_line}",
                        )
                self.assertIsNone(
                    bad_dollar_re.search(line),
                    f"{tmpl.name}:{lineno}: invalid Cheetah builtin prefix",
                )
            self.assertEqual(stack, [], f"{tmpl.name}: unclosed Cheetah blocks: {stack}")

    def test_render_preview_full_sensors(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            build_preview.render_preview(out, missing_optional=False)

            index_html = (out / "index.html").read_text(encoding="utf-8")
            charts_html = (out / "charts.html").read_text(encoding="utf-8")
            records_html = (out / "records.html").read_text(encoding="utf-8")
            wear_html = (out / "wear.html").read_text(encoding="utf-8")
            station_html = (out / "station.html").read_text(encoding="utf-8")

            for html in (index_html, charts_html, records_html, wear_html, station_html):
                self.assertIn('<meta name="color-scheme" content="light dark">', html)
                self.assertIn('localStorage.getItem("color-scheme")', html)
                self.assertIn('id="theme-select"', html)
                self.assertIn('href="records.html"', html)
                self.assertIn('href="wear.html"', html)
                self.assertIn('href="station.html"', html)
                self.assertIn("frostline-logo.svg?v=", html)
                self.assertIn('class="brand-mark"', html)
                self.assertIn("FROST", html)
                self.assertIn("LINE", html)
                self.assertNotIn("brand-chevron", html)
                self.assertIn("window.FROSTLINE_CONFIG =", html)
                match = re.search(r"window\.FROSTLINE_CONFIG\s*=\s*(\{.*?\});", html)
                self.assertIsNotNone(match, "Embedded FROSTLINE_CONFIG missing")
                cfg = json.loads(match.group(1))
                self.assertIn("page", cfg)

            dash_match = re.search(r"window\.FROSTLINE_CONFIG\s*=\s*(\{.*?\});", index_html)
            dash_cfg = json.loads(dash_match.group(1))
            self.assertEqual(dash_cfg["staleThresholdMinutes"], 15)
            self.assertTrue(dash_cfg["showAlerts"])
            self.assertTrue(dash_cfg["showQuip"])
            self.assertEqual(dash_cfg["quipTone"], "snarky")
            self.assertTrue(dash_cfg["showTides"])
            self.assertTrue(dash_cfg["showAirQuality"])
            self.assertGreaterEqual(len(dash_cfg["tides"]["events"]), 4)
            self.assertEqual(dash_cfg["currentObs"]["outTemp"], 4.3)
            self.assertLess(abs(time.time() - dash_cfg["lastReportEpoch"]), 300)

            self.assertNotIn("5-in-1 Weather Station", index_html)
            self.assertIn("has-top-status-bar", index_html)
            self.assertIn('<a href="charts.html?metric=temperature&amp;period=today" class="hero-temp"', index_html)
            self.assertIn("Feels like", index_html)
            self.assertIn("2.4 °C", index_html)
            self.assertIn("baro-trend", index_html)
            self.assertIn('id="alerts-region"', index_html)
            self.assertIn('id="quip-banner"', index_html)
            self.assertIn('id="quip-tone-select"', index_html)
            self.assertIn('data-forecast-mode="hourly"', index_html)
            self.assertIn('data-forecast-mode="daily"', index_html)
            self.assertIn("lightning-status-pill", index_html)
            self.assertIn('id="tide-events-grid"', index_html)
            self.assertIn('id="aqi-hero-value"', index_html)
            self.assertLess(
                index_html.index('data-card-id="air-quality"'),
                index_html.index('data-card-id="local-tides"'),
            )
            self.assertNotIn('data-card-id="station-health"', index_html)
            self.assertNotIn('data-card-id="secondary-tower"', index_html)
            self.assertNotIn('data-card-id="location-details"', index_html)
            self.assertIn("embed.windy.com/embed2.html", index_html)

            self.assertIn("5-in-1 Weather Station", station_html)
            self.assertIn("Station Health", station_html)
            self.assertIn("Lightning Tower Status", station_html)
            self.assertIn("Location Details", station_html)
            self.assertIn("98%", station_html)
            self.assertIn("4.62 V", station_html)
            self.assertIn("Lightning Tower", station_html)
            self.assertLess(
                station_html.index("5-in-1 Weather Station"),
                station_html.index("Lightning Tower"),
            )
            self.assertIn("data-sensor-status", station_html)
            self.assertIn("3.3", station_html)
            self.assertIn("99%", station_html)
            self.assertIn("0 Strikes", station_html)
            self.assertNotIn('class="sensor-card card-lightning"', station_html)

            self.assertIn('id="wear-regular-card"', wear_html)
            self.assertNotIn('id="wear-running-card"', wear_html)
            self.assertNotIn('id="wear-sar-card"', wear_html)
            self.assertIn('id="weather-chart"', charts_html)
            self.assertIn('integrity="sha384-vsrfeLOOY6KuIYKDlmVH5UiBmgIdB1oEf7p01YgWHuqmOHfZr374+odEv96n9tNC"', charts_html)
            self.assertIn('crossorigin="anonymous"', charts_html)
            self.assertIn('value="lightning"', charts_html)
            self.assertIn('data-period-panel="alltime"', records_html)
            self.assertIn('data-period-panel="year"', records_html)
            self.assertIn('data-period-panel="month"', records_html)
            self.assertIn('data-period-panel="today"', records_html)
            self.assertIn("31.4 °C", records_html)

            cur = json.loads((out / "data/current.json").read_text(encoding="utf-8"), parse_constant=self._reject_nan)
            self.assertEqual(cur["current"]["outTemp"], 4.3)
            self.assertEqual(cur["current"]["feelsLike"], 2.4)
            self.assertEqual(cur["current"]["barometerTrend"], 1.4)
            self.assertEqual(cur["current"]["rxCheckPercent"], 98.0)
            self.assertEqual(cur["current"]["txBatteryStatus"], 0)
            self.assertEqual(cur["current"]["secondaryTemp"], 3.3)
            self.assertEqual(cur["station"]["lat"], 44.65)

            for period in ("today", "week", "month", "year"):
                pdata = json.loads(
                    (out / f"data/{period}.json").read_text(encoding="utf-8"),
                    parse_constant=self._reject_nan,
                )
                self.assertEqual(pdata["period"], period)
                for key in ("temperature", "rain", "humidity", "wind", "barometer", "dewpoint", "lightning"):
                    self.assertIn(key, pdata["stats"])
                    self.assertTrue(pdata["stats"][key], f"{period} missing stats for {key}")
                for series_key in ("outTemp", "dewpoint", "rain", "rainRate", "outHumidity", "windSpeed", "windGust", "barometer", "towerTemp", "towerHumidity", "lightningStrikes"):
                    self.assertIn(series_key, pdata["series"])
                    self.assertGreater(len(pdata["series"][series_key]["timestamps"]), 0)
                self.assertIn("lightningDistance", pdata["series"])
                rain_series = pdata["series"]["rain"]
                self.assertEqual(rain_series["chartType"], "rain-combo")
                self.assertEqual(rain_series["unit"], "mm")
                self.assertIn("cumulativeValues", rain_series)
                self.assertEqual(len(rain_series["cumulativeValues"]), len(rain_series["values"]))
                if period != "today":
                    self.assertGreater(rain_series["cumulativeValues"][-1], 0)

    def test_render_preview_missing_optional_sensors_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            build_preview.render_preview(out, missing_optional=True)

            index_html = (out / "index.html").read_text(encoding="utf-8")
            station_html = (out / "station.html").read_text(encoding="utf-8")
            records_html = (out / "records.html").read_text(encoding="utf-8")
            self.assertIn("4.3", index_html)
            self.assertIn("20.5", station_html)  # Fallback to inTemp
            self.assertIn("45%", station_html)   # Fallback to inHumidity
            self.assertIn("0 Strikes", station_html)
            self.assertIn("N/A", station_html)
            self.assertIn("Station Health", station_html)
            self.assertIn("All-Time", records_html)

            today = json.loads(
                (out / "data/today.json").read_text(encoding="utf-8"),
                parse_constant=self._reject_nan,
            )
            self.assertEqual(today["series"]["towerTemp"]["values"][0], 20.5)

    def test_render_preview_stale_station(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            build_preview.render_preview(out, stale=True)

            index_html = (out / "index.html").read_text(encoding="utf-8")
            match = re.search(r"window\.FROSTLINE_CONFIG\s*=\s*(\{.*?\});", index_html)
            self.assertIsNotNone(match)
            cfg = json.loads(match.group(1))
            self.assertGreater(time.time() - cfg["lastReportEpoch"], 1800)

            cur = json.loads(
                (out / "data/current.json").read_text(encoding="utf-8"),
                parse_constant=self._reject_nan,
            )
            self.assertEqual(cur["generated"], cfg["lastReportEpoch"])

    def test_css_light_and_dark_theme_tokens(self) -> None:
        css = (SKIN_DIR / "assets/css/style.css").read_text(encoding="utf-8")
        self.assertIn("color-scheme: light dark;", css)
        self.assertIn("@media (prefers-color-scheme: light)", css)
        self.assertIn('[data-theme="light"]', css)
        self.assertIn('[data-theme="dark"]', css)
        self.assertIn(':root:not([data-theme="dark"])', css)
        self.assertNotIn(':has(> head > meta[name="color-scheme"]', css)
        self.assertIn("--status-red", css)
        self.assertIn(".is-stale", css)
        self.assertIn("overflow-x: clip;", css)
        for token in ("#0B0D0E", "#1A1D1E", "#222526", "#2D3133", "#00A8E8", "#6CC04A", "#7AC143"):
            self.assertIn(token, css, f"Missing dark palette color {token}")

    def test_javascript_syntax(self) -> None:
        for js_file in sorted((SKIN_DIR / "assets/js").glob("*.js")):
            proc = subprocess.run(["node", "--check", str(js_file)], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, f"JS syntax error in {js_file.name}: {proc.stderr}")
        app_js = (SKIN_DIR / "assets/js/app.js").read_text(encoding="utf-8")
        self.assertIn("alert_text_en", app_js)
        self.assertIn("dedupeAlerts", app_js)
        self.assertIn("initWeatherQuip", app_js)
        self.assertIn("classifyQuipBucket", app_js)
        self.assertNotIn(".innerHTML", app_js, "app.js must use safe DOM APIs instead of innerHTML")

    def test_javascript_behavioral_units(self) -> None:
        app_js_path = SKIN_DIR / "assets/js/app.js"
        script = """
const assert = require("node:assert/strict");
const fs = require("node:fs");
global.window = {
  FROSTLINE_CONFIG: { units: { tempType: "degree_C", tempLabel: "°C", windType: "km_per_hour", windLabel: "km/h", rainType: "mm" } },
  addEventListener() {},
  setInterval() {}
};
global.document = {
  documentElement: { getAttribute: () => null, setAttribute() {}, removeAttribute() {} },
  addEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => []
};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
eval(fs.readFileSync(process.argv[1], "utf8"));
const T = global.window.__FROSTLINE_TEST__;
assert.ok(T, "__FROSTLINE_TEST__ hook missing");

// 1. ECCC alert parsing, title-casing,alert_text_en extraction, and deduplication
const sampleGeoJson = {
  features: [
    {
      id: "zone-1",
      properties: {
        alert_name_en: "special weather statement",
        alert_text_en: "Heavy rainfall 30 to 50 mm expected across Nova Scotia.",
        feature_name_en: "Kings County",
        publication_datetime: "2026-11-22T19:45:00Z",
        expiration_datetime: "2099-11-23T11:45:00Z"
      }
    },
    {
      id: "zone-2",
      properties: {
        alert_name_en: "special weather statement",
        alert_text_en: "Heavy rainfall 30 to 50 mm expected across Nova Scotia.",
        feature_name_en: "Hants County",
        publication_datetime: "2026-11-22T19:45:00Z",
        expiration_datetime: "2099-11-23T11:45:00Z"
      }
    }
  ]
};
const parsedAlerts = T.normalizeCanadaAlerts(sampleGeoJson);
assert.equal(parsedAlerts.length, 2);
assert.equal(parsedAlerts[0].title, "Special Weather Statement");
assert.equal(parsedAlerts[0].area, "Kings County");
assert.ok(parsedAlerts[0].description.includes("30 to 50 mm"));
assert.ok(parsedAlerts[0].url.startsWith("https://weather.gc.ca/"));
const deduped = T.dedupeAlerts(parsedAlerts);
assert.equal(deduped.length, 1);

// 2. Quip library completeness & bucket classification
for (const [bucket, tones] of Object.entries(T.QUIP_LIBRARY)) {
  for (const tone of ["clean", "snarky", "unfiltered"]) {
    assert.ok(Array.isArray(tones[tone]) && tones[tone].length >= 3, `${bucket}.${tone} missing 3 entries`);
    for (const item of tones[tone]) {
      assert.ok(item.h && item.s, `${bucket}.${tone} entry missing h or s`);
    }
  }
}
assert.equal(T.classifyQuipBucket({ tempC: 4.3, feelsLikeC: 2.4, humidity: 93, windKmh: 6, windGustKmh: 11, rainRateMmH: 0, lightningStrikes: 0 }, null), "chilly_damp");
assert.equal(T.classifyQuipBucket({ tempC: -1, feelsLikeC: -5, humidity: 90, windKmh: 20, windGustKmh: 30, rainRateMmH: 2.0, lightningStrikes: 0 }, null), "freezing_rain");
assert.equal(T.classifyQuipBucket({ tempC: 8, feelsLikeC: 4, humidity: 70, windKmh: 45, windGustKmh: 62, rainRateMmH: 0, lightningStrikes: 0 }, null), "gale");
assert.equal(T.classifyQuipBucket({ tempC: 21, feelsLikeC: 21, humidity: 50, windKmh: 10, windGustKmh: 14, rainRateMmH: 0, lightningStrikes: 0 }, { weather_code: 1, cloud_cover: 20 }), "nice");

// 3. Regular Day & Running outfit logic
const coldSlot = { tempC: 4.3, feelsC: 2.4, windKmh: 15, humidity: 93, isRaining: false, isSnowing: false, isSunny: false, isDay: true };
const regCold = T.buildRegularOutfit(coldSlot);
assert.equal(regCold.length, 6);
const runAvg = T.buildRunningOutfit(coldSlot, 0, 0);
const runWarmer = T.buildRunningOutfit(coldSlot, 3, 0);
const runCooler = T.buildRunningOutfit(coldSlot, -3, 0);
const runRace = T.buildRunningOutfit(coldSlot, 0, 2);
assert.equal(runAvg.items.length, 5);
assert.equal(runAvg.runFeelC, 12.4);
assert.equal(runWarmer.runFeelC, 9.4);
assert.equal(runCooler.runFeelC, 15.4);
assert.equal(runRace.runFeelC, 14.4);
assert.ok(runWarmer.runFeelC < runAvg.runFeelC);
assert.ok(runCooler.runFeelC > runAvg.runFeelC);
assert.ok(runRace.runFeelC > runAvg.runFeelC);

const mildSlot = { tempC: 10.4, feelsC: 9.9, windKmh: 1, humidity: 80, isRaining: false, isSnowing: false, isSunny: false, isDay: true };
const runMildAvg = T.buildRunningOutfit(mildSlot, 0, 0);
const runMildWarmer = T.buildRunningOutfit(mildSlot, 3, 0);
assert.ok(runMildAvg.items.some((x) => x.item.includes("Short-Sleeve Technical T-Shirt")));
assert.ok(runMildAvg.items.some((x) => x.item.includes('5"–7" Running Shorts')));
assert.ok(runMildWarmer.items.some((x) => x.item.includes("Long-Sleeve Technical Running Shirt")));

const warmSlot = { tempC: 17, feelsC: 16, windKmh: 5, humidity: 55, isRaining: false, isSnowing: false, isSunny: true, isDay: true };
const runWarmAvg = T.buildRunningOutfit(warmSlot, 0, 0);
assert.ok(runWarmAvg.items.some((x) => x.item.includes("Singlet")));
assert.ok(runWarmAvg.items.some((x) => x.item.includes("Split Shorts")));

// 3b. Search & Rescue 12-hour Wear vs Pack loadout & role toggles
const sarEnv = T.computeSar12hEnvelope(coldSlot, null);
assert.ok(sarEnv.minFeelsC < coldSlot.feelsC);
assert.equal(sarEnv.freezeTransition, true);
const sarHasty = T.buildSarLoadout(coldSlot, sarEnv, "hasty");
const sarGrid = T.buildSarLoadout(coldSlot, sarEnv, "grid");
const sarStatic = T.buildSarLoadout(coldSlot, sarEnv, "static");
assert.equal(sarGrid.wearNow.length, 5);
assert.equal(sarGrid.pack12h.length, 5);
assert.ok(sarHasty.moveFeelC > sarGrid.moveFeelC);
assert.ok(sarGrid.moveFeelC > sarStatic.moveFeelC);
assert.ok(sarGrid.pack12h.some((x) => x.item.includes("Microspikes")));

// 4. Daily forecast range bar, Tide cosine interpolation & AQI classification
const fullBar = T.computeDailyRangeBar(2, 14, 2, 14);
assert.equal(fullBar.leftPct, 0);
assert.equal(fullBar.widthPct, 100);
const midBar = T.computeDailyRangeBar(5, 11, 2, 14);
assert.equal(midBar.leftPct, 25);
assert.equal(midBar.widthPct, 50);
const flatBar = T.computeDailyRangeBar(8, 8, 8, 8);
assert.equal(flatBar.widthPct, 100);

const tideEvents = [
  { ms: 1000, value: 1.4, type: "low" },
  { ms: 2000, value: 12.6, type: "high" }
];
const midTide = T.interpolateTideHeight(tideEvents, 1500);
assert.ok(Math.abs(midTide.height - 7.0) < 1e-6);
assert.equal(midTide.rising, true);
assert.equal(T.classifyAqiTier(32).label, "Good");
assert.equal(T.classifyAqiTier(78).label, "Moderate");
assert.equal(T.classifyAqiTier(130).label, "Sensitive");
assert.equal(T.classifyAqiTier(175).label, "Unhealthy");
"""
        proc = subprocess.run(
            ["node", "-e", script, str(app_js_path)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, f"JS behavioral unit test failed: {proc.stderr}")

    def test_render_preview_feature_toggles_disabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            build_preview.render_preview(
                out,
                extra_overrides={
                    "show_lightning": "false",
                    "show_windy": "false",
                    "show_forecast": "false",
                    "show_alerts": "false",
                    "show_quip": "false",
                    "show_tides": "false",
                    "show_air_quality": "false",
                    "show_station_health": "false",
                },
            )
            index_html = (out / "index.html").read_text(encoding="utf-8")
            station_html = (out / "station.html").read_text(encoding="utf-8")
            self.assertNotIn('id="alerts-region"', index_html)
            self.assertNotIn('id="quip-banner"', index_html)
            self.assertNotIn("lightning-status-pill", index_html)
            self.assertNotIn("data-forecast-mode", index_html)
            self.assertNotIn('data-card-id="local-tides"', index_html)
            self.assertNotIn('data-card-id="air-quality"', index_html)
            self.assertNotIn("embed.windy.com/embed2.html", index_html)
            self.assertNotIn('data-card-id="station-health"', station_html)
            self.assertNotIn('data-card-id="lightning"', station_html)

            build_preview.render_preview(
                out,
                extra_overrides={
                    "extra_sensors": "Greenhouse:inTemp:inHumidity:txBatteryStatus",
                    "tide_title": "Oceanview Harbour Tides",
                    "tide_provider": "noaa",
                    "tide_station_id": "8410140",
                    "tide_units": "ft",
                    "rain_units": "inch",
                    "aqi_standard": "ca_aqhi",
                    "show_wear_running": "true",
                    "show_wear_sar": "true",
                },
            )
            custom_index = (out / "index.html").read_text(encoding="utf-8")
            custom_station = (out / "station.html").read_text(encoding="utf-8")
            custom_wear = (out / "wear.html").read_text(encoding="utf-8")
            self.assertIn("Oceanview Harbour Tides", custom_index)
            self.assertIn("NOAA Tides &amp; Currents (#8410140)", custom_index)
            self.assertIn("CA AQHI", custom_index)
            self.assertIn("Greenhouse", custom_station)
            self.assertIn("Greenhouse Status", custom_station)
            self.assertIn('id="wear-running-card"', custom_wear)
            self.assertIn('id="wear-sar-card"', custom_wear)
            self.assertIn('id="sar-wear-list"', custom_wear)
            self.assertIn('id="sar-pack-list"', custom_wear)
            self.assertIn("metabolic warm-up", custom_wear)

    def test_extension_installer_manifest(self) -> None:
        import importlib.util
        import types

        fake_weecfg = types.ModuleType("weecfg")
        fake_ext = types.ModuleType("weecfg.extension")

        class _StubExtensionInstaller:
            def __init__(self, **kwargs):
                for key, val in kwargs.items():
                    setattr(self, key, val)

        fake_ext.ExtensionInstaller = _StubExtensionInstaller
        fake_weecfg.extension = fake_ext
        prev_weecfg = sys.modules.get("weecfg")
        prev_ext = sys.modules.get("weecfg.extension")
        sys.modules["weecfg"] = fake_weecfg
        sys.modules["weecfg.extension"] = fake_ext
        try:
            spec = importlib.util.spec_from_file_location("frostline_install", REPO_ROOT / "install.py")
            mod = importlib.util.module_from_spec(spec)
            assert spec and spec.loader
            spec.loader.exec_module(mod)
            installer = mod.loader()
        finally:
            if prev_weecfg is not None:
                sys.modules["weecfg"] = prev_weecfg
            else:
                sys.modules.pop("weecfg", None)
            if prev_ext is not None:
                sys.modules["weecfg.extension"] = prev_ext
            else:
                sys.modules.pop("weecfg.extension", None)

        self.assertEqual(installer.version, "1.0.0")
        self.assertEqual(installer.name, "frostline")
        frostline_cfg = installer.config["StdReport"]["Frostline"]
        self.assertEqual(frostline_cfg["skin"], "frostline")
        self.assertEqual(frostline_cfg["HTML_ROOT"], "public_html/frostline")
        self.assertEqual(frostline_cfg["Extras"]["show_wear_running"], "false")
        self.assertEqual(frostline_cfg["Extras"]["show_wear_sar"], "false")

        installed_paths: set[str] = set()
        for dest_dir, src_list in installer.files:
            for src in src_list:
                self.assertTrue(src.startswith("skins/frostline/"), f"Unexpected source path: {src}")
                rel_from_skin = src[len("skins/frostline/") :]
                self.assertTrue((SKIN_DIR / rel_from_skin).is_file(), f"Missing packaged file: {src}")
                self.assertEqual(
                    str(Path(dest_dir) / Path(src).name),
                    src,
                    f"Destination directory {dest_dir} must match parent of {src}",
                )
                installed_paths.add(rel_from_skin)

        expected_skin_files = {
            str(p.relative_to(SKIN_DIR))
            for p in SKIN_DIR.rglob("*")
            if p.is_file() and p.name != ".DS_Store" and "__pycache__" not in p.parts
        }
        self.assertEqual(installed_paths, expected_skin_files)

    def test_svg_icons_well_formed(self) -> None:
        svgs = sorted((SKIN_DIR / "assets/icons").glob("*.svg"))
        self.assertGreaterEqual(len(svgs), 12)
        self.assertIn("frostline-logo.svg", [s.name for s in svgs])
        for svg in svgs:
            ET.parse(svg)

    @staticmethod
    def _reject_nan(constant: str) -> None:
        raise ValueError(f"Invalid non-standard JSON constant: {constant}")


if __name__ == "__main__":
    unittest.main()
