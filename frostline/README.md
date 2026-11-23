# `frostline` — WeeWX v5 Skin

A responsive, adaptive dark/light WeeWX v5 weather dashboard featuring interactive Chart.js v4 historical graphs, **All-Time Records**, live **Weather Alerts** with 3-day history, client-side **Open-Meteo** hourly/7-day forecasts & Air Quality, an embedded **Windy.com** live radar panel, toggleable tidal predictions, **What to Wear**, and multi-sensor **Station** telemetry.

> **Note:** Built for personal use and shared as-is under the MIT License (no individual troubleshooting support is provided). See the root `README.md` for screenshots, live demo, privacy notes, and full details.

## Installation (WeeWX v5)

### Recommended: `weectl extension install`

```bash
weectl extension install https://github.com/glasspear/weewx-frostline/releases/download/v1.0.0/weewx-frostline-v1.0.0.tar.gz
```

### Fallback: Manual Copy

Copy this `frostline/` directory into your WeeWX `skins/` directory and add `[[Frostline]]` under `[StdReport]` in `weewx.conf`:

```ini
[StdReport]
    [[Frostline]]
        skin = frostline
        HTML_ROOT = public_html/frostline
        enable = true
        [[[Extras]]]
            station_code = ""
            primary_sensor_title = 5-in-1 Weather Station
            secondary_sensor_title = Secondary Sensor
            show_secondary = false
            show_lightning = false
            show_windy = true
            windy_overlay = radar
            windy_zoom = 8
            show_forecast = true
            show_alerts = true
            alerts_provider = auto
            show_station_health = true
            show_quip = true
            quip_tone = snarky
            show_air_quality = true
            aqi_standard = auto
            show_tides = false
            show_wear_running = false
            show_wear_sar = false
            rain_units = auto
```

Run `weectl report run Frostline` to generate `index.html`, `charts.html`, `records.html`, `wear.html`, `station.html`, `data/*.json`, and `assets/`.

## Configuration Options (`[[[Extras]]]`)

| Option | Default | Description |
| :--- | :--- | :--- |
| `station_code` | *(empty)* | Short station badge shown in the top navigation bar (falls back to `$station.location` if blank). |
| `brand_prefix` | *(empty)* | Optional lowercase italic prefix before the wordmark. |
| `brand_primary` | `FROST` | First half of the top-bar brand wordmark (`FROSTLINE`). |
| `brand_secondary` | `LINE` | Second half of the top-bar brand wordmark (`FROSTLINE`). |
| `primary_sensor_title` | `5-in-1 Weather Station` | Title for the primary sensor card on the `Station` tab and `Charts` selector. |
| `secondary_sensor_title` | `Lightning Tower` | Title for the secondary sensor card on the `Station` tab and `Charts` selector. |
| `show_secondary` | `true` (`false` via installer) | Set to `false` to hide the secondary sensor card for single-sensor setups. |
| `extra_sensors` | *(empty)* | Comma-separated list of additional sensor stations (`Title:tempObs:humidObs:batteryObs`, e.g. `Greenhouse:extraTemp2:extraHumid2:batteryStatus2`). |
| `show_lightning` | `true` (`false` via installer) | Set to `false` to hide lightning metrics and the hero lightning status badge. |
| `show_windy` | `true` | Set to `false` to disable the Windy.com radar embed. |
| `windy_overlay` | `radar` | Initial Windy map layer (`radar`, `wind`, `temp`, `rain`, `clouds`, `pressure`). |
| `windy_zoom` | `8` | Initial Windy map zoom level. |
| `show_forecast` | `true` | Set to `false` to hide the Open-Meteo Hourly / 7-Day forecast card. |
| `show_alerts` | `true` | Set to `false` to disable the Weather Alerts banner. |
| `alerts_provider` | `auto` | Alert feed source: `auto` (US NWS or Environment Canada by coordinates), `canada`, or `us`. |
| `show_station_health` | `true` | Set to `false` to hide per-station health & telemetry blocks on `station.html`. |
| `show_quip` | `true` | Set to `false` to hide the inline weather commentary bar. |
| `quip_tone` | `snarky` | Default commentary tone (`clean`, `snarky`, or `unfiltered`). Overridable in the UI. |
| `show_wear_running` | `false` | Set to `true` in `weewx.conf` to enable the configurable **Running Kit** card on `wear.html`. |
| `show_wear_sar` | `false` | Set to `true` in `weewx.conf` to enable the **Search & Rescue (GSAR 12-Hour Callout)** card on `wear.html`. |
| `rain_units` | `auto` | Rain display units: `auto` (keeps `in` for US Imperial, normalizes `cm`/`mm` to `mm`), `mm`, or `inch`. |
| `show_air_quality` | `true` | Set to `false` to hide the Air Quality & UV card. |
| `aqi_standard` | `auto` | Air quality index standard: `auto` (`US AQI` in Americas, `EAQI` in Europe/RoW), `us_aqi`, `ca_aqhi` (Canadian 1-10+), or `european_aqi`. |
| `show_tides` | `true` (`false` via installer) | Set to `false` to hide the Tides card for inland stations. |
| `tide_provider` | `auto` | Tide API provider: `auto` (DFO IWLS for hex IDs, NOAA CO-OPS for 7-digit IDs, else harmonic), `dfo`, `noaa`, or `harmonic`. |
| `tide_units` | `auto` | Tide height unit: `auto` (`ft` for Fahrenheit stations, `m` for Celsius), `m`, or `ft`. |
| `tide_title` | `Local Tides` | Card header title for the Tides card (e.g. `Local Tides`, `Harbour Tides`). |
| `tide_station_name` | `Local Harbour` | Display label for the tide station badge. |
| `tide_station_code` | *(empty)* | Optional CHS tide station code used for DFO attribution and cache naming. |
| `tide_station_id` | *(empty)* | DFO IWLS station ObjectId (Canada) or 7-digit NOAA CO-OPS station ID (US, e.g. `8410140`). |
| `stale_threshold_minutes` | `15` | Minutes since last archive update before the sensor status bar turns red (`Offline`). |
| `asset_version` | `20261123-9` | Cache-busting query string for CSS, JS, and icons. |
| `chartjs_cdn` | jsDelivr Chart.js 4.4.7 | Override or host Chart.js locally (`assets/js/chart-fallback.js` renders automatically if unreachable). |
| `chartjs_sri` | SHA-384 hash | Optional SRI hash for custom `chartjs_cdn` overrides (auto-populated for default jsDelivr Chart.js 4.4.7). |
