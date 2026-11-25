"""WeeWX v5 extension installer for the Frostline skin."""

from weecfg.extension import ExtensionInstaller


def loader():
    return FrostlineInstaller()


class FrostlineInstaller(ExtensionInstaller):
    def __init__(self):
        super().__init__(
            version="1.1.1",
            name="frostline",
            description=(
                "Responsive dark/light dashboard, Chart.js graphs, Weather Alerts, "
                "Records, What to Wear, Air Quality, Tides, and multi-sensor Station telemetry."
            ),
            author="Rory",
            author_email="",
            config={
                "StdReport": {
                    "Frostline": {
                        "skin": "frostline",
                        "enable": "true",
                        "HTML_ROOT": "public_html/frostline",
                        "Extras": {
                            "station_code": "",
                            "primary_sensor_title": "5-in-1 Weather Station",
                            "secondary_sensor_title": "Secondary Sensor",
                            "show_secondary": "false",
                            "extra_sensors": "",
                            "show_lightning": "false",
                            "show_alerts": "true",
                            "alerts_provider": "auto",
                            "show_forecast": "true",
                            "show_windy": "true",
                            "windy_overlay": "radar",
                            "windy_zoom": "8",
                            "show_air_quality": "true",
                            "aqi_standard": "auto",
                            "show_tides": "false",
                            "tide_provider": "auto",
                            "tide_units": "auto",
                            "tide_title": "Local Tides",
                            "tide_station_name": "Local Harbour",
                            "tide_station_code": "",
                            "tide_station_id": "",
                            "show_quip": "true",
                            "quip_tone": "snarky",
                            "show_station_health": "true",
                            "show_wear_running": "false",
                            "show_wear_sar": "false",
                            "rain_units": "auto",
                        },
                    }
                }
            },
            files=[
                (
                    "skins/frostline",
                    [
                        "skins/frostline/skin.conf",
                        "skins/frostline/README.md",
                        "skins/frostline/index.html.tmpl",
                        "skins/frostline/charts.html.tmpl",
                        "skins/frostline/records.html.tmpl",
                        "skins/frostline/wear.html.tmpl",
                        "skins/frostline/station.html.tmpl",
                    ],
                ),
                (
                    "skins/frostline/data",
                    [
                        "skins/frostline/data/current.json.tmpl",
                        "skins/frostline/data/today.json.tmpl",
                        "skins/frostline/data/week.json.tmpl",
                        "skins/frostline/data/month.json.tmpl",
                        "skins/frostline/data/year.json.tmpl",
                    ],
                ),
                (
                    "skins/frostline/assets/css",
                    [
                        "skins/frostline/assets/css/style.css",
                    ],
                ),
                (
                    "skins/frostline/assets/js",
                    [
                        "skins/frostline/assets/js/app.js",
                        "skins/frostline/assets/js/chart-fallback.js",
                    ],
                ),
                (
                    "skins/frostline/assets/icons",
                    [
                        "skins/frostline/assets/icons/barometer.svg",
                        "skins/frostline/assets/icons/cloud-download.svg",
                        "skins/frostline/assets/icons/dewpoint-leaf.svg",
                        "skins/frostline/assets/icons/frostline-logo.svg",
                        "skins/frostline/assets/icons/home.svg",
                        "skins/frostline/assets/icons/humidity.svg",
                        "skins/frostline/assets/icons/lightning-pin.svg",
                        "skins/frostline/assets/icons/lightning-timer.svg",
                        "skins/frostline/assets/icons/lightning-wave.svg",
                        "skins/frostline/assets/icons/thermometer.svg",
                        "skins/frostline/assets/icons/umbrella.svg",
                        "skins/frostline/assets/icons/wind-arrow.svg",
                    ],
                ),
            ],
        )
