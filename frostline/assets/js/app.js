/* ==========================================================================
   app.js — frostline WeeWX v5 client controller
   Handles theme toggle, alerts, accordions, Open-Meteo forecasts, & charts.
   ========================================================================== */
(function () {
  "use strict";

  const CFG = window.FROSTLINE_CONFIG || {};
  const CARD_STORAGE_KEY = "frostline:cards:v1";

  function makeEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function setSvgContent(container, svgMarkup) {
    if (!container) return;
    if (typeof DOMParser === "function") {
      const parsed = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
      if (parsed && parsed.documentElement && parsed.documentElement.nodeName === "svg") {
        container.replaceChildren(document.importNode(parsed.documentElement, true));
      }
    }
  }
  const WMO_CONDITIONS = {
    0: { label: "Clear sky", kind: "sun" },
    1: { label: "Mainly clear", kind: "partly" },
    2: { label: "Partly cloudy", kind: "partly" },
    3: { label: "Cloudy, overcast conditions", kind: "cloud" },
    45: { label: "Foggy conditions", kind: "fog" },
    48: { label: "Freezing fog", kind: "fog" },
    51: { label: "Light drizzle", kind: "rain" },
    53: { label: "Moderate drizzle", kind: "rain" },
    55: { label: "Dense drizzle", kind: "rain" },
    56: { label: "Light freezing drizzle", kind: "snow" },
    57: { label: "Dense freezing drizzle", kind: "snow" },
    61: { label: "Light rain", kind: "rain" },
    63: { label: "Moderate rain", kind: "rain" },
    65: { label: "Heavy rain", kind: "rain" },
    66: { label: "Light freezing rain", kind: "snow" },
    67: { label: "Heavy freezing rain", kind: "snow" },
    71: { label: "Light snow", kind: "snow" },
    73: { label: "Moderate snow", kind: "snow" },
    75: { label: "Heavy snow", kind: "snow" },
    77: { label: "Snow grains", kind: "snow" },
    80: { label: "Light rain showers", kind: "rain" },
    81: { label: "Moderate rain showers", kind: "rain" },
    82: { label: "Violent rain showers", kind: "rain" },
    85: { label: "Light snow showers", kind: "snow" },
    86: { label: "Heavy snow showers", kind: "snow" },
    95: { label: "Thunderstorm", kind: "storm" },
    96: { label: "Thunderstorm with hail", kind: "storm" },
    99: { label: "Severe thunderstorm", kind: "storm" }
  };

  const QUIP_TONE_KEY = "frostline:quip-tone:v1";
  const FORECAST_MODE_KEY = "frostline:forecast-mode:v1";
  const OM_SESSION_CACHE_KEY = "frostline:openmeteo-cache:v1";
  const OM_CACHE_TTL_MS = 10 * 60 * 1000;
  let toastTimer = null;

  function readSessionCache(key, maxAgeMs) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.ts === "number" && Date.now() - parsed.ts <= maxAgeMs && parsed.data) {
        return parsed.data;
      }
    } catch {
      // Ignore storage errors
    }
    return null;
  }

  function writeSessionCache(key, data) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch {
      // Ignore storage quota errors
    }
  }
  let forecastCache = null;
  let currentActiveSignature = "";
  let quipOffset = 0;
  let latestOpenMeteoCurrent = null;

  function showToast(message) {
    const toast = document.getElementById("status-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 3200);
  }

  /* ---------------- Card Accordions ---------------- */
  function initCardAccordions() {
    const cards = document.querySelectorAll("details.sensor-card[data-card-id]");
    if (!cards.length) return;

    let saved = {};
    try {
      const raw = localStorage.getItem(CARD_STORAGE_KEY);
      if (raw) saved = JSON.parse(raw) || {};
    } catch {
      saved = {};
    }

    cards.forEach((card) => {
      const id = card.getAttribute("data-card-id");
      if (id && Object.prototype.hasOwnProperty.call(saved, id)) {
        card.open = Boolean(saved[id]);
      }

      card.addEventListener("toggle", () => {
        if (!id) return;
        saved[id] = card.open;
        try {
          localStorage.setItem(CARD_STORAGE_KEY, JSON.stringify(saved));
        } catch {
          // Ignore storage quota or private mode errors
        }
      });
    });
  }

  /* ---------------- Weather SVG Helpers ---------------- */
  const SVG_XMLNS = 'xmlns="http://www.w3.org/2000/svg"';

  function getWeatherSvg(kind, size) {
    const s = Number.isFinite(Number(size)) ? Math.max(8, Math.round(Number(size))) : 44;
    if (kind === "sun") {
      return (
        `<svg ${SVG_XMLNS} viewBox="0 0 48 48" width="${s}" height="${s}" aria-hidden="true">` +
        `<circle cx="24" cy="24" r="9.5" fill="#FDB813"/>` +
        `<g stroke="#FDB813" stroke-width="2.6" stroke-linecap="round">` +
        `<line x1="24" y1="5" x2="24" y2="10"/>` +
        `<line x1="24" y1="38" x2="24" y2="43"/>` +
        `<line x1="5" y1="24" x2="10" y2="24"/>` +
        `<line x1="38" y1="24" x2="43" y2="24"/>` +
        `<line x1="10.6" y1="10.6" x2="14.1" y2="14.1"/>` +
        `<line x1="33.9" y1="33.9" x2="37.4" y2="37.4"/>` +
        `<line x1="37.4" y1="10.6" x2="33.9" y2="14.1"/>` +
        `<line x1="14.1" y1="33.9" x2="10.6" y2="37.4"/>` +
        `</g></svg>`
      );
    }
    if (kind === "partly") {
      return (
        `<svg ${SVG_XMLNS} viewBox="0 0 48 48" width="${s}" height="${s}" aria-hidden="true">` +
        `<circle cx="19" cy="18" r="7" fill="var(--sun-amber, #FDB813)"/>` +
        `<g stroke="var(--sun-amber, #FDB813)" stroke-width="2.2" stroke-linecap="round">` +
        `<line x1="19" y1="6" x2="19" y2="9"/>` +
        `<line x1="7" y1="18" x2="10" y2="18"/>` +
        `<line x1="10.5" y1="9.5" x2="12.8" y2="11.8"/>` +
        `<line x1="27.5" y1="9.5" x2="25.2" y2="11.8"/>` +
        `</g>` +
        `<path d="M16 37h20a7 7 0 0 0 1-13.9A9.5 9.5 0 0 0 19.3 20a7.5 7.5 0 0 0-3.3 17Z" fill="var(--bg-card, #222526)" stroke="var(--icon-cloud, #B6BBBE)" stroke-width="2.4" stroke-linejoin="round"/>` +
        `</svg>`
      );
    }
    if (kind === "rain") {
      return (
        `<svg ${SVG_XMLNS} viewBox="0 0 48 48" width="${s}" height="${s}" aria-hidden="true">` +
        `<path d="M14 29h21a6.5 6.5 0 0 0 .9-12.9 9 9 0 0 0-17.2-2.6A7 7 0 0 0 14 29Z" fill="none" stroke="var(--icon-cloud, #B6BBBE)" stroke-width="2.4" stroke-linejoin="round"/>` +
        `<path d="M19 32.5c0 1.8-2 4-2 5.5a2 2 0 1 0 4 0c0-1.5-2-3.7-2-5.5Z" fill="var(--accent-cyan, #00A8E8)"/>` +
        `<path d="M27 33.5c0 1.8-2 4-2 5.5a2 2 0 1 0 4 0c0-1.5-2-3.7-2-5.5Z" fill="var(--accent-cyan, #00A8E8)"/>` +
        `<path d="M23 37c0 1.4-1.6 3.1-1.6 4.2a1.6 1.6 0 1 0 3.2 0c0-1.1-1.6-2.8-1.6-4.2Z" fill="var(--accent-cyan, #00A8E8)"/>` +
        `</svg>`
      );
    }
    if (kind === "snow") {
      return (
        `<svg ${SVG_XMLNS} viewBox="0 0 48 48" width="${s}" height="${s}" aria-hidden="true">` +
        `<path d="M14 29h21a6.5 6.5 0 0 0 .9-12.9 9 9 0 0 0-17.2-2.6A7 7 0 0 0 14 29Z" fill="none" stroke="var(--icon-cloud, #B6BBBE)" stroke-width="2.4" stroke-linejoin="round"/>` +
        `<circle cx="18" cy="36" r="2" fill="var(--snow-flake, #E1F4FC)"/>` +
        `<circle cx="24" cy="39" r="2" fill="var(--snow-flake, #E1F4FC)"/>` +
        `<circle cx="30" cy="36" r="2" fill="var(--snow-flake, #E1F4FC)"/>` +
        `</svg>`
      );
    }
    if (kind === "storm") {
      return (
        `<svg ${SVG_XMLNS} viewBox="0 0 48 48" width="${s}" height="${s}" aria-hidden="true">` +
        `<path d="M14 28h21a6.5 6.5 0 0 0 .9-12.9 9 9 0 0 0-17.2-2.6A7 7 0 0 0 14 28Z" fill="none" stroke="var(--icon-cloud, #B6BBBE)" stroke-width="2.4" stroke-linejoin="round"/>` +
        `<polygon points="25 28 20 36 24 36 22 43 29 34 25 34" fill="var(--sun-amber, #FDB813)"/>` +
        `</svg>`
      );
    }
    if (kind === "fog") {
      return (
        `<svg ${SVG_XMLNS} viewBox="0 0 48 48" width="${s}" height="${s}" aria-hidden="true" stroke="var(--icon-cloud, #B6BBBE)" stroke-width="2.4" stroke-linecap="round">` +
        `<line x1="10" y1="18" x2="38" y2="18"/>` +
        `<line x1="8" y1="25" x2="36" y2="25"/>` +
        `<line x1="12" y1="32" x2="40" y2="32"/>` +
        `</svg>`
      );
    }
    return (
      `<svg ${SVG_XMLNS} viewBox="0 0 64 48" width="${s}" height="${Math.round(s * 0.78)}" fill="none" stroke="var(--icon-cloud, #B6BBBE)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<path d="M18 39h29a10 10 0 0 0 1.4-19.9A13.5 13.5 0 0 0 22.8 14.8 11 11 0 0 0 18 39Z"/>` +
      `</svg>`
    );
  }

  function umbrellaSvg(hasPrecip) {
    return (
      `<svg ${SVG_XMLNS} class="forecast-precip-icon ${hasPrecip ? "has-precip" : ""}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<path d="M12 4C7.2 4 3.5 7.6 3.5 12h17C20.5 7.6 16.8 4 12 4Z" fill="currentColor" fill-opacity="0.88"/>` +
      `<path d="M12 12v6.8a1.9 1.9 0 0 1-3.8 0"/>` +
      `</svg>`
    );
  }

  function windArrowSvg(deg) {
    const rot = Number.isFinite(deg) ? Math.round((deg + 180) % 360) : 0;
    return (
      `<svg ${SVG_XMLNS} class="forecast-wind-arrow" style="--wind-deg: ${rot}deg;" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">` +
      `<polygon points="12 3 19 20 12 16 5 20" fill="currentColor"/>` +
      `</svg>`
    );
  }

  function cloudCoverLabel(pct) {
    if (!Number.isFinite(pct)) return "--";
    if (pct < 10) return "Clear";
    if (pct < 30) return "Mostly clear";
    if (pct < 65) return "Partly cloudy";
    if (pct < 85) return "Mostly cloudy";
    return "Overcast";
  }

  /* ---------------- Open-Meteo Forecast & Conditions ---------------- */
  function getOpenMeteoUnitParams() {
    const units = CFG.units || {};
    const tempType = String(units.tempType || "");
    const windType = String(units.windType || "");
    const rainType = String(units.rainType || "");

    const tempParam = tempType.includes("F") ? "fahrenheit" : "celsius";
    let windParam = "kmh";
    if (windType.includes("mile")) windParam = "mph";
    else if (windType.includes("knot")) windParam = "kn";
    else if (windType.includes("meter")) windParam = "ms";

    const precipParam = rainType.includes("inch") ? "inch" : "mm";

    return {
      tempParam,
      windParam,
      precipParam,
      tempLabel: units.tempLabel || (tempParam === "fahrenheit" ? "°F" : "°C"),
      windLabel: units.windLabel || (windParam === "mph" ? "mph" : windParam === "kn" ? "kt" : "km/h")
    };
  }

  function readForecastMode() {
    try {
      const saved = localStorage.getItem(FORECAST_MODE_KEY);
      if (saved === "hourly" || saved === "daily") {
        return saved;
      }
    } catch {
      // Ignore storage errors
    }
    return "hourly";
  }

  function saveForecastMode(mode) {
    const normalized = mode === "daily" ? "daily" : "hourly";
    try {
      localStorage.setItem(FORECAST_MODE_KEY, normalized);
    } catch {
      // Ignore storage errors
    }
    return normalized;
  }

  function syncForecastModeButtons(mode) {
    const active = mode === "daily" ? "daily" : "hourly";
    document.querySelectorAll("[data-forecast-mode]").forEach((btn) => {
      const btnMode = btn.getAttribute("data-forecast-mode");
      const isSelected = btnMode === active;
      btn.classList.toggle("is-active", isSelected);
      btn.setAttribute("aria-pressed", String(isSelected));
    });
    const modeSelect = document.getElementById("forecast-mode");
    if (modeSelect && modeSelect.value !== active) {
      modeSelect.value = active;
    }
  }

  function computeDailyRangeBar(low, high, weekMin, weekMax) {
    const span = weekMax - weekMin;
    if (!Number.isFinite(span) || span <= 0) {
      return { leftPct: 0, widthPct: 100 };
    }
    const rawLeft = ((low - weekMin) / span) * 100;
    const rawRight = ((high - weekMin) / span) * 100;
    const clampedLeft = Math.max(0, Math.min(92, rawLeft));
    const clampedWidth = Math.max(8, Math.min(100 - clampedLeft, rawRight - clampedLeft));
    return {
      leftPct: Math.round(clampedLeft * 10) / 10,
      widthPct: Math.round(clampedWidth * 10) / 10
    };
  }

  function renderForecastStrip(mode) {
    const strip = document.getElementById("forecast-strip");
    const activeMode = mode === "daily" ? "daily" : "hourly";
    syncForecastModeButtons(activeMode);
    if (!strip) return;

    strip.classList.toggle("is-daily-list", activeMode === "daily");
    strip.classList.toggle("is-hourly-strip", activeMode === "hourly");
    if (!forecastCache) return;

    const unitInfo = getOpenMeteoUnitParams();
    strip.replaceChildren();

    if (activeMode === "hourly" && forecastCache.hourly) {
      const h = forecastCache.hourly;
      const nowMs = Date.now();
      let startIdx = h.time.findIndex((iso) => new Date(iso).getTime() >= nowMs - 3600000);
      if (startIdx < 0) startIdx = 0;

      const sliceEnd = Math.min(startIdx + 24, h.time.length);
      for (let i = startIdx; i < sliceEnd; i++) {
        const dt = new Date(h.time[i]);
        const isCurrentHour = i === startIdx && Math.abs(dt.getTime() - nowMs) <= 3600000;
        const label = isCurrentHour ? "Now" : dt.toLocaleTimeString([], { hour: "numeric" });
        const cond = WMO_CONDITIONS[h.weather_code[i]] || { label: "Cloudy", kind: "cloud" };
        const tempVal = Math.round(h.temperature_2m[i]);
        const precip = Math.round(h.precipitation_probability[i] || 0);
        const wind = Math.round(h.wind_speed_10m[i] || 0);
        const windDeg = h.wind_direction_10m ? h.wind_direction_10m[i] : 0;

        const tile = makeEl("div", "forecast-tile");
        tile.appendChild(makeEl("span", "forecast-day", label));

        const iconSpan = makeEl("span", "forecast-icon");
        setSvgContent(iconSpan, getWeatherSvg(cond.kind, 42));
        iconSpan.appendChild(makeEl("span", "visually-hidden", cond.label));
        tile.appendChild(iconSpan);

        const tempsDiv = makeEl("div", "forecast-temps");
        const tempHigh = makeEl("span", "forecast-temp-high", String(tempVal));
        tempHigh.appendChild(makeEl("span", "forecast-unit-small", unitInfo.tempLabel));
        tempsDiv.appendChild(tempHigh);
        tile.appendChild(tempsDiv);

        const precipRow = makeEl("div", "forecast-meta-row");
        const precipIcon = makeEl("span", "forecast-meta-icon");
        setSvgContent(precipIcon, umbrellaSvg(precip > 0));
        precipRow.appendChild(precipIcon.firstChild || precipIcon);
        precipRow.appendChild(makeEl("span", "", `${precip}%`));
        tile.appendChild(precipRow);

        const windRow = makeEl("div", "forecast-meta-row");
        const windIcon = makeEl("span", "forecast-meta-icon");
        setSvgContent(windIcon, windArrowSvg(windDeg));
        windRow.appendChild(windIcon.firstChild || windIcon);
        const windValSpan = makeEl("span", "", String(wind));
        windValSpan.appendChild(makeEl("span", "forecast-unit-small", unitInfo.windLabel));
        windRow.appendChild(windValSpan);
        tile.appendChild(windRow);

        strip.appendChild(tile);
      }
      return;
    }

    const d = forecastCache.daily;
    if (!d || !Array.isArray(d.time)) return;

    const minVals = (d.temperature_2m_min || []).map(Number).filter(Number.isFinite);
    const maxVals = (d.temperature_2m_max || []).map(Number).filter(Number.isFinite);
    const weekMin = minVals.length ? Math.min(...minVals) : 0;
    const weekMax = maxVals.length ? Math.max(...maxVals) : 20;

    for (let i = 0; i < d.time.length; i++) {
      const parts = d.time[i].split("-");
      const localDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      const dayLabel = i === 0 ? "Today" : localDate.toLocaleDateString([], { weekday: "short" });
      const cond = WMO_CONDITIONS[d.weather_code[i]] || { label: "Cloudy", kind: "cloud" };
      const high = Math.round(d.temperature_2m_max[i]);
      const low = Math.round(d.temperature_2m_min[i]);
      const precip = Math.round(d.precipitation_probability_max[i] || 0);
      const bar = computeDailyRangeBar(low, high, weekMin, weekMax);

      const row = makeEl("div", "forecast-daily-row");
      row.appendChild(makeEl("span", "forecast-daily-day", dayLabel));

      const iconSpan = makeEl("span", "forecast-daily-icon");
      setSvgContent(iconSpan, getWeatherSvg(cond.kind, 30));
      iconSpan.appendChild(makeEl("span", "visually-hidden", cond.label));
      row.appendChild(iconSpan);

      const precipSpan = makeEl("span", "forecast-daily-precip");
      const precipIcon = makeEl("span", "forecast-meta-icon");
      setSvgContent(precipIcon, umbrellaSvg(precip > 0));
      precipSpan.appendChild(precipIcon.firstChild || precipIcon);
      precipSpan.appendChild(makeEl("span", "", `${precip}%`));
      row.appendChild(precipSpan);

      const lowSpan = makeEl("span", "forecast-daily-low", String(low));
      lowSpan.appendChild(makeEl("span", "forecast-unit-small", unitInfo.tempLabel));
      row.appendChild(lowSpan);

      const track = makeEl("div", "forecast-range-track");
      track.setAttribute("aria-hidden", "true");
      const fill = makeEl("div", "forecast-range-fill");
      fill.style.left = `${bar.leftPct}%`;
      fill.style.width = `${bar.widthPct}%`;
      track.appendChild(fill);
      row.appendChild(track);

      const highSpan = makeEl("span", "forecast-daily-high", String(high));
      highSpan.appendChild(makeEl("span", "forecast-unit-small", unitInfo.tempLabel));
      row.appendChild(highSpan);

      strip.appendChild(row);
    }
  }

  function applyCurrentOpenMeteo(data) {
    if (!data || !data.current) return;
    const cur = data.current;
    latestOpenMeteoCurrent = cur;
    const cond = WMO_CONDITIONS[cur.weather_code] || { label: "Current conditions", kind: "cloud" };

    const iconEl = document.getElementById("weather-condition-icon");
    const textEl = document.getElementById("weather-condition-text");
    if (iconEl) setSvgContent(iconEl, getWeatherSvg(cond.kind, 68));
    if (textEl) textEl.textContent = cond.label;

    const visEl = document.getElementById("loc-visibility");
    if (visEl && typeof cur.visibility === "number") {
      const unitInfo = getOpenMeteoUnitParams();
      if (unitInfo.windParam === "mph") {
        const miles = Math.round(cur.visibility / 1609.34);
        visEl.textContent = `${miles} mi`;
      } else {
        const km = Math.round(cur.visibility / 1000);
        visEl.textContent = `${km} km`;
      }
    }

    const cloudsEl = document.getElementById("loc-clouds");
    if (cloudsEl && typeof cur.cloud_cover === "number") {
      cloudsEl.textContent = cloudCoverLabel(cur.cloud_cover);
    }

    renderWeatherQuip();
  }

  async function fetchOpenMeteo(showFeedback) {
    const lat = Number(CFG.lat);
    const lon = Number(CFG.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const unitInfo = getOpenMeteoUnitParams();
    const cacheKey = `${OM_SESSION_CACHE_KEY}:${lat.toFixed(3)}:${lon.toFixed(3)}:${unitInfo.tempParam}:${unitInfo.windParam}`;
    if (!showFeedback) {
      const cached = readSessionCache(cacheKey, OM_CACHE_TTL_MS);
      if (cached) {
        forecastCache = cached;
        applyCurrentOpenMeteo(cached);
        renderForecastStrip(readForecastMode());
        return;
      }
    }

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${encodeURIComponent(lat)}` +
      `&longitude=${encodeURIComponent(lon)}` +
      `&current=weather_code,cloud_cover,visibility,is_day` +
      `&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant` +
      `&temperature_unit=${unitInfo.tempParam}` +
      `&wind_speed_unit=${unitInfo.windParam}` +
      `&precipitation_unit=${unitInfo.precipParam}` +
      `&timezone=auto&forecast_days=7`;

    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      writeSessionCache(cacheKey, data);
      forecastCache = data;
      applyCurrentOpenMeteo(data);

      renderForecastStrip(readForecastMode());

      if (showFeedback) showToast("Forecast and weather conditions refreshed.");
    } catch (err) {
      const strip = document.getElementById("forecast-strip");
      if (strip && !forecastCache) {
        // Build a retry button
        const retryBtn = document.createElement("button");
        retryBtn.className = "forecast-retry-btn";
        retryBtn.type = "button";
        retryBtn.textContent = "Retry";
        retryBtn.addEventListener("click", () => {
          strip.textContent = "";
          fetchOpenMeteo(true);
        });

        const msg = document.createElement("div");
        msg.className = "forecast-error-message";
        msg.textContent = "Unable to reach Open-Meteo API right now.";

        strip.textContent = "";
        strip.appendChild(msg);
        strip.appendChild(retryBtn);
      }
      if (showFeedback) showToast("Could not refresh Open-Meteo data.");
    }
  }

  function isLightTheme() {
    const explicit = document.documentElement.getAttribute("data-theme");
    if (explicit === "light") return true;
    if (explicit === "dark") return false;
    const meta = document.querySelector('meta[name="color-scheme"]');
    const content = meta ? meta.getAttribute("content") : "";
    if (content === "light") return true;
    if (content === "dark") return false;
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: light)").matches
    );
  }

  function rerenderActiveChart() {
    if (lastRenderedChart) {
      renderChart(lastRenderedChart.seriesObj, lastRenderedChart.period);
    } else if (window.FrostlineChartFallback && typeof window.FrostlineChartFallback.redraw === "function") {
      window.FrostlineChartFallback.redraw();
    }
  }

  function initThemeToggle() {
    const select = document.getElementById("theme-select");
    const toggleBtn = document.getElementById("theme-toggle-btn");
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (!meta) return;

    function syncToggleButton() {
      if (!toggleBtn) return;
      const light = isLightTheme();
      toggleBtn.setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
      toggleBtn.setAttribute("title", light ? "Switch to dark theme" : "Switch to light theme");
    }

    function readUrlTheme() {
      try {
        const search = window.location && window.location.search;
        if (!search) return null;
        const t = new URLSearchParams(search).get("theme");
        return t === "light" || t === "dark" ? t : null;
      } catch {
        return null;
      }
    }

    function readStored() {
      const urlTheme = readUrlTheme();
      if (urlTheme) return urlTheme;
      try {
        const stored = localStorage.getItem("color-scheme");
        return stored === "light" || stored === "dark" ? stored : "auto";
      } catch {
        return "auto";
      }
    }

    function applyThemeValue(choice, persist) {
      const normalized = choice === "light" || choice === "dark" ? choice : "auto";
      if (normalized === "auto") {
        document.documentElement.removeAttribute("data-theme");
        meta.setAttribute("content", "light dark");
      } else {
        document.documentElement.setAttribute("data-theme", normalized);
        meta.setAttribute("content", normalized);
      }
      if (select && select.value !== normalized) {
        select.value = normalized;
      }
      if (persist) {
        try {
          if (normalized === "auto") {
            localStorage.removeItem("color-scheme");
          } else {
            localStorage.setItem("color-scheme", normalized);
          }
        } catch {
          // Ignore storage restrictions
        }
      }
      syncToggleButton();
      rerenderActiveChart();
    }

    applyThemeValue(readStored(), false);

    if (select) {
      select.addEventListener("change", () => {
        applyThemeValue(select.value, true);
      });
    }

    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        applyThemeValue(isLightTheme() ? "dark" : "light", true);
      });
    }

    window.addEventListener("storage", (evt) => {
      if (evt.key === "color-scheme") {
        applyThemeValue(readStored(), false);
      }
    });

    if (typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onSystemThemeChange = () => {
        if (readStored() === "auto") {
          document.documentElement.removeAttribute("data-theme");
          syncToggleButton();
          rerenderActiveChart();
        }
      };
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", onSystemThemeChange);
      } else if (typeof mq.addListener === "function") {
        mq.addListener(onSystemThemeChange);
      }
    }
  }

  function updateConnectionStatus(reportEpoch) {
    const thresholdRaw = Number(CFG.staleThresholdMinutes);
    const thresholdDisabled = Number.isFinite(thresholdRaw) && thresholdRaw === 0;
    const thresholdMinutes = Number.isFinite(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : 15;
    const epoch = Number(reportEpoch);
    const ageMinutes = thresholdDisabled
      ? 0
      : Number.isFinite(epoch) && epoch > 0
        ? (Date.now() / 1000 - epoch) / 60
        : Infinity;
    const isStale = !thresholdDisabled && ageMinutes > thresholdMinutes;

    const statusBars = document.querySelectorAll(".card-header.has-status-bar, .sensor-card.has-top-status-bar");
    statusBars.forEach((bar) => {
      bar.classList.toggle("is-stale", isStale);
    });

    document.querySelectorAll("[data-sensor-status]").forEach((pill) => {
      pill.hidden = !isStale;
      if (isStale) {
        pill.textContent = Number.isFinite(ageMinutes)
          ? `Offline (${Math.floor(ageMinutes)}m)`
          : "Offline";
      }
    });

    document.querySelectorAll("#health-connection-status, [data-health-connection]").forEach((el) => {
      el.textContent = isStale ? "Offline" : "Online";
      el.classList.toggle("is-ok", !isStale);
      el.classList.toggle("is-warn", isStale);
    });

    let ageText = "Just now";
    if (!Number.isFinite(ageMinutes)) {
      ageText = "Unknown";
    } else if (ageMinutes >= 60) {
      ageText = `${(ageMinutes / 60).toFixed(1)}h ago`;
    } else if (ageMinutes >= 1) {
      ageText = `${Math.floor(ageMinutes)}m ago`;
    }

    document.querySelectorAll("#health-archive-age, [data-health-age]").forEach((el) => {
      el.textContent = ageText;
    });
  }

  /* ---------------- Weather Alerts (Auto-open, Minimize, 3-Day History) ---------------- */
  const ALERTS_HISTORY_KEY = "frostline:alerts:history:v1";
  const ALERTS_DISMISSED_KEY = "frostline:alerts:dismissed:v1";
  const ALERTS_RETENTION_MS = 72 * 3600 * 1000;

  function detectAlertProvider(lat, lon) {
    const configured = String(CFG.alertsProvider || "auto").toLowerCase();
    if (configured === "canada" || configured === "us") return configured;
    if (lat >= 41.6 && lat <= 83.5 && lon >= -141.0 && lon <= -52.6) return "canada";
    return "us";
  }

  function classifyAlertSeverity(text) {
    const lower = String(text || "").toLowerCase();
    if (
      lower.includes("warning") ||
      lower.includes("extreme") ||
      lower.includes("severe") ||
      /\b(red|orange)\b/.test(lower)
    ) {
      return "warning";
    }
    if (lower.includes("watch")) return "watch";
    return "advisory";
  }

  function formatAlertTitle(raw) {
    const text = String(raw || "").trim();
    if (!text) return "Weather Alert";
    if (text === text.toLowerCase()) {
      return text.replace(/\b\w/g, (ch) => ch.toUpperCase());
    }
    return text;
  }

  function normalizeAlertDescription(raw) {
    const cleaned = String(raw || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    return cleaned.length > 600 ? `${cleaned.slice(0, 597).trimEnd()}…` : cleaned;
  }

  function alertBaseKey(alert) {
    const title = formatAlertTitle(alert.title).toLowerCase();
    const eff = String(alert.effective || "").trim();
    const exp = String(alert.expires || "").trim();
    return `${title}|${eff}|${exp}`;
  }

  function alertContentKey(alert) {
    const desc = String(alert.description || "").trim().slice(0, 120).toLowerCase();
    return `${alertBaseKey(alert)}|${desc}`;
  }

  function dedupeAlerts(alerts) {
    const byKey = new Map();
    alerts.forEach((alert) => {
      const key = alertContentKey(alert);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, alert);
        return;
      }
      const nextDescLen = String(alert.description || "").length;
      const prevDescLen = String(existing.description || "").length;
      const preferNext =
        nextDescLen > prevDescLen ||
        (nextDescLen === prevDescLen && Boolean(alert.url) && !existing.url);
      if (preferNext) {
        byKey.set(key, {
          ...existing,
          ...alert,
          seenAtMs: Math.min(Number(existing.seenAtMs) || Date.now(), Number(alert.seenAtMs) || Date.now())
        });
      }
    });
    return Array.from(byKey.values());
  }

  function buildActiveSignature(activeAlerts) {
    return activeAlerts
      .map((a) => {
        const t = formatAlertTitle(a.title).toLowerCase();
        const eff = String(a.effective || "").trim();
        const exp = String(a.expires || "").trim();
        const d = String(a.description || "").trim().slice(0, 80).toLowerCase();
        return `${t}:${eff}:${exp}:${d}`;
      })
      .sort()
      .join("|");
  }

  function formatAlertTimeRange(effectiveIso, expiresIso) {
    const opts = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
    const startMs = effectiveIso ? Date.parse(effectiveIso) : NaN;
    const endMs = expiresIso ? Date.parse(expiresIso) : NaN;
    if (Number.isFinite(endMs)) {
      const endStr = new Date(endMs).toLocaleString([], opts);
      if (Number.isFinite(startMs)) {
        return `${new Date(startMs).toLocaleString([], opts)} – ${endStr}`;
      }
      return `Until ${endStr}`;
    }
    if (Number.isFinite(startMs)) {
      return `Issued ${new Date(startMs).toLocaleString([], opts)}`;
    }
    return "";
  }

  function sanitizeAlertUrl(url) {
    if (!url || typeof url !== "string") return "";
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
    } catch {
      return "";
    }
  }

  function normalizeCanadaAlerts(geojson) {
    const features = Array.isArray(geojson && geojson.features) ? geojson.features : [];
    const nowMs = Date.now();
    return features.map((f, idx) => {
      const p = f.properties || {};
      const title = formatAlertTitle(
        p.alert_name_en || p.event_en || p.alert_type_en || p.headline_en || "Weather Alert"
      );
      const area = String(p.area_name_en || p.feature_name_en || p.region_en || "").trim();
      const desc = normalizeAlertDescription(
        p.alert_text_en || p.descrip_en || p.text_en || p.description_en || p.headline_en || ""
      );
      const effective = p.publication_datetime || p.effective_datetime || "";
      const expires = p.expiration_datetime || "";
      const expiresMs = expires ? Date.parse(expires) : NaN;
      const isExpired = Number.isFinite(expiresMs) && expiresMs <= nowMs;
      const severitySource = [p.alert_type, p.risk_colour_en, title].filter(Boolean).join(" ");
      return {
        id: String(f.id || p.identifier || `ca-${title}-${effective || idx}`),
        title,
        area,
        severity: classifyAlertSeverity(severitySource),
        description: desc,
        effective,
        expires,
        url: sanitizeAlertUrl(
          p.url_en || p.url || p.web_en || "https://weather.gc.ca/warnings/index_e.html"
        ),
        isExpired,
        seenAtMs: nowMs
      };
    });
  }

  function normalizeUsAlerts(geojson) {
    const features = Array.isArray(geojson && geojson.features) ? geojson.features : [];
    const nowMs = Date.now();
    return features.map((f, idx) => {
      const p = f.properties || {};
      const title = formatAlertTitle(p.event || p.headline || "Weather Alert");
      const area = String(p.areaDesc || "").trim();
      const desc = normalizeAlertDescription(p.headline || p.description || "");
      const effective = p.effective || p.sent || "";
      const expires = p.expires || p.ends || "";
      const expiresMs = expires ? Date.parse(expires) : NaN;
      const isExpired = Number.isFinite(expiresMs) && expiresMs <= nowMs;
      return {
        id: String(p.id || f.id || `us-${title}-${effective || idx}`),
        title,
        area,
        severity: classifyAlertSeverity(title + " " + (p.severity || "")),
        description: desc,
        effective,
        expires,
        url: sanitizeAlertUrl(p["@id"] || ""),
        isExpired,
        seenAtMs: nowMs
      };
    });
  }

  function loadAlertHistory() {
    try {
      const raw = localStorage.getItem(ALERTS_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      const cutoff = Date.now() - ALERTS_RETENTION_MS;
      return parsed.filter((item) => {
        const expMs = item.expires ? Date.parse(item.expires) : NaN;
        const refMs = Math.max(Number(item.seenAtMs) || 0, Number.isFinite(expMs) ? expMs : 0);
        return refMs >= cutoff;
      });
    } catch {
      return [];
    }
  }

  function saveAlertHistory(list) {
    try {
      localStorage.setItem(ALERTS_HISTORY_KEY, JSON.stringify(list.slice(0, 30)));
    } catch {
      // Ignore storage errors
    }
  }

  function renderAlertNodes(container, alerts, markExpired) {
    container.replaceChildren();
    alerts.forEach((alert) => {
      const item = document.createElement("article");
      item.className = `alert-item is-${alert.severity || "advisory"}${markExpired ? " is-expired" : ""}`;

      const head = document.createElement("div");
      head.className = "alert-item-head";

      const title = document.createElement("span");
      title.className = "alert-item-title";
      const formattedTitle = formatAlertTitle(alert.title);
      const area = String(alert.area || "").trim();
      title.textContent =
        area && !formattedTitle.toLowerCase().includes(area.toLowerCase())
          ? `${formattedTitle} — ${area}`
          : formattedTitle;
      head.appendChild(title);

      const timeStr = formatAlertTimeRange(alert.effective, alert.expires);
      if (timeStr) {
        const timeEl = document.createElement("span");
        timeEl.className = "alert-item-time";
        timeEl.textContent = timeStr;
        head.appendChild(timeEl);
      }

      item.appendChild(head);

      if (alert.description) {
        const desc = document.createElement("p");
        desc.className = "alert-item-desc";
        desc.textContent = alert.description;
        item.appendChild(desc);
      }

      if (alert.url) {
        try {
          const base = (window.location && window.location.href) || "https://localhost";
          const parsedUrl = new URL(String(alert.url), base);
          if (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") {
            const link = document.createElement("a");
            link.className = "alert-item-link";
            link.href = parsedUrl.href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "Official bulletin";
            item.appendChild(link);
          }
        } catch {
          // Ignore malformed external URL
        }
      }

      container.appendChild(item);
    });
  }

  function renderAlertsErrorState(region) {
    // Only show if region exists and no error state already present
    if (!region) return;

    // Avoid duplicating the error state on repeated calls
    if (region.querySelector(".alerts-error-state")) return;

    const retryBtn = document.createElement("button");
    retryBtn.className = "alerts-retry-btn";
    retryBtn.type = "button";
    retryBtn.textContent = "Retry";
    retryBtn.addEventListener("click", () => {
      const errorEl = region.querySelector(".alerts-error-state");
      if (errorEl) errorEl.remove();
      fetchWeatherAlerts();
    });

    const msg = document.createElement("div");
    msg.className = "alerts-error-state";
    const errorSpan = document.createElement("span");
    errorSpan.className = "error-text";
    errorSpan.textContent = "Weather alerts unavailable right now.";
    msg.appendChild(errorSpan);
    msg.appendChild(retryBtn);

    // Insert before any existing panel content
    region.insertBefore(msg, region.firstChild);
    region.hidden = false;
  }

  function renderAlertsUi(activeAlerts, pastAlerts) {
    currentActiveSignature = "";
    const region = document.getElementById("alerts-region");
    const minBar = document.getElementById("alerts-minimized-bar");
    const minText = document.getElementById("alerts-minimized-text");
    const minDot = region ? region.querySelector(".alerts-dot") : null;
    const panel = document.getElementById("alerts-panel");
    const countBadge = document.getElementById("alerts-count-badge");
    const activeList = document.getElementById("alerts-active-list");
    const pastSection = document.getElementById("alerts-past-details");
    const pastLabel = document.getElementById("alerts-past-label");
    const pastList = document.getElementById("alerts-past-list");

    if (!region || !minBar || !panel || !activeList) return;

    if (activeAlerts.length === 0 && pastAlerts.length === 0) {
      region.hidden = true;
      return;
    }

    region.hidden = false;
    renderAlertNodes(activeList, activeAlerts, false);

    if (pastSection && pastLabel && pastList) {
      if (pastAlerts.length > 0) {
        pastSection.hidden = false;
        pastLabel.textContent = `Past Alerts (Last 3 Days: ${pastAlerts.length})`;
        renderAlertNodes(pastList, pastAlerts, true);
      } else {
        pastSection.hidden = true;
      }
    }

    panel.classList.remove("is-watch", "is-advisory", "is-past-only");
    if (activeAlerts.length === 0) {
      panel.classList.add("is-past-only");
      if (countBadge) countBadge.textContent = "0 Active";
      if (minDot) minDot.classList.add("is-past-only");
      if (minText) {
        minText.textContent = `Past Weather Alerts (${pastAlerts.length} in last 3 days)`;
      }
      if (pastSection) pastSection.open = true;
      panel.hidden = true;
      minBar.hidden = false;
      return;
    }

    const severities = activeAlerts.map((a) => a.severity);
    if (!severities.includes("warning")) {
      panel.classList.add(severities.includes("watch") ? "is-watch" : "is-advisory");
    }
    if (minDot) minDot.classList.remove("is-past-only");
    if (countBadge) {
      countBadge.textContent = activeAlerts.length === 1 ? "1 Active" : `${activeAlerts.length} Active`;
    }
    if (minText) {
      minText.textContent =
        activeAlerts.length === 1
          ? `Weather Alert: ${formatAlertTitle(activeAlerts[0].title)}`
          : `${activeAlerts.length} Active Weather Alerts`;
    }

    const signature = buildActiveSignature(activeAlerts);
    currentActiveSignature = signature;
    let dismissedSig = "";
    try {
      dismissedSig = localStorage.getItem(ALERTS_DISMISSED_KEY) || "";
    } catch {
      dismissedSig = "";
    }

    const isMobileViewport =
      typeof window.matchMedia === "function" && window.matchMedia("(max-width: 639px)").matches;
    const shouldAutoOpen = !isMobileViewport && signature !== dismissedSig;
    panel.hidden = !shouldAutoOpen;
    minBar.hidden = shouldAutoOpen;
  }

  async function fetchWeatherAlerts() {
    if (CFG.showAlerts === false) return;
    const region = document.getElementById("alerts-region");
    if (!region) return;

    const lat = Number(CFG.lat);
    const lon = Number(CFG.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const provider = detectAlertProvider(lat, lon);
    const url =
      provider === "canada"
        ? `https://api.weather.gc.ca/collections/weather-alerts/items?f=json&bbox=${(lon - 0.005).toFixed(4)},${(lat - 0.005).toFixed(4)},${(lon + 0.005).toFixed(4)},${(lat + 0.005).toFixed(4)}&limit=25`
        : `https://api.weather.gov/alerts?point=${lat.toFixed(4)},${lon.toFixed(4)}&limit=20`;

    let fetched = [];
    let apiOk = false;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        apiOk = true;
        const json = await res.json();
        const rawAlerts =
          provider === "canada" ? normalizeCanadaAlerts(json) : normalizeUsAlerts(json);
        fetched = dedupeAlerts(rawAlerts);
      }
    } catch (err) {
      // Fall back silently to locally stored 3-day history if offline
    }

    const nowMs = Date.now();
    const cutoff = nowMs - ALERTS_RETENTION_MS;
    const historyMap = new Map();

    const storedHistory = loadAlertHistory();
    storedHistory.forEach((item) => {
      historyMap.set(item.id, item);
    });

    // If API failed and no history, show error state
    if (!apiOk && storedHistory.length === 0) {
      renderAlertsErrorState(region);
      return;
    }

    const activeIds = new Set();
    const activeRaw = [];

    fetched.forEach((alert) => {
      const prev = historyMap.get(alert.id);
      const merged = { ...prev, ...alert, seenAtMs: prev ? prev.seenAtMs : nowMs };
      historyMap.set(alert.id, merged);
      if (!alert.isExpired) {
        activeIds.add(alert.id);
        activeRaw.push(merged);
      }
    });

    const activeAlerts = dedupeAlerts(activeRaw);
    const activeKeys = new Set(activeAlerts.map(alertContentKey));
    const activeBaseKeys = new Set(activeAlerts.map(alertBaseKey));

    const allStored = dedupeAlerts(
      Array.from(historyMap.values()).filter((item) => {
        const expMs = item.expires ? Date.parse(item.expires) : NaN;
        const refMs = Math.max(Number(item.seenAtMs) || 0, Number.isFinite(expMs) ? expMs : 0);
        return refMs >= cutoff;
      })
    );

    saveAlertHistory(allStored);

    const pastAlerts = dedupeAlerts(
      allStored.filter((item) => {
        if (activeIds.has(item.id) || activeKeys.has(alertContentKey(item))) return false;
        if (!item.description && activeBaseKeys.has(alertBaseKey(item))) return false;
        return true;
      })
    ).sort((a, b) => (Number(b.seenAtMs) || 0) - (Number(a.seenAtMs) || 0));

    renderAlertsUi(activeAlerts, pastAlerts);
  }

  function initWeatherAlerts() {
    if (CFG.showAlerts === false) return;
    const panel = document.getElementById("alerts-panel");
    const minBar = document.getElementById("alerts-minimized-bar");
    const minBtn = document.getElementById("alerts-minimize-btn");
    const restoreBtn = document.getElementById("alerts-restore-btn");

    if (minBtn && panel && minBar) {
      minBtn.addEventListener("click", () => {
        if (currentActiveSignature) {
          try {
            localStorage.setItem(ALERTS_DISMISSED_KEY, currentActiveSignature);
          } catch {
            // Ignore storage errors
          }
        }
        panel.hidden = true;
        minBar.hidden = false;
      });
    }

    if (restoreBtn && panel && minBar) {
      restoreBtn.addEventListener("click", () => {
        minBar.hidden = true;
        panel.hidden = false;
      });
    }

    fetchWeatherAlerts();
  }

  /* ---------------- Weather Commentary (Quip Banner) ---------------- */
  const QUIP_LIBRARY = {
    thunderstorm: {
      clean: [
        { h: "Lightning in the area. Stay indoors.", s: "Good excuse to unplug and watch from a dry window." },
        { h: "Thunderstorms rolling through.", s: "Not the hour for holding metal objects in an open field." },
        { h: "Atmospheric fireworks outside.", s: "Wait out the storm cells before heading back out." }
      ],
      snarky: [
        { h: "The sky is actively throwing bolts around.", s: "Sure, go stand under the tallest tree. Brilliant plan." },
        { h: "Thunderstorm outside. Stay off the golf course.", s: "Mother Nature is settling scores with static electricity." },
        { h: "It is storming hard enough to rattle the windows.", s: "Maybe postpone yard work until nature stops screaming." }
      ],
      unfiltered: [
        { h: "The sky is firing fucking lightning bolts.", s: "Keep your ass inside unless you want to become crispy." },
        { h: "Thunderstorm. Mother Nature is pissed off.", s: "Put the umbrella down before you hold up a lightning rod, idiot." },
        { h: "Flashy, loud, dangerous bullshit outside.", s: "Stay indoors and let the thunderclaps pass." }
      ]
    },
    freezing_rain: {
      clean: [
        { h: "Freezing rain and icy surfaces.", s: "Every sidewalk and driveway is a skating rink right now." },
        { h: "Cold rain freezing on contact.", s: "Leave plenty of stopping distance if you must drive." },
        { h: "Glaze ice building outdoors.", s: "Give yourself extra time and tread carefully on steps." }
      ],
      snarky: [
        { h: "Liquid misery turning instantly into ice.", s: "Gravity is about to test your balance on the front steps." },
        { h: "Freezing rain. Nature chose pure treachery.", s: "Enjoy chipping a quarter-inch glacier off your windshield." },
        { h: "Sidewalks are now lubricated with solid ice.", s: "Walk like a penguin or stay on the couch." }
      ],
      unfiltered: [
        { h: "Freezing rain. Everything is coated in fucking ice.", s: "One step on the driveway and your tailbone is finished." },
        { h: "Oh great, frozen sky piss turning the roads to glass.", s: "Do not drive unless you enjoy ditch-surfing." },
        { h: "Absolute bastard of an ice storm out there.", s: "Stay inside before you crack your skull walking to the car." }
      ]
    },
    snow: {
      clean: [
        { h: "Snow falling outside.", s: "Grab boots, gloves, and check your shovel proximity." },
        { h: "Fresh winter accumulation underway.", s: "Cold air and snowflakes moving across the station." },
        { h: "Snowy conditions outdoors.", s: "Roads may get slick quickly once dustings settle." }
      ],
      snarky: [
        { h: "Frozen sky fluff is back on the schedule.", s: "Hope your back is warmed up for shoveling the end of the driveway." },
        { h: "Snowing again. Pretend it looks picturesque.", s: "Tomorrow morning's commute just got twenty minutes longer." },
        { h: "Winter confetti everywhere outside.", s: "Great if you are a husky; less thrilling if you own a shovel." }
      ],
      unfiltered: [
        { h: "It is fucking snowing.", s: "Have fun scraping your windshield and cursing at the snowplow." },
        { h: "White frozen bullshit falling from the sky.", s: "Hide inside with a hot drink and ignore the driveway." },
        { h: "Cold white crap everywhere.", s: "Remember how nice August was? Yeah, me neither right now." }
      ]
    },
    heavy_rain: {
      clean: [
        { h: "Heavy downpour right now.", s: "Umbrellas will struggle against wind-driven rain like this." },
        { h: "Buckets of rain coming down.", s: "Watch for standing water and poor visibility on the road." },
        { h: "Serious rainfall at the station.", s: "Storm drains are working overtime out there." }
      ],
      snarky: [
        { h: "Someone left the atmospheric firehose wide open.", s: "Your umbrella is purely decorative in this downpour." },
        { h: "Heavy rain. Waterproof boots are not optional.", s: "Step outside for ten seconds and achieve instant swamp status." },
        { h: "Sideways sheets of rain outside.", s: "Time to double-check that basement sump pump." }
      ],
      unfiltered: [
        { h: "It is pissing rain out there.", s: "You will be soaked to the underwear before you reach the mailbox." },
        { h: "Biblical fucking downpour right now.", s: "Do not bother with an umbrella; build a damn ark." },
        { h: "Drowning outside. Just torrential crap.", s: "Cancel whatever errands you thought were important today." }
      ]
    },
    rain: {
      clean: [
        { h: "Steady rain outside.", s: "Bring a waterproof jacket before heading out the door." },
        { h: "Wet and rainy at the station.", s: "Keep the windshield wipers handy for any errands." },
        { h: "Passing showers overhead.", s: "Damp pavement and overcast skies for now." }
      ],
      snarky: [
        { h: "Wet, soggy, and completely uninspiring.", s: "Nothing quite says enthusiasm like cold raindrops down your collar." },
        { h: "It is raining. Surprise level: zero.", s: "Free car wash, minus the dry part." },
        { h: "Gray clouds leaking steadily onto the roof.", s: "Stay dry and pretend the laundry didn't need hanging." }
      ],
      unfiltered: [
        { h: "Wet as shit outside.", s: "Grab a raincoat or just accept looking like a drowned rat." },
        { h: "Raining again. Because of course it is.", s: "Everything outside is soggy and annoying right now." },
        { h: "Cold drizzle and damp bullshit.", s: "Stay inside where your socks remain blessedly dry." }
      ]
    },
    fog: {
      clean: [
        { h: "Dense fog and low visibility.", s: "Use low beams if driving and watch for sudden slowed traffic." },
        { h: "Misty, fog-wrapped outdoors.", s: "Hard to see down the road right now." },
        { h: "Visibility dropped in fog.", s: "Take it slow on rural roads and coastal stretches." }
      ],
      snarky: [
        { h: "Render distance set to minimum.", s: "Look at all that scenic view of literally nothing." },
        { h: "Thick soup outside the window.", s: "Did the world fail to finish loading, or is it just fog?" },
        { h: "Visibility is strictly theoretical today.", s: "Drive carefully; that tree might appear sooner than expected." }
      ],
      unfiltered: [
        { h: "Cannot see shit out there.", s: "Thick pea-soup fog. Turn on your headlights and pay attention." },
        { h: "Looks like the world ran out of fucking draw distance.", s: "Spooky, damp, and zero visibility past the driveway." },
        { h: "Damp gray fog everywhere.", s: "Great weather if you're a ghost or a lost cargo ship." }
      ]
    },
    gale: {
      clean: [
        { h: "Strong, gusty winds outside.", s: "Secure loose patio furniture and watch for blown branches." },
        { h: "Blustery conditions at the station.", s: "Hold tightly onto car doors when getting out." },
        { h: "High wind gusts shaking things up.", s: "Bad timing for trash bins on the curb." }
      ],
      snarky: [
        { h: "Hold onto your hair and your patio chairs.", s: "Your trash bin is about to tour three neighboring yards." },
        { h: "Windy enough to rearrange your hairstyle violently.", s: "Do not even think about opening a cheap umbrella." },
        { h: "Roaring gusts outside right now.", s: "Every loose tarp in the county is currently airborne." }
      ],
      unfiltered: [
        { h: "It is windy as fuck out there.", s: "Say goodbye to your garbage cans, they belong to the next county now." },
        { h: "Howling gale blowing the shit out of everything.", s: "Hang onto your hat and both car doors." },
        { h: "Violent gusty bullshit outside.", s: "Every tree branch is auditioning for a power outage." }
      ]
    },
    bitter_cold: {
      clean: [
        { h: "Bitter cold outside.", s: "Cover exposed skin and limit long stretches outdoors." },
        { h: "Deep freeze conditions.", s: "Check pets, pipes, and vehicle batteries today." },
        { h: "Frigid air across the station.", s: "Heavy parka, warm gloves, and hat are mandatory." }
      ],
      snarky: [
        { h: "The air literally hurts your face.", s: "Why do we choose to live where the atmosphere tries to freeze us?" },
        { h: "Bitterly freezing. Car batteries are sweating nervously.", s: "Even the frost has frost out there." },
        { h: "Bone-chilling cold on tap today.", s: "Time to hibernate until May." }
      ],
      unfiltered: [
        { h: "Fuck this cold. Seriously, fuck this.", s: "Step outside and your nostrils immediately freeze shut." },
        { h: "Balls-freezing cold out there.", s: "It hurts to breathe. Stay inside by the damn radiator." },
        { h: "Arctic bullshit temperatures right now.", s: "If your car starts on the first crank, buy a lottery ticket." }
      ]
    },
    freezing: {
      clean: [
        { h: "Below freezing outdoors.", s: "Bundle up well and watch for frost or black ice." },
        { h: "Sub-zero temperatures right now.", s: "Puddles and damp spots will freeze solid." },
        { h: "Crisp freezing cold outside.", s: "Winter coat and warm layers needed." }
      ],
      snarky: [
        { h: "Below zero. Put on a real coat.", s: "Any puddle left from earlier is now plotting against your ankles." },
        { h: "Freezing cold outside the window.", s: "Time to start the car five minutes early and groan quietly." },
        { h: "Fridge temperatures everywhere outdoors.", s: "At least groceries stay cold in the trunk." }
      ],
      unfiltered: [
        { h: "Freezing tits cold out there.", s: "Below zero already. Keep a scraper in your hand and swear softly." },
        { h: "Cold as hell outside right now.", s: "Watch for black ice waiting to fuck up your morning." },
        { h: "Below freezing. Absolute winter nonsense.", s: "Put on thick socks and stay under a blanket." }
      ]
    },
    chilly_damp: {
      clean: [
        { h: "Cold and damp outside.", s: "High humidity makes the chill bite harder than the thermometer suggests." },
        { h: "Chilly, clammy air right now.", s: "A windproof layer over a sweater helps cut the dampness." },
        { h: "Raw, cool conditions.", s: "Damp Maritime air settling across the yard." }
      ],
      snarky: [
        { h: "Cold, wet, and straight-into-your-bones damp.", s: "Not cold enough for snow, just cold enough to ruin your mood." },
        { h: "Raw Atlantic chill at peak clamminess.", s: "The air feels like a wet wool sock left on a porch." },
        { h: "Chilly and soaked with humidity.", s: "Thermometer looks mild; your bones strongly disagree." }
      ],
      unfiltered: [
        { h: "Cold, damp, miserable bullshit outside.", s: "That wet chill sneaks right through your jacket straight into your spine." },
        { h: "Clammy cold ass weather right now.", s: "Make tea, stay dry, and let November kiss your ass." },
        { h: "Damp enough to chill your soul, cold enough to piss you off.", s: "Worst combination outside without an actual storm." }
      ]
    },
    chilly: {
      clean: [
        { h: "Brisk and chilly outdoors.", s: "Grab a sweater or light jacket before heading out." },
        { h: "Crisp cool temperatures today.", s: "Refreshing for a brisk walk if dressed in layers." },
        { h: "On the cool side outside.", s: "Hoodie or jacket territory." }
      ],
      snarky: [
        { h: "Sweater weather, whether you asked for it or not.", s: "Not quite winter, definitely no longer shorts season." },
        { h: "Brisk enough to regret leaving your jacket inside.", s: "At least there are zero mosquitoes surviving this." },
        { h: "Cool and crisp outside.", s: "Good coffee-holding temperature." }
      ],
      unfiltered: [
        { h: "Chilly as hell out there.", s: "Grab a damn hoodie unless you enjoy shivering in the driveway." },
        { h: "Crisp little nip in the air.", s: "Put a jacket on before your nipples cut glass." },
        { h: "Too cold for a t-shirt, not cold enough to complain dramatically.", s: "Still mildly annoying without sleeves." }
      ]
    },
    scorching: {
      clean: [
        { h: "Very hot conditions outdoors.", s: "Drink plenty of water and take breaks in the shade." },
        { h: "Extreme warmth at the station.", s: "Schedule heavy outdoor work for early morning or evening." },
        { h: "High heat outside today.", s: "Check pets and keep cool indoors." }
      ],
      snarky: [
        { h: "Surface of the sun conditions outside.", s: "Do not touch a dark seatbelt buckle with bare skin." },
        { h: "Hot enough to fry bacon on the car hood.", s: "If you have air conditioning, hug it gently." },
        { h: "Sweltering outside. Shade is your only friend.", s: "Drink water like your kidneys depend on it." }
      ],
      unfiltered: [
        { h: "It is hotter than Satan's armpit out there.", s: "Stay in the damn AC before you melt into the asphalt." },
        { h: "Disgustingly hot outside.", s: "You step outside and immediately start sweating from places you forgot existed." },
        { h: "Fuck this heat. Too damn hot.", s: "Hydrate or perish dramatically on the patio." }
      ]
    },
    warm_muggy: {
      clean: [
        { h: "Warm and humid outside.", s: "Sticky air makes outdoor activity feel warmer than the reading." },
        { h: "Muggy conditions right now.", s: "Stay hydrated and expect condensation on cold drinks." },
        { h: "Warm, moisture-heavy air.", s: "Summer humidity hanging over the station." }
      ],
      snarky: [
        { h: "Warm, sticky, and basically breathable soup.", s: "Showering right before going outside is completely pointless today." },
        { h: "Humidity is turned up to maximum swamp.", s: "Walk outside and instantly need a second shower." },
        { h: "Muggy enough to chew the air.", s: "Your shirt is clinging to your back already, isn't it?" }
      ],
      unfiltered: [
        { h: "Swamp-ass weather outside.", s: "Thick, sticky humidity making everything sweaty and gross." },
        { h: "Hot and muggy as shit.", s: "Feels like breathing through a warm wet towel." },
        { h: "Absolute soup outside right now.", s: "Chafing forecast is high. Proceed with caution." }
      ]
    },
    nice: {
      clean: [
        { h: "Pleasant, comfortable weather outdoors.", s: "Great stretch to open a window or get outside." },
        { h: "Clear, comfortable conditions.", s: "Mild breeze and pleasant temperatures right now." },
        { h: "Ideal outdoor weather today.", s: "Make the most of it before the next system rolls through." }
      ],
      snarky: [
        { h: "Actually decent outside. Do not get used to it.", s: "Quick, go enjoy it before the forecast notices and ruins everything." },
        { h: "Wait—is the weather actually good right now?", s: "Even the grumpiest station sensor cannot find much to complain about." },
        { h: "Suspiciously pleasant outside.", s: "Get out there now before tomorrow returns to chaos." }
      ],
      unfiltered: [
        { h: "It is actually fucking nice out.", s: "Get off your screen and go enjoy it before Nova Scotia remembers its job." },
        { h: "Rare, glorious non-shitty weather today.", s: "Zero complaints. Go touch grass immediately." },
        { h: "Holy hell, look at that comfortable weather.", s: "Savor it while you can; rain is probably waiting down the coast." }
      ]
    },
    overcast: {
      clean: [
        { h: "Overcast skies across the area.", s: "Steady cloud cover holding down sunlight today." },
        { h: "Gray and cloudy outdoors.", s: "Quiet skies for now, though keeping a coat nearby never hurts." },
        { h: "Blanket of clouds overhead.", s: "Muted daylight across the valley." }
      ],
      snarky: [
        { h: "Fifty shades of damp gray overhead.", s: "Look up: it is basically the color of wet concrete." },
        { h: "Clouds filed an injunction against sunshine today.", s: "Not terrible, just deeply unenthusiastic weather." },
        { h: "Overcast and brooding outside.", s: "Sun took a personal day without leaving a note." }
      ],
      unfiltered: [
        { h: "Gray, boring-ass sky out there.", s: "Not quite raining, not sunny—just existential cloud ceiling." },
        { h: "Clouds everywhere. Zero sun.", s: "Atmosphere is phoning it in completely today." },
        { h: "Gloomy overcast bullshit overhead.", s: "At least you're not getting poured on—yet." }
      ]
    },
    mild: {
      clean: [
        { h: "Calm, unremarkable weather outside.", s: "No weather drama at the station right now." },
        { h: "Mild and settled outdoors.", s: "Comfortable enough with just a light layer." },
        { h: "Steady conditions right now.", s: "Everything looks calm on the sensors." }
      ],
      snarky: [
        { h: "Aggressively average weather outside.", s: "Not hot, not freezing, not storming—just existing." },
        { h: "Mild conditions. Zero excuses left to skip errands.", s: "Mother Nature hit cruise control and walked away." },
        { h: "Completely uneventful outdoors.", s: "Honestly, take the win while things stay calm." }
      ],
      unfiltered: [
        { h: "Just some plain-ass weather out there.", s: "Could be way worse. Don't jinx it." },
        { h: "Meh. Totally unremarkable weather.", s: "Sensors are bored, wind is lazy, go get a coffee." },
        { h: "No storms, no freezing hellscape—just mild air.", s: "Enjoy the boring stretch before the next shitshow rolls in." }
      ]
    }
  };

  function toCelsius(val, tempType) {
    if (typeof val !== "number" || !Number.isFinite(val)) return null;
    return String(tempType || "").includes("F") ? ((val - 32) * 5) / 9 : val;
  }

  function toKmh(val, windType) {
    if (typeof val !== "number" || !Number.isFinite(val)) return null;
    const t = String(windType || "");
    if (t.includes("mile")) return val * 1.60934;
    if (t.includes("knot")) return val * 1.852;
    if (t.includes("meter")) return val * 3.6;
    return val;
  }

  function toMm(val, rainType) {
    if (typeof val !== "number" || !Number.isFinite(val)) return null;
    return String(rainType || "").includes("inch") ? val * 25.4 : val;
  }

  function getNormalizedQuipObs() {
    const obs = CFG.currentObs || {};
    const units = CFG.units || {};
    const strikesRaw = obs.lightningStrikes ?? obs.lightningStrikesToday;
    return {
      tempC: toCelsius(obs.outTemp, units.tempType),
      feelsLikeC: toCelsius(obs.feelsLike, units.tempType),
      humidity: typeof obs.outHumidity === "number" && Number.isFinite(obs.outHumidity) ? obs.outHumidity : null,
      windKmh: toKmh(obs.windSpeed, units.windType),
      windGustKmh: toKmh(obs.windGust, units.windType),
      rainRateMmH: toMm(obs.rainRate, units.rainType),
      rainTodayMm: toMm(obs.rainToday, units.rainType),
      lightningStrikes: typeof strikesRaw === "number" && Number.isFinite(strikesRaw) ? strikesRaw : 0
    };
  }

  function classifyQuipBucket(obs, om) {
    const wmo = om && typeof om.weather_code === "number" ? om.weather_code : null;
    const cloudCover = om && typeof om.cloud_cover === "number" ? om.cloud_cover : null;
    const feelsC = obs.feelsLikeC !== null ? obs.feelsLikeC : obs.tempC;
    const rainRate = obs.rainRateMmH || 0;

    if (wmo === 95 || wmo === 96 || wmo === 99 || (obs.lightningStrikes > 0 && (rainRate > 0 || (wmo !== null && wmo >= 80)))) {
      return "thunderstorm";
    }
    if (wmo === 56 || wmo === 57 || wmo === 66 || wmo === 67 || (rainRate > 0.1 && obs.tempC !== null && obs.tempC <= 0.5)) {
      return "freezing_rain";
    }
    if (wmo === 71 || wmo === 73 || wmo === 75 || wmo === 77 || wmo === 85 || wmo === 86) {
      return "snow";
    }
    if (rainRate >= 6 || wmo === 65 || wmo === 82) {
      return "heavy_rain";
    }
    if (rainRate > 0.1 || wmo === 51 || wmo === 53 || wmo === 55 || wmo === 61 || wmo === 63 || wmo === 80 || wmo === 81) {
      return "rain";
    }
    if (wmo === 45 || wmo === 48) {
      return "fog";
    }
    if ((obs.windGustKmh !== null && obs.windGustKmh >= 55) || (obs.windKmh !== null && obs.windKmh >= 40)) {
      return "gale";
    }
    if (feelsC !== null && feelsC <= -12) {
      return "bitter_cold";
    }
    if (feelsC !== null && feelsC <= 0) {
      return "freezing";
    }
    if (feelsC !== null && feelsC <= 8 && obs.humidity !== null && obs.humidity >= 82) {
      return "chilly_damp";
    }
    if (feelsC !== null && feelsC <= 10) {
      return "chilly";
    }
    if (feelsC !== null && feelsC >= 30) {
      return "scorching";
    }
    if (feelsC !== null && feelsC >= 24 && obs.humidity !== null && obs.humidity >= 70) {
      return "warm_muggy";
    }
    if (
      feelsC !== null &&
      feelsC >= 16 &&
      feelsC <= 26 &&
      (obs.windKmh === null || obs.windKmh < 24) &&
      (cloudCover === null || cloudCover < 55)
    ) {
      return "nice";
    }
    if (wmo === 3 || (cloudCover !== null && cloudCover >= 75)) {
      return "overcast";
    }
    return "mild";
  }

  function normalizeQuipTone(tone) {
    const t = String(tone || "").toLowerCase();
    return t === "clean" || t === "snarky" || t === "unfiltered" ? t : "snarky";
  }

  function readQuipTone() {
    try {
      const stored = localStorage.getItem(QUIP_TONE_KEY);
      if (stored === "clean" || stored === "snarky" || stored === "unfiltered") {
        return stored;
      }
    } catch {
      // Ignore storage errors
    }
    return normalizeQuipTone(CFG.quipTone);
  }

  function renderWeatherQuip() {
    if (CFG.showQuip === false) return;
    const headlineEl = document.getElementById("quip-headline");
    const subtextEl = document.getElementById("quip-subtext");
    const selectEl = document.getElementById("quip-tone-select");
    if (!headlineEl || !subtextEl) return;

    const tone = readQuipTone();
    if (selectEl && selectEl.value !== tone) {
      selectEl.value = tone;
    }

    const bucket = classifyQuipBucket(getNormalizedQuipObs(), latestOpenMeteoCurrent);
    const pool = (QUIP_LIBRARY[bucket] && QUIP_LIBRARY[bucket][tone]) || QUIP_LIBRARY.mild.snarky;
    const idx = (Math.floor(Date.now() / 3600000) + quipOffset) % pool.length;
    const choice = pool[idx];
    headlineEl.textContent = choice.h;
    subtextEl.textContent = choice.s;
  }

  function initWeatherQuip() {
    if (CFG.showQuip === false) return;
    const selectEl = document.getElementById("quip-tone-select");
    const rerollBtn = document.getElementById("quip-reroll-btn");

    if (selectEl) {
      selectEl.value = readQuipTone();
      selectEl.addEventListener("change", () => {
        const nextTone = normalizeQuipTone(selectEl.value);
        try {
          localStorage.setItem(QUIP_TONE_KEY, nextTone);
        } catch {
          // Ignore storage restrictions
        }
        quipOffset = 0;
        renderWeatherQuip();
      });
    }

    if (rerollBtn) {
      rerollBtn.addEventListener("click", () => {
        quipOffset += 1;
        renderWeatherQuip();
      });
    }

    renderWeatherQuip();
  }

  async function refreshCurrentJson() {
    try {
      const res = await fetch("data/current.json", { cache: "no-store" });
      if (!res.ok) return;
      const payload = await res.json();
      const updatedEl = document.getElementById("last-updated-text");
      if (updatedEl && payload.generatedFormatted) {
        updatedEl.textContent = `Updated ${payload.generatedFormatted}`;
      }
      if (Object.prototype.hasOwnProperty.call(payload, "generated")) {
        CFG.lastReportEpoch = payload.generated;
        updateConnectionStatus(payload.generated);
      }
      if (payload.current && typeof payload.current === "object") {
        CFG.currentObs = { ...(CFG.currentObs || {}), ...payload.current };
        renderWeatherQuip();
      }
    } catch {
      // Ignore if opened locally via file:// where fetch is restricted
    }
  }

  /* ---------------- Local Tides Card ---------------- */
  function interpolateTideHeight(events, targetMs) {
    if (!Array.isArray(events) || events.length < 2) return null;
    for (let i = 0; i < events.length - 1; i++) {
      const a = events[i];
      const b = events[i + 1];
      if (targetMs >= a.ms && targetMs <= b.ms && b.ms > a.ms) {
        const ratio = (targetMs - a.ms) / (b.ms - a.ms);
        const h = (a.value + b.value) / 2 - ((b.value - a.value) / 2) * Math.cos(Math.PI * ratio);
        return {
          height: h,
          rising: b.value > a.value,
          prev: a,
          next: b,
          ratio
        };
      }
    }
    const first = events[0];
    const second = events[1];
    const halfPeriod = 6.2103 * 3600 * 1000;
    const dt = (targetMs - first.ms) / halfPeriod;
    const mid = (first.value + second.value) / 2;
    const amp = Math.abs(first.value - second.value) / 2;
    const sign = first.type === "high" ? 1 : -1;
    return {
      height: mid + sign * amp * Math.cos(Math.PI * dt),
      rising: Math.sin(Math.PI * dt) * sign < 0,
      prev: first,
      next: second,
      ratio: 0.5
    };
  }

  function renderTidesCard() {
    if (CFG.showTides === false) return;
    const tidesCfg = CFG.tides;
    const stateEl = document.getElementById("tide-current-state");
    const nextEl = document.getElementById("tide-next-summary");
    const heightEl = document.getElementById("tide-current-height");
    const svgWrap = document.getElementById("tide-svg-wrap");
    const gridEl = document.getElementById("tide-events-grid");
    if (!tidesCfg || !Array.isArray(tidesCfg.events) || !gridEl) return;

    const tideUnit = tidesCfg.unit === "ft" ? "ft" : "m";
    const tideScale = tideUnit === "ft" ? 3.28084 : 1.0;
    const events = tidesCfg.events
      .map((e) => ({
        ms: Date.parse(e.eventDate),
        value: Number(e.value) * tideScale,
        type: e.type === "low" ? "low" : "high"
      }))
      .filter((e) => Number.isFinite(e.ms) && Number.isFinite(e.value))
      .sort((a, b) => a.ms - b.ms);

    if (events.length < 2) return;

    const nowMs = Date.now();
    const interp = interpolateTideHeight(events, nowMs);
    if (interp && heightEl) {
      heightEl.textContent = `${interp.height.toFixed(1)} ${tideUnit}`;
    }
    if (interp && stateEl) {
      const arrow = interp.rising ? "▲" : "▼";
      const pct = Math.round(Math.min(100, Math.max(0, interp.ratio * 100)));
      stateEl.textContent = `${interp.rising ? "Rising Tide" : "Falling Tide"} ${arrow} (${pct}%)`;
      stateEl.className = `tide-state-label ${interp.rising ? "is-rising" : "is-falling"}`;
    }

    const upcoming = events.filter((e) => e.ms >= nowMs - 15 * 60 * 1000).slice(0, 4);
    const displayEvents = upcoming.length >= 2 ? upcoming : events.slice(-4);

    if (nextEl && displayEvents.length > 0) {
      const nextEv = displayEvents.find((e) => e.ms >= nowMs) || displayEvents[0];
      const nextTime = new Date(nextEv.ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const diffMin = Math.max(0, Math.round((nextEv.ms - nowMs) / 60000));
      const hrs = Math.floor(diffMin / 60);
      const mins = diffMin % 60;
      const inStr = hrs > 0 ? `in ${hrs}h ${mins}m` : `in ${mins}m`;
      nextEl.textContent = `Next: ${nextEv.type === "high" ? "High" : "Low"} (${nextEv.value.toFixed(1)} ${tideUnit}) at ${nextTime} (${inStr})`;
    }

    gridEl.replaceChildren();
    displayEvents.forEach((ev) => {
      const dt = new Date(ev.ms);
      const timeStr = dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const dayStr = dt.toLocaleDateString([], { weekday: "short" });
      const isHigh = ev.type === "high";

      const tile = makeEl("div", `tide-event-tile ${isHigh ? "is-high" : "is-low"}`);
      const top = makeEl("div", "tide-event-top");
      top.appendChild(
        makeEl("span", `tide-event-badge ${isHigh ? "is-high" : "is-low"}`, isHigh ? "▲ High Tide" : "▼ Low Tide")
      );
      top.appendChild(makeEl("span", "tide-event-day", dayStr));

      const bottom = makeEl("div", "tide-event-bottom");
      bottom.appendChild(makeEl("span", "tide-event-time", timeStr));
      bottom.appendChild(makeEl("span", "tide-event-height", `${ev.value.toFixed(1)} ${tideUnit}`));

      tile.appendChild(top);
      tile.appendChild(bottom);
      gridEl.appendChild(tile);
    });

    if (svgWrap) {
      const startMs = nowMs - 6 * 3600 * 1000;
      const endMs = nowMs + 18 * 3600 * 1000;
      const w = 560;
      const h = 112;
      const padX = 14;
      const padY = 18;
      const plotW = w - padX * 2;
      const plotH = h - padY * 2;

      const vals = events.map((e) => e.value);
      const minH = Math.min(0, ...vals);
      const maxH = Math.max(14, ...vals);
      const spanH = Math.max(1, maxH - minH);

      const xFor = (ms) => padX + ((ms - startMs) / (endMs - startMs)) * plotW;
      const yFor = (val) => padY + plotH - ((val - minH) / spanH) * plotH;

      const samples = 64;
      const pts = [];
      for (let i = 0; i <= samples; i++) {
        const ms = startMs + ((endMs - startMs) * i) / samples;
        const st = interpolateTideHeight(events, ms);
        const val = st ? st.height : (minH + maxH) / 2;
        pts.push({ x: xFor(ms), y: yFor(val) });
      }

      const linePath = pts
        .map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(" ");
      const areaPath =
        `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${(h - 6).toFixed(1)} ` +
        `L${pts[0].x.toFixed(1)},${(h - 6).toFixed(1)} Z`;

      const nowX = xFor(nowMs);
      const nowY = interp ? yFor(interp.height) : h / 2;

      const svgNs = "http://www.w3.org/2000/svg";
      const makeSvg = (tag, attrs) => {
        const el = document.createElementNS(svgNs, tag);
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
        return el;
      };

      const svgEl = makeSvg("svg", {
        class: "tide-curve-svg",
        viewBox: `0 0 ${w} ${h}`,
        preserveAspectRatio: "none"
      });
      const defs = makeSvg("defs", {});
      const grad = makeSvg("linearGradient", { id: "tideAreaGrad", x1: 0, y1: 0, x2: 0, y2: 1 });
      grad.appendChild(makeSvg("stop", { offset: "0%", "stop-color": "var(--accent-cyan)", "stop-opacity": "0.32" }));
      grad.appendChild(makeSvg("stop", { offset: "100%", "stop-color": "var(--accent-cyan)", "stop-opacity": "0.02" }));
      defs.appendChild(grad);
      svgEl.appendChild(defs);

      svgEl.appendChild(makeSvg("path", { d: areaPath, fill: "url(#tideAreaGrad)" }));
      svgEl.appendChild(
        makeSvg("path", {
          d: linePath,
          fill: "none",
          stroke: "var(--accent-cyan)",
          "stroke-width": "2.2",
          "stroke-linecap": "round"
        })
      );
      svgEl.appendChild(
        makeSvg("line", {
          x1: nowX.toFixed(1),
          y1: "8",
          x2: nowX.toFixed(1),
          y2: String(h - 6),
          stroke: "var(--text-secondary)",
          "stroke-width": "1.2",
          "stroke-dasharray": "3 3"
        })
      );
      svgEl.appendChild(
        makeSvg("circle", {
          cx: nowX.toFixed(1),
          cy: nowY.toFixed(1),
          r: "4.5",
          fill: "var(--accent-cyan)",
          stroke: "var(--bg-card)",
          "stroke-width": "2"
        })
      );
      svgWrap.replaceChildren(svgEl);
    }
  }

  /* ---------------- Air Quality & UV Card ---------------- */
  function classifyAqiTier(aqi) {
    if (!Number.isFinite(aqi)) {
      return { label: "Unavailable", cls: "is-good", pct: 10, summary: "Air quality telemetry temporarily unavailable." };
    }
    if (aqi <= 50) {
      return {
        label: "Good",
        cls: "is-good",
        pct: Math.max(8, Math.round((aqi / 200) * 100)),
        summary: "Clean air outside. Ideal conditions for outdoor activities and running."
      };
    }
    if (aqi <= 100) {
      return {
        label: "Moderate",
        cls: "is-moderate",
        pct: Math.min(100, Math.round((aqi / 200) * 100)),
        summary: "Air quality is acceptable; unusually smoke-sensitive individuals should monitor heavy exertion."
      };
    }
    if (aqi <= 150) {
      return {
        label: "Sensitive",
        cls: "is-sensitive",
        pct: Math.min(100, Math.round((aqi / 200) * 100)),
        summary: "Elevated particulates or wildfire smoke. Sensitive groups should reduce prolonged outdoor exertion."
      };
    }
    return {
      label: "Unhealthy",
      cls: "is-unhealthy",
      pct: 100,
      summary: "Poor air quality or heavy smoke present. Limit intense outdoor workouts today."
    };
  }

  async function fetchAirQuality() {
    if (CFG.showAirQuality === false) return;
    const heroEl = document.getElementById("aqi-hero-value");
    if (!heroEl) return;

    const lat = Number(CFG.lat);
    const lon = Number(CFG.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const url =
      `https://air-quality-api.open-meteo.com/v1/air-quality` +
      `?latitude=${encodeURIComponent(lat)}` +
      `&longitude=${encodeURIComponent(lon)}` +
      `&current=us_aqi,european_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,ozone,uv_index,uv_index_clear_sky` +
      `&timezone=auto`;

    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const cur = (data && data.current) || {};
      const rawStandard = String(CFG.aqiStandard || "auto").toLowerCase();
      const standard =
        rawStandard === "auto" ? (lon >= -30 ? "european_aqi" : "us_aqi") : rawStandard;
      const usAqi = typeof cur.us_aqi === "number" ? Math.round(cur.us_aqi) : NaN;
      let displayVal = Number.isFinite(usAqi) ? String(usAqi) : "--";
      let tier = classifyAqiTier(usAqi);
      let labelText = "US AQI";

      if (standard === "european_aqi" && typeof cur.european_aqi === "number") {
        const euVal = Math.round(cur.european_aqi);
        displayVal = String(euVal);
        tier = classifyAqiTier(euVal * 1.6);
        labelText = "EAQI";
      } else if (standard === "ca_aqhi") {
        const o3Ppb = (Number(cur.ozone) || 0) / 1.96;
        const no2Ppb = (Number(cur.nitrogen_dioxide) || 0) / 1.88;
        const pm25 = Number(cur.pm2_5) || 0;
        const rawAqhi =
          (1000 / 10.4) *
          (Math.exp(0.000537 * o3Ppb) - 1 + (Math.exp(0.000871 * no2Ppb) - 1) + (Math.exp(0.000487 * pm25) - 1));
        const aqhi = Math.max(1, Math.min(11, Math.round(rawAqhi)));
        displayVal = aqhi > 10 ? "10+" : String(aqhi);
        tier = classifyAqiTier(aqhi <= 3 ? 35 : aqhi <= 6 ? 75 : aqhi <= 10 ? 125 : 175);
        labelText = "CA AQHI";
      }

      heroEl.textContent = displayVal;
      const labelEl = document.getElementById("aqi-score-label");
      if (labelEl) labelEl.textContent = labelText;

      const pillEl = document.getElementById("aqi-status-pill");
      if (pillEl) {
        pillEl.textContent = tier.label;
        pillEl.className = `aqi-status-pill ${tier.cls}`;
      }

      const fillEl = document.getElementById("aqi-meter-fill");
      if (fillEl) {
        fillEl.style.width = `${tier.pct}%`;
        fillEl.className = `aqi-meter-fill ${tier.cls}`;
      }

      const sumEl = document.getElementById("aqi-summary-text");
      if (sumEl) {
        sumEl.textContent = tier.summary;
      }

      const setTile = (id, val, unit, digits) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (typeof val === "number" && Number.isFinite(val)) {
          el.textContent = `${val.toFixed(digits)}${unit ? " " + unit : ""}`;
        } else {
          el.textContent = "--";
        }
      };

      setTile("aqi-pm25", cur.pm2_5, "μg/m³", 1);
      setTile("aqi-pm10", cur.pm10, "μg/m³", 1);
      setTile("aqi-uv", cur.uv_index, "", 1);
      setTile("aqi-o3", cur.ozone, "μg/m³", 0);
      setTile("aqi-no2", cur.nitrogen_dioxide, "μg/m³", 1);
      setTile("aqi-co", cur.carbon_monoxide, "μg/m³", 0);
    } catch {
      const sumEl = document.getElementById("aqi-summary-text");
      if (sumEl) {
        sumEl.textContent = "Unable to reach Open-Meteo Air Quality service right now.";
      }
    }
  }

  function initDashboardPage() {
    updateConnectionStatus(CFG.lastReportEpoch);
    initWeatherAlerts();
    initWeatherQuip();
    renderTidesCard();
    fetchAirQuality();

    const initialForecastMode = readForecastMode();
    syncForecastModeButtons(initialForecastMode);
    const strip = document.getElementById("forecast-strip");
    if (strip) {
      strip.classList.toggle("is-daily-list", initialForecastMode === "daily");
      strip.classList.toggle("is-hourly-strip", initialForecastMode === "hourly");
    }

    document.querySelectorAll("[data-forecast-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const chosen = saveForecastMode(btn.getAttribute("data-forecast-mode"));
        renderForecastStrip(chosen);
      });
    });

    const modeSelect = document.getElementById("forecast-mode");
    if (modeSelect) {
      modeSelect.value = initialForecastMode;
      modeSelect.addEventListener("change", () => {
        const chosen = saveForecastMode(modeSelect.value);
        renderForecastStrip(chosen);
      });
    }

    if (CFG.showForecast !== false) {
      fetchOpenMeteo(false);
    }

    const actionBtn = document.getElementById("header-action-btn");
    if (actionBtn) {
      actionBtn.addEventListener("click", async () => {
        actionBtn.classList.add("is-spinning");
        await Promise.all([
          refreshCurrentJson(),
          fetchOpenMeteo(true),
          fetchWeatherAlerts(),
          fetchAirQuality()
        ]);
        actionBtn.classList.remove("is-spinning");
      });
    }

    // Periodically re-check station archive freshness while dashboard stays open
    window.setInterval(() => {
      refreshCurrentJson();
    }, 60000);
  }

  function initStationPage() {
    updateConnectionStatus(CFG.lastReportEpoch);
    if (CFG.showForecast !== false) {
      fetchOpenMeteo(false);
    }
    window.setInterval(() => {
      refreshCurrentJson();
    }, 60000);
  }

  /* ---------------- What to Wear Sub-Page Controller ---------------- */
  const RUN_PREFS_KEY = "frostline:run-prefs:v1";
  const SAR_ROLE_KEY = "frostline:sar-role:v1";

  function getWearIconSvg(kind) {
    const common = `${SVG_XMLNS} viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
    if (kind === "head") {
      return `<svg ${common}><path d="M4 15a8 8 0 0 1 16 0v2H4v-2Z"/><path d="M2 17h20"/><circle cx="12" cy="5" r="1.5"/></svg>`;
    }
    if (kind === "outer") {
      return `<svg ${common}><path d="M8 3 4 7v13h6v-9h4v9h6V7l-4-4-2.5 2h-3L8 3Z"/><line x1="12" y1="5" x2="12" y2="20"/></svg>`;
    }
    if (kind === "top") {
      return `<svg ${common}><path d="M8.5 4 4 7.5 6 11l2-1.5V20h8V9.5L18 11l2-3.5L15.5 4c-1 1.5-2 2-3.5 2S9.5 5.5 8.5 4Z"/></svg>`;
    }
    if (kind === "bottoms") {
      return `<svg ${common}><path d="M6 4h12l1 16h-5l-2-9-2 9H5L6 4Z"/></svg>`;
    }
    if (kind === "hands") {
      return `<svg ${common}><path d="M18 11V6a2 2 0 0 0-4 0v4"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8a6 6 0 0 0 12 0v-2.5a1.5 1.5 0 0 0-3 0"/></svg>`;
    }
    if (kind === "footwear") {
      return `<svg ${common}><path d="M4 16v-5l4-1 4 4h6a2 2 0 0 1 2 2v2H4v-2Z"/><line x1="4" y1="18" x2="20" y2="18"/></svg>`;
    }
    if (kind === "pack") {
      return `<svg ${common}><rect x="5" y="6" width="14" height="15" rx="3"/><path d="M9 6V4a3 3 0 0 1 6 0v2"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="12" y1="10" x2="12" y2="14"/></svg>`;
    }
    if (kind === "shield") {
      return `<svg ${common}><path d="M12 3 4 7v6c0 5 3.4 7.8 8 9 4.6-1.2 8-4 8-9V7l-8-4Z"/><path d="M12 8v5"/><circle cx="12" cy="16" r="0.8" fill="currentColor"/></svg>`;
    }
    return `<svg ${common}><path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9Z"/><path d="M12 12v6a2 2 0 0 1-4 0"/></svg>`;
  }

  function formatUserTemp(tempC) {
    const units = CFG.units || {};
    const isF = String(units.tempType || "").includes("F");
    const label = units.tempLabel || (isF ? "°F" : "°C");
    if (!Number.isFinite(tempC)) return `-- ${label}`;
    const v = isF ? (tempC * 9) / 5 + 32 : tempC;
    return `${v.toFixed(1)} ${label}`;
  }

  function formatUserWind(windKmh) {
    const units = CFG.units || {};
    const wt = String(units.windType || "");
    const label = units.windLabel || "km/h";
    if (!Number.isFinite(windKmh)) return `-- ${label}`;
    let v = windKmh;
    if (wt.includes("mile")) v = windKmh / 1.60934;
    else if (wt.includes("knot")) v = windKmh / 1.852;
    else if (wt.includes("meter")) v = windKmh / 3.6;
    return `${Math.round(v)} ${label}`;
  }

  function buildRegularOutfit(slot) {
    const f = slot.feelsC;
    const raining = slot.isRaining;
    const snowing = slot.isSnowing;
    const windy = slot.windKmh >= 28;
    const sunny = slot.isSunny && slot.isDay;
    const items = [];

    if (f <= -8) {
      items.push({ kind: "head", slot: "Head & Neck", item: "Heavy Fleece Beanie + Neck Gaiter", note: "Cover ears and neck against biting wind chill." });
    } else if (f <= 4) {
      items.push({ kind: "head", slot: "Head & Eyes", item: "Warm Knit Beanie / Toque", note: "Keep body heat from escaping while outdoors." });
    } else if (sunny && f >= 18) {
      items.push({ kind: "head", slot: "Head & Eyes", item: "Sun Cap & Polarized Sunglasses", note: "Bright sun overhead; shield eyes and face." });
    } else {
      items.push({ kind: "head", slot: "Head & Eyes", item: sunny ? "Sunglasses" : "No Hat Required", note: "Mild enough for bare head; optional cap in breeze." });
    }

    if (snowing || f <= -10) {
      items.push({ kind: "outer", slot: "Outer Layer", item: "Insulated Winter Parka", note: "Full winter insulation needed for freezing conditions." });
    } else if (raining && f <= 10) {
      items.push({ kind: "outer", slot: "Outer Layer", item: "Waterproof Hardshell + Warm Liner", note: "Block cold rain and wind chill simultaneously." });
    } else if (raining) {
      items.push({ kind: "outer", slot: "Outer Layer", item: "Breathable Waterproof Rain Jacket", note: "Sealed seams beat an umbrella in gusty rain." });
    } else if (f <= 3) {
      items.push({ kind: "outer", slot: "Outer Layer", item: "Puffer Jacket or Heavy Wool Coat", note: "Near-freezing air calls for real insulation." });
    } else if (f <= 12 || windy) {
      items.push({ kind: "outer", slot: "Outer Layer", item: "Windproof Softshell or Medium Jacket", note: "Cuts damp Maritime breeze without overheating." });
    } else if (f <= 18) {
      items.push({ kind: "outer", slot: "Outer Layer", item: "Light Overshirt or Denim/Bomber Jacket", note: "Easy layer to shed indoors." });
    } else {
      items.push({ kind: "outer", slot: "Outer Layer", item: "No Coat Needed", note: "Warm enough to head straight out in a single layer." });
    }

    if (f <= -5) {
      items.push({ kind: "top", slot: "Top / Mid Layer", item: "Thermal Base Layer + Heavy Sweater/Fleece", note: "Trap warm air in two breathable layers." });
    } else if (f <= 8) {
      items.push({ kind: "top", slot: "Top / Mid Layer", item: "Sweater, Hoodie, or Flannel over Tee", note: "Comfortable mid-layer for cool damp air." });
    } else if (f <= 17) {
      items.push({ kind: "top", slot: "Top / Mid Layer", item: "Long-Sleeve Shirt or Light Crewneck", note: "Balanced coverage for mild conditions." });
    } else {
      items.push({ kind: "top", slot: "Top / Mid Layer", item: "Short-Sleeve T-Shirt or Polo", note: "Light, breathable fabric for warm air." });
    }

    if (f <= -8) {
      items.push({ kind: "bottoms", slot: "Bottoms", item: "Thermal Base Tights + Heavy Pants", note: "Single-layer denim freezes fast at this temperature." });
    } else if (f <= 20) {
      items.push({ kind: "bottoms", slot: "Bottoms", item: "Jeans, Chinos, or Casual Trousers", note: "Standard full-length pants." });
    } else {
      items.push({ kind: "bottoms", slot: "Bottoms", item: "Shorts or Lightweight Linen/Cotton Pants", note: "Stay cool and ventilated." });
    }

    if (snowing || f <= -2) {
      items.push({ kind: "footwear", slot: "Footwear", item: "Insulated Winter Boots + Merino Socks", note: "Grip for frost/ice and warm toes." });
    } else if (raining || slot.humidity >= 88) {
      items.push({ kind: "footwear", slot: "Footwear", item: "Waterproof Boots or Treated Leather Shoes", note: "Keep socks dry on wet pavement." });
    } else if (f >= 23) {
      items.push({ kind: "footwear", slot: "Footwear", item: "Breathable Mesh Sneakers or Sandals", note: "Light footwear for warm pavement." });
    } else {
      items.push({ kind: "footwear", slot: "Footwear", item: "Everyday Sneakers or Casual Boots", note: "Dry conditions on roads and sidewalks." });
    }

    if (raining) {
      items.push({ kind: "extras", slot: "Extras & Carry", item: windy ? "Reinforced Vent Umbrella (or Skip It)" : "Compact Umbrella", note: windy ? "High gusts may invert cheap umbrellas—rely on your hood." : "Keep in bag or car door." });
    } else if (f <= 3) {
      items.push({ kind: "hands", slot: "Extras & Carry", item: "Insulated Gloves", note: "Hands chill quickly once feels-like drops near zero." });
    } else if (sunny && f >= 16) {
      items.push({ kind: "extras", slot: "Extras & Carry", item: "SPF 30+ Sunscreen & Water Bottle", note: "UV and warmth add up during midday errands." });
    } else {
      items.push({ kind: "extras", slot: "Extras & Carry", item: "No Special Gear Needed", note: "Grab keys and go." });
    }

    return items;
  }

  function buildRunningOutfit(slot, thermalOffsetC, effortOffsetC) {
    // Running warmth model: running adds ~10°C (18°F) to effective feel, adjusted by wind, sun, and runner preference
    const sunBonus = slot.isSunny && slot.isDay ? 1.5 : 0;
    const windPenalty = slot.windKmh >= 25 ? -1.5 : 0;
    const rainPenalty = slot.isRaining ? -1.5 : 0;
    const runFeelC = slot.feelsC + 10 + sunBonus + windPenalty + rainPenalty - thermalOffsetC + effortOffsetC;
    const items = [];

    if (runFeelC <= 2) {
      items.push({ kind: "head", slot: "Head & Ears", item: "Thermal Running Beanie + Buff / Neck Gaiter", note: "Protect ears and warm inhaled air on frigid miles." });
    } else if (runFeelC <= 10) {
      items.push({ kind: "head", slot: "Head & Ears", item: "Fleece Ear Warmer Headband or Thin Beanie", note: "Ears get cold even when your core warms up after 2 km." });
    } else if (slot.isRaining) {
      items.push({ kind: "head", slot: "Head & Ears", item: "Brimmed Running Cap", note: "Keeps rain off your eyes and glasses." });
    } else if (slot.isSunny && slot.isDay) {
      items.push({ kind: "head", slot: "Head & Ears", item: "Breathable Running Cap / Visor + Sunglasses", note: "Sweatband + glare protection." });
    } else {
      items.push({ kind: "head", slot: "Head & Ears", item: "Bare Head (or Light Sweatband)", note: "Maximum heat dissipation once you hit tempo." });
    }

    if (runFeelC <= 1) {
      items.push({ kind: "outer", slot: "Torso (Base + Outer)", item: "Merino Base Layer + Thermal Half-Zip + Windproof Shell", note: "Three technical layers to block sub-zero wind chill." });
    } else if (runFeelC <= 10) {
      items.push({ kind: "outer", slot: "Torso (Base + Outer)", item: slot.isRaining ? "Long-Sleeve Tech Shirt + Waterproof Running Shell" : "Thermal Long-Sleeve + Windproof Running Vest or Jacket", note: "Start slightly chilly for the first 5 minutes so you don't overheat." });
    } else if (runFeelC <= 18) {
      items.push({ kind: "top", slot: "Torso", item: slot.isRaining ? "Short-Sleeve Tech Tee + Light Water-Resistant Shell" : "Long-Sleeve Technical Running Shirt", note: "Roll sleeves up at mile 2 if you warm up fast." });
    } else if (runFeelC <= 25) {
      items.push({ kind: "top", slot: "Torso", item: "Short-Sleeve Technical T-Shirt", note: "Classic moisture-wicking tee; avoid cotton." });
    } else {
      items.push({ kind: "top", slot: "Torso", item: "Running Singlet / Ultralight Tank", note: "Warm run feel—prioritize airflow and sweat evaporation." });
    }

    if (runFeelC <= 3) {
      items.push({ kind: "bottoms", slot: "Bottoms", item: "Thermal Brushed Tights (Wind-Block Front)", note: "Keeps hamstrings and knees warm against freezing headwinds." });
    } else if (runFeelC <= 13) {
      items.push({ kind: "bottoms", slot: "Bottoms", item: "Full-Length Running Tights", note: "Snug technical tights for crisp conditions." });
    } else if (runFeelC <= 17) {
      items.push({ kind: "bottoms", slot: "Bottoms", item: "Running Shorts or Half-Tights / Capris", note: "Transition zone—legs generate plenty of heat once moving." });
    } else if (runFeelC <= 26) {
      items.push({ kind: "bottoms", slot: "Bottoms", item: "5\"–7\" Running Shorts", note: "Sweet-spot shorts weather." });
    } else {
      items.push({ kind: "bottoms", slot: "Bottoms", item: "Split Shorts / Lightest 3\"–5\" Shorts", note: "Maximum ventilation for warm miles." });
    }

    if (runFeelC <= 5) {
      items.push({ kind: "hands", slot: "Hands", item: "Thermal Windproof Running Gloves or Mittens", note: "Fingers are the last extremity to warm up on winter runs." });
    } else if (runFeelC <= 14) {
      items.push({ kind: "hands", slot: "Hands", item: "Lightweight Liner Running Gloves", note: "Easy to tuck into your waistband halfway through the run." });
    } else {
      items.push({ kind: "hands", slot: "Hands", item: "No Gloves Needed", note: "Hands will stay comfortable from mile 1." });
    }

    if (slot.isSnowing || slot.feelsC <= -3) {
      items.push({ kind: "footwear", slot: "Feet & Visibility", item: "Trail / Gore-Tex Shoes + Merino Crew Socks", note: !slot.isDay ? "Add reflective vest & headlamp for dark winter roads." : "Watch for black ice on shaded shoulders." });
    } else if (slot.isRaining) {
      items.push({ kind: "footwear", slot: "Feet & Visibility", item: "Grippy Road Shoes + Anti-Blister Synthetic/Wool Socks", note: "Avoid cotton socks that blister when wet." });
    } else {
      items.push({ kind: "footwear", slot: "Feet & Visibility", item: "Standard Road Trainers + Light Tech Socks", note: !slot.isDay ? "Wear high-vis gear or a clip light after sunset." : "Great footing on dry pavement." });
    }

    return { runFeelC, items };
  }

  function computeSar12hEnvelope(slot, forecastData) {
    const obs = CFG.currentObs || {};
    const baroTrend = typeof obs.barometerTrend === "number" && Number.isFinite(obs.barometerTrend) ? obs.barometerTrend : 0;
    const baroFalling = baroTrend < -0.8;
    const startMs = typeof slot.targetMs === "number" && Number.isFinite(slot.targetMs) ? slot.targetMs : Date.now();

    let minFeelsC = slot.feelsC - (baroFalling ? 4.5 : 3.0);
    let maxFeelsC = slot.feelsC;
    let maxPrecipProb = slot.isRaining || slot.isSnowing ? 85 : baroFalling ? 60 : 20;
    let maxWindKmh = Math.max(slot.windKmh * 1.3, toKmh(obs.windGust, (CFG.units || {}).windType) || slot.windKmh);
    let hasRain = Boolean(slot.isRaining);
    let hasSnowOrIce = Boolean(slot.isSnowing);
    let darkHours = 0;

    for (let step = 0; step < 12; step++) {
      const hr = new Date(startMs + step * 3600 * 1000).getHours();
      if (hr >= 17 || hr < 7) darkHours += 1;
    }

    if (forecastData && forecastData.hourly && Array.isArray(forecastData.hourly.time)) {
      const h = forecastData.hourly;
      const unitInfo = getOpenMeteoUnitParams();
      let startIdx = 0;
      let bestDist = Infinity;
      h.time.forEach((iso, idx) => {
        const dist = Math.abs(new Date(iso).getTime() - startMs);
        if (dist < bestDist) {
          bestDist = dist;
          startIdx = idx;
        }
      });

      const endIdx = Math.min(h.time.length, startIdx + 12);
      if (endIdx > startIdx) {
        minFeelsC = slot.feelsC;
        maxFeelsC = slot.feelsC;
        darkHours = 0;
        for (let i = startIdx; i < endIdx; i++) {
          const rawT = Number(h.temperature_2m[i]);
          const rawApp = h.apparent_temperature ? Number(h.apparent_temperature[i]) : rawT;
          const fC = unitInfo.tempParam === "fahrenheit" ? ((rawApp - 32) * 5) / 9 : rawApp;
          const tC = unitInfo.tempParam === "fahrenheit" ? ((rawT - 32) * 5) / 9 : rawT;
          if (Number.isFinite(fC)) {
            if (fC < minFeelsC) minFeelsC = fC;
            if (fC > maxFeelsC) maxFeelsC = fC;
          }
          const pp = Number(h.precipitation_probability ? h.precipitation_probability[i] : 0);
          if (Number.isFinite(pp) && pp > maxPrecipProb) maxPrecipProb = pp;

          const rawW = Number(h.wind_speed_10m[i] || 0);
          let wKmh = rawW;
          if (unitInfo.windParam === "mph") wKmh = rawW * 1.60934;
          else if (unitInfo.windParam === "kn") wKmh = rawW * 1.852;
          else if (unitInfo.windParam === "ms") wKmh = rawW * 3.6;
          if (Number.isFinite(wKmh) && wKmh > maxWindKmh) maxWindKmh = wKmh;

          const wmo = Number(h.weather_code[i] || 0);
          if (pp >= 45 || [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(wmo)) {
            hasRain = true;
          }
          if ([56, 57, 66, 67, 71, 73, 75, 77, 85, 86].includes(wmo) || (pp >= 40 && Number.isFinite(tC) && tC <= 0.5)) {
            hasSnowOrIce = true;
          }
          const hr = new Date(h.time[i]).getHours();
          if (hr >= 17 || hr < 7) darkHours += 1;
        }
      }
    }

    const freezeTransition = (slot.tempC > 0.5 && (hasRain || slot.humidity >= 82)) && minFeelsC <= 0;
    return {
      minFeelsC,
      maxFeelsC,
      maxPrecipProb: Math.round(maxPrecipProb),
      maxWindKmh: Math.round(maxWindKmh),
      hasRain,
      hasSnowOrIce,
      freezeTransition,
      baroFalling,
      darkHours
    };
  }

  function buildSarLoadout(slot, env, role) {
    const normalizedRole = role === "hasty" || role === "static" ? role : "grid";
    const roleMeta = {
      hasty: { label: "Hasty / Track Team (High Output)", heatOffsetC: 6 },
      grid: { label: "Grid / Brush Team (Standard)", heatOffsetC: 4 },
      static: { label: "Command / Rigging / Medical (Static)", heatOffsetC: 0 }
    }[normalizedRole];

    const moveFeelC = slot.feelsC + roleMeta.heatOffsetC;
    const wearNow = [];
    const pack12h = [];

    // --- COLUMN 1: WHAT TO WEAR NOW (ON BODY AT STAGING) ---
    if (moveFeelC <= -4) {
      wearNow.push({
        kind: "top",
        slot: "Base Layer (Zero Cotton)",
        item: "200–250 gsm Merino or Open-Mesh Base Top + 3/4 Thermal Bottoms",
        note: "Sub-zero deployment: trap warmth while wicking sweat away from skin."
      });
    } else if (moveFeelC <= 9) {
      wearNow.push({
        kind: "top",
        slot: "Base Layer (Zero Cotton)",
        item: "150–200 gsm Merino or Synthetic Wicking Long-Sleeve",
        note: "Start slightly cool at staging ('be bold, start cold') so you don't sweat-soak under your pack."
      });
    } else {
      wearNow.push({
        kind: "top",
        slot: "Base Layer (Zero Cotton)",
        item: "120–150 gsm Ultralight Synthetic Wicking Tee or Sun Hoodie",
        note: "Maximum moisture dump for high-output movement; strictly no cotton."
      });
    }

    if (normalizedRole === "static" && slot.feelsC <= 10) {
      wearNow.push({
        kind: "outer",
        slot: "Active / Static Mid-Layer",
        item: "Heavy Grid-Fleece + Synthetic Insulated Jacket Worn at Staging",
        note: "Low-output/static assignment: put your heavy insulation on immediately before core cools."
      });
    } else if (moveFeelC <= 1) {
      wearNow.push({
        kind: "top",
        slot: "Active Mid-Layer",
        item: "Breathable Grid-Fleece or Polartec Alpha / Octa Active Insulation",
        note: "Dumps excess pack heat on climbs while blocking chill in open woods."
      });
    } else if (moveFeelC <= 8) {
      wearNow.push({
        kind: "top",
        slot: "Active Mid-Layer",
        item: "Light Quarter-Zip Grid-Fleece (Vented on Climbs)",
        note: "Keep collar unzipped during steep uphill pushes to prevent sweat accumulation."
      });
    } else {
      wearNow.push({
        kind: "top",
        slot: "Active Mid-Layer",
        item: "Skip Mid-Layer While Moving (Stow Fleece in Pack)",
        note: "At this output level, wearing a fleece while hiking under a pack will drench your base layer."
      });
    }

    if (slot.isRaining || slot.isSnowing) {
      wearNow.push({
        kind: "outer",
        slot: "Field Shell, Pants & High-Vis",
        item: "Pit-Zipped Gore-Tex Hardshell + Durable Quick-Dry SAR Pants + High-Vis",
        note: "Open pit-zips completely while moving to vent internal moisture inside the waterproof shell."
      });
    } else {
      wearNow.push({
        kind: "outer",
        slot: "Field Shell, Pants & High-Vis",
        item: "Brush-Tough Softshell + Nylon Field Pants + High-Vis Vest & Clear Eye Pro",
        note: normalizedRole === "grid"
          ? "Clear safety glasses are essential for dense Nova Scotia spruce/alder grid lines."
          : "Wind-resistant softshell breathes 3x better than a hardshell until precipitation starts."
      });
    }

    const wetBrush = slot.isRaining || slot.isSnowing || slot.humidity >= 82 || env.maxPrecipProb >= 40;
    wearNow.push({
      kind: "footwear",
      slot: "Boots, Socks & Gaiters",
      item: wetBrush
        ? "Waterproof 6\"–8\" SAR Boots + Liner/Merino Socks + Tall Waterproof Gaiters"
        : "Broken-In SAR Boots + Midweight Merino Socks + Low Debris Gaiters",
      note: wetBrush
        ? "High humidity/wet bog moss & brush will soak boots from the top down in 20 minutes without tall gaiters."
        : "Liner sock under merino prevents friction blisters over multi-hour grid tasks."
    });

    wearNow.push({
      kind: "hands",
      slot: "Hands, Head & Comms",
      item: slot.feelsC <= 3
        ? "Leather/Synthetic Work Gloves + Merino Liners, Thin Toque & Headlamp"
        : "Dexterity Brush/Rope Gloves, Brimmed Cap & Chest Radio Harness",
      note: "Route radio speaker-mic under collar and keep compass/whistle tethered on chest harness."
    });

    // --- COLUMN 2: WHAT TO PACK FOR THE NEXT 12 HOURS (24-HOUR READY PACK) ---
    if (env.minFeelsC <= -5) {
      pack12h.push({
        kind: "pack",
        slot: "Top-of-Pack 'Stop Layer' (Static Holds)",
        item: "Expedition Synthetic Belay Parka + Insulated Side-Zip Over-Pants",
        note: `12h floor hits ${formatUserTemp(env.minFeelsC)}. Throw parka directly over outer shell the second the team halts.`
      });
    } else {
      pack12h.push({
        kind: "pack",
        slot: "Top-of-Pack 'Stop Layer' (Static Holds)",
        item: "High-Loft Synthetic Belay Puffy Jacket (Top Pocket of Pack)",
        note: `12h floor drops to ${formatUserTemp(env.minFeelsC)}. Synthetic insulation holds loft when damp during 60-min clue/litter stops.`
      });
    }

    if (env.freezeTransition) {
      pack12h.push({
        kind: "shield",
        slot: "12h Weather-Shift Shell & Traction",
        item: "Full-Zip Hardshell + Full-Side-Zip Rain Pants + Boot Microspikes",
        note: "Wet conditions transition below 0°C in the next 12h—expect flash glaze ice on rocks, deadfall, and trails."
      });
    } else if (env.hasRain || env.hasSnowOrIce || env.maxPrecipProb >= 35 || env.baroFalling) {
      pack12h.push({
        kind: "shield",
        slot: "12h Weather-Shift Shell Kit",
        item: "Waterproof Hardshell Jacket + Full-Side-Zip Rain Pants",
        note: `${env.maxPrecipProb}% 12h precip risk${env.baroFalling ? " (barometer falling)" : ""}. Full side-zips let you put rain pants on over muddy boots.`
      });
    } else {
      pack12h.push({
        kind: "shield",
        slot: "12h Weather-Shift Shell Kit",
        item: "Packable Waterproof Hardshell & Wind/Rain Pants",
        note: `Peak 12h winds reach ${formatUserWind(env.maxWindKmh)} on exposed ridges and clearcuts.`
      });
    }

    pack12h.push({
      kind: "pack",
      slot: "Drybag Thermal Reserve",
      item: "Sealed Drybag: Spare Base Top, 2x Heavy Merino Socks, Dry Toque & Waterproof Mittens",
      note: "Mandatory GSAR reserve if you step in a brook or sweat through on hike-in before an overnight hold."
    });

    pack12h.push({
      kind: "head",
      slot: "Night Ops, Comms & Cold Batteries",
      item: env.minFeelsC <= 2
        ? "Dual Headlamps (400+ lm) + Spare Lithium/Radio Batteries in Inside Warm Pocket"
        : "Primary & Backup Headlamps + Spare Radio/GPS Battery Pack",
      note: `${env.darkHours}h of darkness in the next 12h window.${env.minFeelsC <= 2 ? " Cold drains Li-ion batteries fast—keep spares against body heat." : ""}`
    });

    pack12h.push({
      kind: "shield",
      slot: "Subject Care ('Hypothermia Burrito' Kit)",
      item: env.minFeelsC <= 12 || env.hasRain || env.hasSnowOrIce
        ? "Silnylon Tarp, Vapor-Barrier Bivy, Closed-Cell Foam Pad & Chemical Heat Packs"
        : "Emergency Shelter Tarp, Bivy Sack, Extra Water & 24h High-Calorie Rations",
      note: env.minFeelsC <= 12 || env.hasRain
        ? `An immobile subject exposed to ${formatUserTemp(env.minFeelsC)} will be hypothermic—insulate from ground first.`
        : "Standard 24-hour GSAR subject stabilization and overnight bivouac kit."
    });

    return {
      roleLabel: roleMeta.label,
      moveFeelC,
      wearNow,
      pack12h
    };
  }

  function renderWearItemsList(container, items) {
    if (!container) return;
    container.replaceChildren();
    items.forEach((entry) => {
      const row = makeEl("article", "wear-item-row");
      const iconWrap = makeEl("div", "wear-item-icon");
      setSvgContent(iconWrap, getWearIconSvg(entry.kind));
      row.appendChild(iconWrap);

      const body = makeEl("div", "wear-item-body");
      const head = makeEl("div", "wear-item-head");
      head.appendChild(makeEl("span", "wear-item-slot", entry.slot));
      head.appendChild(makeEl("span", "wear-item-title", entry.item));
      body.appendChild(head);
      body.appendChild(makeEl("p", "wear-item-note", entry.note));
      row.appendChild(body);

      container.appendChild(row);
    });
  }

  function initWearPage() {
    const timeSelect = document.getElementById("wear-time-select");
    const regularList = document.getElementById("wear-regular-list");
    const runningList = document.getElementById("wear-running-list");
    const sarWearList = document.getElementById("sar-wear-list");
    const sarPackList = document.getElementById("sar-pack-list");
    const sarRoleBadge = document.getElementById("sar-role-badge");
    const sarEnvTemp = document.getElementById("sar-env-temp");
    const sarEnvPrecip = document.getElementById("sar-env-precip");
    const sarEnvWind = document.getElementById("sar-env-wind");
    const sarEnvDark = document.getElementById("sar-env-dark");
    const runFeelBadge = document.getElementById("run-effective-feel");
    const chipTemp = document.getElementById("wear-chip-temp");
    const chipFeels = document.getElementById("wear-chip-feels");
    const chipWind = document.getElementById("wear-chip-wind");
    const chipSky = document.getElementById("wear-chip-sky");
    const summaryNote = document.getElementById("wear-summary-note");
    if (!regularList) return;

    let prefs = { thermal: 0, effort: 0 };
    try {
      const raw = localStorage.getItem(RUN_PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Number.isFinite(Number(parsed.thermal))) prefs.thermal = Number(parsed.thermal);
        if (parsed && Number.isFinite(Number(parsed.effort))) prefs.effort = Number(parsed.effort);
      }
    } catch {
      // Ignore storage errors
    }

    let sarRole = "grid";
    try {
      const savedRole = localStorage.getItem(SAR_ROLE_KEY);
      if (savedRole === "hasty" || savedRole === "grid" || savedRole === "static") {
        sarRole = savedRole;
      }
    } catch {
      // Ignore storage errors
    }

    let wearForecastData = null;

    function syncPrefButtons() {
      document.querySelectorAll("[data-run-thermal]").forEach((btn) => {
        const val = Number(btn.getAttribute("data-run-thermal"));
        const active = val === prefs.thermal;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", String(active));
      });
      document.querySelectorAll("[data-run-effort]").forEach((btn) => {
        const val = Number(btn.getAttribute("data-run-effort"));
        const active = val === prefs.effort;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", String(active));
      });
      document.querySelectorAll("[data-sar-role]").forEach((btn) => {
        const role = btn.getAttribute("data-sar-role");
        const active = role === sarRole;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", String(active));
      });
    }

    function resolveActiveSlot(mode) {
      const norm = getNormalizedQuipObs();
      const baseTempC = norm.tempC !== null ? norm.tempC : 8;
      const baseFeelsC = norm.feelsLikeC !== null ? norm.feelsLikeC : baseTempC;
      const baseWindKmh = norm.windKmh !== null ? norm.windKmh : 10;
      const baseHum = norm.humidity !== null ? norm.humidity : 75;
      const baseRainRate = norm.rainRateMmH || 0;

      if (mode === "now" || !wearForecastData || !wearForecastData.hourly) {
        const curOm = (wearForecastData && wearForecastData.current) || null;
        const wmo = curOm && typeof curOm.weather_code === "number" ? curOm.weather_code : 3;
        const cond = WMO_CONDITIONS[wmo] || { label: "Live Station Conditions", kind: "cloud" };
        const isDay = curOm && typeof curOm.is_day === "number" ? curOm.is_day === 1 : true;
        return {
          label: "Right Now",
          targetMs: Date.now(),
          tempC: baseTempC,
          feelsC: baseFeelsC,
          windKmh: baseWindKmh,
          humidity: baseHum,
          skyLabel: cond.label,
          isRaining: baseRainRate > 0.1 || [51, 53, 55, 61, 63, 65, 80, 81, 82].includes(wmo),
          isSnowing: [56, 57, 66, 67, 71, 73, 75, 77, 85, 86].includes(wmo),
          isSunny: wmo === 0 || wmo === 1,
          isDay
        };
      }

      const h = wearForecastData.hourly;
      const now = new Date();
      let targetMs = now.getTime() + 2 * 3600 * 1000;
      if (mode.startsWith("tomorrow_")) {
        const tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 7, 0, 0);
        if (mode === "tomorrow_midday") tmr.setHours(12, 0, 0);
        if (mode === "tomorrow_evening") tmr.setHours(18, 0, 0);
        targetMs = tmr.getTime();
      }

      let bestIdx = 0;
      let bestDist = Infinity;
      h.time.forEach((iso, idx) => {
        const dist = Math.abs(new Date(iso).getTime() - targetMs);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = idx;
        }
      });

      const unitInfo = getOpenMeteoUnitParams();
      const rawT = Number(h.temperature_2m[bestIdx]);
      const rawApp = h.apparent_temperature ? Number(h.apparent_temperature[bestIdx]) : rawT;
      const rawW = Number(h.wind_speed_10m[bestIdx] || 0);
      const precipProb = Number(h.precipitation_probability ? h.precipitation_probability[bestIdx] : 0);
      const wmo = Number(h.weather_code[bestIdx] || 0);
      const cond = WMO_CONDITIONS[wmo] || { label: "Forecast conditions", kind: "cloud" };

      const tempC = unitInfo.tempParam === "fahrenheit" ? ((rawT - 32) * 5) / 9 : rawT;
      const feelsC = unitInfo.tempParam === "fahrenheit" ? ((rawApp - 32) * 5) / 9 : rawApp;
      let windKmh = rawW;
      if (unitInfo.windParam === "mph") windKmh = rawW * 1.60934;
      else if (unitInfo.windParam === "kn") windKmh = rawW * 1.852;
      else if (unitInfo.windParam === "ms") windKmh = rawW * 3.6;

      const hr = new Date(h.time[bestIdx]).getHours();
      return {
        label: new Date(h.time[bestIdx]).toLocaleString([], { weekday: "short", hour: "numeric" }),
        targetMs,
        tempC,
        feelsC,
        windKmh,
        humidity: baseHum,
        skyLabel: `${cond.label} (${Math.round(precipProb)}% precip)`,
        isRaining: precipProb >= 50 || [51, 53, 55, 61, 63, 65, 80, 81, 82].includes(wmo),
        isSnowing: [56, 57, 66, 67, 71, 73, 75, 77, 85, 86].includes(wmo),
        isSunny: wmo === 0 || wmo === 1,
        isDay: hr >= 7 && hr <= 19
      };
    }

    function updateWearUi() {
      const mode = timeSelect ? timeSelect.value : "now";
      const slot = resolveActiveSlot(mode);

      if (chipTemp) chipTemp.textContent = `Temp: ${formatUserTemp(slot.tempC)}`;
      if (chipFeels) chipFeels.textContent = `Feels: ${formatUserTemp(slot.feelsC)}`;
      if (chipWind) chipWind.textContent = `Wind: ${formatUserWind(slot.windKmh)}`;
      if (chipSky) chipSky.textContent = slot.skyLabel;

      const bucket = classifyQuipBucket(
        {
          tempC: slot.tempC,
          feelsLikeC: slot.feelsC,
          humidity: slot.humidity,
          windKmh: slot.windKmh,
          windGustKmh: slot.windKmh * 1.3,
          rainRateMmH: slot.isRaining ? 1.5 : 0,
          lightningStrikes: 0
        },
        null
      );
      const tone = readQuipTone();
      const pool = (QUIP_LIBRARY[bucket] && QUIP_LIBRARY[bucket][tone]) || QUIP_LIBRARY.mild.snarky;
      if (summaryNote && pool.length) {
        summaryNote.textContent = `${pool[0].h} ${pool[0].s}`;
      }

      const regularItems = buildRegularOutfit(slot);
      renderWearItemsList(regularList, regularItems);

      if (runningList) {
        const runResult = buildRunningOutfit(slot, prefs.thermal, prefs.effort);
        if (runFeelBadge) {
          runFeelBadge.textContent = `Run Feel: ${formatUserTemp(runResult.runFeelC)}`;
        }
        renderWearItemsList(runningList, runResult.items);
      }

      if (sarWearList && sarPackList) {
        const env = computeSar12hEnvelope(slot, wearForecastData);
        const sar = buildSarLoadout(slot, env, sarRole);
        if (sarRoleBadge) {
          sarRoleBadge.textContent = `${sar.roleLabel} · Move Feel ${formatUserTemp(sar.moveFeelC)}`;
        }
        if (sarEnvTemp) {
          sarEnvTemp.textContent = `${formatUserTemp(slot.feelsC)} → ${formatUserTemp(env.minFeelsC)}`;
        }
        if (sarEnvPrecip) {
          const riskTag = env.freezeTransition
            ? "Rain-to-Freeze Alert"
            : env.hasSnowOrIce
              ? "Snow / Ice Risk"
              : env.hasRain
                ? "Wet / Rain"
                : "Low Precip";
          sarEnvPrecip.textContent = `${env.maxPrecipProb}% peak (${riskTag})`;
        }
        if (sarEnvWind) {
          sarEnvWind.textContent = `Up to ${formatUserWind(env.maxWindKmh)}`;
        }
        if (sarEnvDark) {
          const sunsetStr = (CFG.almanac && CFG.almanac.sunset) ? ` (Sunset ${CFG.almanac.sunset})` : "";
          sarEnvDark.textContent = `${env.darkHours}h dark in next 12h${sunsetStr}`;
        }
        renderWearItemsList(sarWearList, sar.wearNow);
        renderWearItemsList(sarPackList, sar.pack12h);
      }
    }

    document.querySelectorAll("[data-run-thermal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        prefs.thermal = Number(btn.getAttribute("data-run-thermal"));
        try {
          localStorage.setItem(RUN_PREFS_KEY, JSON.stringify(prefs));
        } catch {
          // Ignore storage restrictions
        }
        syncPrefButtons();
        updateWearUi();
      });
    });

    document.querySelectorAll("[data-run-effort]").forEach((btn) => {
      btn.addEventListener("click", () => {
        prefs.effort = Number(btn.getAttribute("data-run-effort"));
        try {
          localStorage.setItem(RUN_PREFS_KEY, JSON.stringify(prefs));
        } catch {
          // Ignore storage restrictions
        }
        syncPrefButtons();
        updateWearUi();
      });
    });

    document.querySelectorAll("[data-sar-role]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextRole = btn.getAttribute("data-sar-role");
        if (nextRole === "hasty" || nextRole === "grid" || nextRole === "static") {
          sarRole = nextRole;
          try {
            localStorage.setItem(SAR_ROLE_KEY, sarRole);
          } catch {
            // Ignore storage restrictions
          }
          syncPrefButtons();
          updateWearUi();
        }
      });
    });

    if (timeSelect) {
      timeSelect.addEventListener("change", updateWearUi);
    }

    syncPrefButtons();
    updateWearUi();

    const lat = Number(CFG.lat);
    const lon = Number(CFG.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const unitInfo = getOpenMeteoUnitParams();
      const cacheKey = `${OM_SESSION_CACHE_KEY}:${lat.toFixed(3)}:${lon.toFixed(3)}:${unitInfo.tempParam}:${unitInfo.windParam}`;
      const cached = readSessionCache(cacheKey, OM_CACHE_TTL_MS);
      if (cached) {
        wearForecastData = cached;
        updateWearUi();
      } else {
        const url =
          `https://api.open-meteo.com/v1/forecast` +
          `?latitude=${encodeURIComponent(lat)}` +
          `&longitude=${encodeURIComponent(lon)}` +
          `&current=weather_code,cloud_cover,visibility,is_day` +
          `&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant` +
          `&temperature_unit=${unitInfo.tempParam}` +
          `&wind_speed_unit=${unitInfo.windParam}` +
          `&precipitation_unit=${unitInfo.precipParam}` +
          `&timezone=auto&forecast_days=7`;
        fetch(url, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data) {
              writeSessionCache(cacheKey, data);
              wearForecastData = data;
              updateWearUi();
            }
          })
          .catch(() => {});
      }
    }
  }

  /* ---------------- Records Sub-Page Controller ---------------- */
  function initRecordsPage() {
    const buttons = document.querySelectorAll(".records-period-btn[data-period]");
    const panels = document.querySelectorAll(".records-panel[data-period-panel]");
    if (!buttons.length || !panels.length) return;

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-period");
        buttons.forEach((other) => {
          const active = other === btn;
          other.classList.toggle("is-active", active);
          other.setAttribute("aria-pressed", String(active));
        });
        panels.forEach((panel) => {
          panel.hidden = panel.getAttribute("data-period-panel") !== target;
        });
      });
    });
  }

  /* ---------------- Charts Sub-Page Controller ---------------- */
  const PERIOD_CACHE = new Map();
  let chartJsInstance = null;
  let lastRenderedChart = null;

  function getChartThemeColors() {
    const isLight = isLightTheme();
    const cs = window.getComputedStyle(document.documentElement);
    const read = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    return {
      accent: read("--accent-cyan", isLight ? "#0077B6" : "#00A8E8"),
      accentBar: isLight ? "rgba(0, 119, 182, 0.82)" : "rgba(0, 168, 232, 0.82)",
      accentLineFill: isLight ? "rgba(0, 119, 182, 0.14)" : "rgba(0, 168, 232, 0.16)",
      intervalBarFill: isLight ? "rgba(94, 166, 41, 0.62)" : "rgba(108, 192, 74, 0.62)",
      intervalBarBorder: read("--leaf-green", isLight ? "#5EA629" : "#7AC143"),
      gridColor: read("--border-tile", isLight ? "#D5DFE6" : "#333738"),
      tickColor: read("--text-muted", isLight ? "#657078" : "#808588"),
      tooltipBg: read("--bg-tile", isLight ? "#FFFFFF" : "#1F2223"),
      tooltipTitle: read("--text-secondary", isLight ? "#4D575E" : "#A0A5A8"),
      textPrimary: read("--text-primary", isLight ? "#181D20" : "#FFFFFF"),
      calloutBg: isLight ? "rgba(255, 255, 255, 0.92)" : "rgba(26, 29, 30, 0.88)"
    };
  }

  const DEFAULT_SERIES_BY_METRIC = {
    primary: {
      temperature: "outTemp",
      rain: "rain",
      humidity: "outHumidity",
      wind: "windGust",
      barometer: "barometer",
      dewpoint: "dewpoint",
      lightning: "lightningStrikes"
    },
    tower: {
      temperature: "towerTemp",
      rain: "rain",
      humidity: "towerHumidity",
      wind: "windGust",
      barometer: "barometer",
      dewpoint: "dewpoint",
      lightning: "lightningStrikes"
    }
  };

  function normalizeParam(val, allowed, fallback) {
    if (!val) return fallback;
    const clean = String(val).trim().toLowerCase();
    const aliases = {
      temp: "temperature",
      dew: "dewpoint",
      baro: "barometer",
      day: "today"
    };
    const mapped = aliases[clean] || clean;
    return allowed.includes(mapped) ? mapped : fallback;
  }

  function formatTimestampLabel(tsSec, period) {
    const d = new Date(tsSec * 1000);
    if (period === "today") {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    if (period === "week") {
      return d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
    }
    if (period === "month") {
      return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }

  function getStatsForSelection(data, sensor, metric) {
    const stats = data.stats || {};
    if (sensor === "tower" && stats.tower && Array.isArray(stats.tower[metric])) {
      return stats.tower[metric];
    }
    return Array.isArray(stats[metric]) ? stats[metric] : [];
  }

  function buildChartJsCalloutPlugin(unitStr, themeColors) {
    return {
      id: "frostlineCallout",
      afterDatasetsDraw(chart) {
        const meta = chart.getDatasetMeta(0);
        if (!meta || !meta.data || !meta.data.length) return;

        const active = chart.getActiveElements();
        let targetIdx = active && active.length ? active[0].index : -1;
        const dataArr = chart.data.datasets[0].data || [];

        if (targetIdx < 0) {
          for (let i = dataArr.length - 1; i >= 0; i--) {
            if (dataArr[i] !== null && dataArr[i] !== undefined) {
              targetIdx = i;
              break;
            }
          }
        }
        if (targetIdx < 0 || !meta.data[targetIdx]) return;

        const val = dataArr[targetIdx];
        if (val === null || val === undefined) return;
        const pt = meta.data[targetIdx];
        const isBar = chart.config.type === "bar";
        const text = `${Number(val).toFixed(isBar ? 2 : 1)}${unitStr ? " " + unitStr : ""}`;

        const { ctx, chartArea } = chart;
        ctx.save();
        ctx.font = '500 13px "Inter", "Roboto", system-ui, sans-serif';
        const tw = ctx.measureText(text).width;
        const bw = tw + 14;
        const bh = 22;

        const bx = Math.min(Math.max(chartArea.left + 4, pt.x - bw / 2), chartArea.right - bw - 4);
        const by = pt.y - bh - 8 >= chartArea.top ? pt.y - bh - 8 : Math.min(chartArea.bottom - bh - 4, pt.y + 8);

        ctx.fillStyle = themeColors.calloutBg;
        ctx.strokeStyle = themeColors.accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = themeColors.textPrimary;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, bx + bw / 2, by + bh / 2);
        ctx.restore();
      }
    };
  }

  function renderChart(seriesObj, period) {
    const canvas = document.getElementById("weather-chart");
    const emptyEl = document.getElementById("chart-empty-state");
    const labelEl = document.getElementById("chart-active-label");
    const ariaSummary = document.getElementById("chart-aria-summary");
    if (!canvas) return;

    lastRenderedChart = { seriesObj, period };
    const themeColors = getChartThemeColors();

    const rawTimestamps = (seriesObj && seriesObj.timestamps) || [];
    const rawValues = (seriesObj && seriesObj.values) || [];
    const cumulativeValues = (seriesObj && seriesObj.cumulativeValues) || null;
    const chartType = (seriesObj && seriesObj.chartType) || "line";
    const isRainCombo =
      chartType === "rain-combo" &&
      Array.isArray(cumulativeValues) &&
      cumulativeValues.length === rawValues.length;
    const primaryValues = isRainCombo ? cumulativeValues : rawValues;
    const unitStr = (seriesObj && seriesObj.unit) || "";
    const seriesLabel = isRainCombo
      ? `${seriesObj.cumulativeLabel || "Rain Accumulation"} & ${seriesObj.intervalLabel || "Interval Rain"}`
      : (seriesObj && seriesObj.label) || "Metric";

    if (labelEl) {
      labelEl.textContent = unitStr ? `${seriesLabel} (${unitStr})` : seriesLabel;
    }

    const hasData = primaryValues.some((v) => v !== null && Number.isFinite(v));
    if (!hasData || rawTimestamps.length === 0) {
      if (chartJsInstance) {
        chartJsInstance.destroy();
        chartJsInstance = null;
      }
      if (window.FrostlineChartFallback) window.FrostlineChartFallback.destroy();
      if (emptyEl) emptyEl.hidden = false;
      if (ariaSummary) ariaSummary.textContent = `No data available for ${seriesLabel}.`;
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    const labels = rawTimestamps.map((ts) => formatTimestampLabel(ts, period));

    const validNums = primaryValues.filter((v) => v !== null && Number.isFinite(v));
    const minVal = Math.min(...validNums);
    const maxVal = Math.max(...validNums);
    const latestVal = validNums[validNums.length - 1];
    if (ariaSummary) {
      ariaSummary.textContent =
        `${seriesLabel}: latest ${latestVal.toFixed(1)} ${unitStr}, low ${minVal.toFixed(1)}, high ${maxVal.toFixed(1)}.`;
    }

    if (typeof window.Chart === "function") {
      if (chartJsInstance) {
        chartJsInstance.destroy();
        chartJsInstance = null;
      }
      if (window.FrostlineChartFallback) window.FrostlineChartFallback.destroy();

      const ctx = canvas.getContext("2d");
      const isBar = chartType === "bar";
      let suggestedMin = undefined;
      if (isBar || isRainCombo) {
        suggestedMin = 0;
      }

      const datasets = isRainCombo
        ? [
            {
              type: "line",
              label: seriesObj.cumulativeLabel || "Rain Accumulation",
              data: cumulativeValues,
              borderColor: themeColors.accent,
              backgroundColor: themeColors.accentLineFill,
              borderWidth: 2.2,
              pointRadius: 0,
              pointHoverRadius: 4,
              pointHoverBackgroundColor: themeColors.accent,
              pointHoverBorderColor: themeColors.textPrimary,
              pointHoverBorderWidth: 1.5,
              tension: 0.2,
              spanGaps: true,
              fill: true,
              yAxisID: "y",
              order: 2
            },
            {
              type: "line",
              label: seriesObj.intervalLabel || "Interval Rain",
              data: rawValues,
              borderColor: themeColors.intervalBarBorder,
              backgroundColor: themeColors.intervalBarFill,
              borderWidth: 2.2,
              pointRadius: 0,
              pointHoverRadius: 4,
              pointHoverBackgroundColor: themeColors.intervalBarBorder,
              pointHoverBorderColor: themeColors.textPrimary,
              pointHoverBorderWidth: 1.5,
              tension: 0.2,
              spanGaps: true,
              fill: false,
              yAxisID: "yInterval",
              order: 1
            }
          ]
        : [
            {
              label: seriesLabel,
              data: rawValues,
              borderColor: themeColors.accent,
              backgroundColor: isBar ? themeColors.accentBar : themeColors.accentLineFill,
              borderWidth: isBar ? 1 : 2,
              pointRadius: 0,
              pointHoverRadius: 4,
              pointHoverBackgroundColor: themeColors.accent,
              pointHoverBorderColor: themeColors.textPrimary,
              pointHoverBorderWidth: 1.5,
              tension: 0.15,
              spanGaps: true,
              fill: false,
              maxBarThickness: 20
            }
          ];

      const validIntervalNums = isRainCombo
        ? rawValues.filter((v) => v !== null && Number.isFinite(v))
        : [];
      const maxIntervalVal = validIntervalNums.length ? Math.max(...validIntervalNums) : 0;

      const scales = {
        x: {
          display: false,
          grid: { display: false }
        },
        y: {
          suggestedMin,
          suggestedMax: (isBar || isRainCombo) && maxVal === 0 ? 1 : undefined,
          border: { display: false },
          grid: {
            color: themeColors.gridColor,
            lineWidth: 1
          },
          ticks: {
            color: themeColors.tickColor,
            maxTicksLimit: 5,
            mirror: true,
            align: "end",
            z: 10,
            padding: 4,
            font: {
              size: 11,
              family: '"Inter", "Roboto", system-ui, sans-serif'
            },
            callback(val) {
              const num = Number(val);
              if (!Number.isFinite(num)) return val;
              return num.toFixed(1);
            }
          }
        }
      };

      if (isRainCombo) {
        scales.yInterval = {
          position: "right",
          display: false,
          suggestedMin: 0,
          suggestedMax: maxIntervalVal > 0 ? maxIntervalVal * 1.35 : 1,
          grid: { display: false }
        };
      }

      chartJsInstance = new window.Chart(ctx, {
        type: isBar ? "bar" : "line",
        data: {
          labels,
          datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 220 },
          interaction: {
            mode: "index",
            intersect: false
          },
          layout: {
            padding: { top: 26, right: 8, bottom: 8, left: 4 }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: themeColors.tooltipBg,
              titleColor: themeColors.tooltipTitle,
              bodyColor: themeColors.textPrimary,
              borderColor: themeColors.accent,
              borderWidth: 1,
              displayColors: isRainCombo,
              callbacks: {
                label(context) {
                  const v = context.parsed.y;
                  if (v === null || v === undefined) return "No reading";
                  const dsLabel = context.dataset && context.dataset.label ? `${context.dataset.label}: ` : "";
                  return `${isRainCombo ? dsLabel : ""}${Number(v).toFixed(isBar || isRainCombo ? 2 : 1)}${unitStr ? " " + unitStr : ""}`;
                }
              }
            }
          },
          scales
        },
        plugins: [buildChartJsCalloutPlugin(unitStr, themeColors)]
      });
    } else if (window.FrostlineChartFallback) {
      window.FrostlineChartFallback.render(canvas, {
        values: rawValues,
        cumulativeValues,
        labels,
        chartType,
        unit: unitStr
      });
    }
  }

  async function loadPeriodData(period) {
    if (PERIOD_CACHE.has(period)) {
      return PERIOD_CACHE.get(period);
    }
    const res = await fetch(`data/${period}.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    PERIOD_CACHE.set(period, json);
    return json;
  }

  function initChartsPage() {
    const sensorSelect = document.getElementById("sensor-select");
    const metricSelect = document.getElementById("metric-select");
    const periodSelect = document.getElementById("period-select");
    const tilesGrid = document.getElementById("stat-tiles-grid");
    const dateLabelEl = document.getElementById("chart-date-label");
    const actionBtn = document.getElementById("header-action-btn");

    if (!sensorSelect || !metricSelect || !periodSelect || !tilesGrid) return;

    const params = new URLSearchParams(window.location.search);
    const state = {
      sensor: normalizeParam(params.get("sensor"), ["primary", "tower"], "primary"),
      metric: normalizeParam(
        params.get("metric"),
        ["temperature", "rain", "humidity", "wind", "barometer", "dewpoint", "lightning"],
        "temperature"
      ),
      period: normalizeParam(params.get("period"), ["today", "week", "month", "year"], "today"),
      activeTileKey: null,
      activeSeriesKey: null
    };

    sensorSelect.value = state.sensor;
    metricSelect.value = state.metric;
    periodSelect.value = state.period;

    function syncUrl() {
      const next = new URLSearchParams();
      next.set("metric", state.metric);
      next.set("period", state.period);
      if (state.sensor !== "primary") next.set("sensor", state.sensor);
      const newUrl = `${window.location.pathname}?${next.toString()}`;
      try {
        window.history.replaceState(null, "", newUrl);
      } catch {
        // Ignore history restriction on file://
      }
    }

    function renderTilesAndChart(data) {
      if (dateLabelEl && data.dateLabel) {
        dateLabelEl.textContent = data.dateLabel;
      }

      const tiles = getStatsForSelection(data, state.sensor, state.metric);
      const defaultSeries =
        (DEFAULT_SERIES_BY_METRIC[state.sensor] && DEFAULT_SERIES_BY_METRIC[state.sensor][state.metric]) ||
        "outTemp";

      if (!tiles.some((t) => t.key === state.activeTileKey)) {
        state.activeTileKey = tiles.length ? tiles[0].key : null;
        state.activeSeriesKey = tiles.length ? tiles[0].seriesKey : defaultSeries;
      }

      tilesGrid.replaceChildren();
      if (!tiles.length) {
        tilesGrid.replaceChildren(
          makeEl("div", "stat-tile-skeleton", "No summary tiles available for this metric.")
        );
      } else {
        tiles.forEach((tile) => {
          const isActive = tile.key === state.activeTileKey;
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `stat-tile${isActive ? " is-active" : ""}`;
          btn.setAttribute("aria-pressed", String(isActive));

          const valueWrap = document.createElement("span");
          valueWrap.className = "stat-tile-value-wrap";
          const valSpan = document.createElement("span");
          valSpan.className = "stat-tile-value";
          valSpan.textContent = tile.formatted;
          valueWrap.appendChild(valSpan);
          if (tile.unit) {
            const sup = document.createElement("sup");
            sup.className = "stat-tile-unit";
            sup.textContent = tile.unit;
            valueWrap.appendChild(sup);
          }

          const meta = document.createElement("span");
          meta.className = "stat-tile-meta";
          const titleEl = document.createElement("span");
          titleEl.className = "stat-tile-title";
          titleEl.textContent = tile.title;
          const subEl = document.createElement("span");
          subEl.className = "stat-tile-subtitle";
          subEl.textContent = tile.subtitle;
          meta.appendChild(titleEl);
          meta.appendChild(subEl);
          if (tile.time) {
            const timeEl = document.createElement("span");
            timeEl.className = "stat-tile-time";
            timeEl.textContent = tile.time;
            meta.appendChild(timeEl);
          }

          btn.appendChild(valueWrap);
          btn.appendChild(meta);

          btn.addEventListener("click", () => {
            state.activeTileKey = tile.key;
            state.activeSeriesKey = tile.seriesKey;
            renderTilesAndChart(data);
          });

          tilesGrid.appendChild(btn);
        });
      }

      const seriesMap = data.series || {};
      const activeSeries = seriesMap[state.activeSeriesKey] || seriesMap[defaultSeries];
      renderChart(activeSeries, state.period);
    }

    async function updateView() {
      syncUrl();
      try {
        const data = await loadPeriodData(state.period);
        renderTilesAndChart(data);
      } catch {
        tilesGrid.replaceChildren(
          makeEl(
            "div",
            "stat-tile-skeleton",
            `Unable to load data/${state.period}.json. Run WeeWX report generation or serve via HTTP.`
          )
        );
        renderChart(null, state.period);
      }
    }

    sensorSelect.addEventListener("change", () => {
      state.sensor = sensorSelect.value;
      state.activeTileKey = null;
      updateView();
    });

    metricSelect.addEventListener("change", () => {
      state.metric = metricSelect.value;
      state.activeTileKey = null;
      updateView();
    });

    periodSelect.addEventListener("change", () => {
      state.period = periodSelect.value;
      updateView();
    });

    if (actionBtn) {
      actionBtn.addEventListener("click", async () => {
        try {
          const data = await loadPeriodData(state.period);
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const code = (CFG.stationCode || "station").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
          a.href = url;
          a.download = `frostline-${code}-${state.period}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          showToast(`Downloaded ${state.period} archive JSON.`);
        } catch {
          showToast("Archive JSON download unavailable.");
        }
      });
    }

    updateView();
  }

  /* ---------------- Boot ---------------- */
  window.__FROSTLINE_TEST__ = {
    normalizeCanadaAlerts,
    dedupeAlerts,
    buildActiveSignature,
    classifyQuipBucket,
    QUIP_LIBRARY,
    computeDailyRangeBar,
    interpolateTideHeight,
    classifyAqiTier,
    buildRegularOutfit,
    buildRunningOutfit,
    computeSar12hEnvelope,
    buildSarLoadout,
    toCelsius,
    toKmh,
    toMm
  };

  document.addEventListener("DOMContentLoaded", () => {
    initThemeToggle();
    initCardAccordions();
    if (CFG.page === "charts") {
      initChartsPage();
    } else if (CFG.page === "records") {
      initRecordsPage();
    } else if (CFG.page === "wear") {
      initWearPage();
    } else if (CFG.page === "station") {
      initStationPage();
    } else {
      initDashboardPage();
    }
  });
})();
