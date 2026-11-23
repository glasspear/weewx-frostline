/* ==========================================================================
   chart-fallback.js — Zero-dependency Canvas 2D renderer for frostline
   Used automatically whenever Chart.js CDN is unreachable or offline.
   ========================================================================== */
(function (global) {
  "use strict";

  let activeState = null;

  function niceTicks(minVal, maxVal, count) {
    if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) {
      return [0, 0.25, 0.5, 0.75, 1];
    }
    if (minVal === maxVal) {
      const pad = minVal === 0 ? 1 : Math.abs(minVal) * 0.15;
      minVal = minVal === 0 ? 0 : minVal - pad;
      maxVal = minVal === 0 ? 1 : maxVal + pad;
    }
    const ticks = [];
    const step = (maxVal - minVal) / (count - 1);
    for (let i = 0; i < count; i++) {
      ticks.push(minVal + step * i);
    }
    return ticks;
  }

  function formatTick(value, step) {
    const absStep = Math.abs(step);
    const decimals = absStep >= 10 ? 0 : absStep >= 0.5 ? 1 : 2;
    return value.toFixed(decimals);
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
      typeof global.matchMedia === "function" &&
      global.matchMedia("(prefers-color-scheme: light)").matches
    );
  }

  function getThemePalette() {
    const isLight = isLightTheme();
    const cs =
      typeof global.getComputedStyle === "function"
        ? global.getComputedStyle(document.documentElement)
        : null;
    const read = (name, fallback) => {
      const val = cs ? cs.getPropertyValue(name).trim() : "";
      return val || fallback;
    };
    return {
      canvasBg: read("--bg-canvas", isLight ? "#EEF2F5" : "#1A1D1E"),
      gridColor: read("--border-tile", isLight ? "#D5DFE6" : "#333738"),
      tickColor: read("--text-muted", isLight ? "#657078" : "#808588"),
      accent: read("--accent-cyan", isLight ? "#0077B6" : "#00A8E8"),
      barFill: isLight ? "rgba(0, 119, 182, 0.82)" : "rgba(0, 168, 232, 0.85)",
      intervalLineColor: read("--leaf-green", isLight ? "#5EA629" : "#7AC143"),
      intervalBarFill: isLight ? "rgba(94, 166, 41, 0.62)" : "rgba(108, 192, 74, 0.62)",
      areaFill: isLight ? "rgba(0, 119, 182, 0.14)" : "rgba(0, 168, 232, 0.16)",
      calloutBg: isLight ? "rgba(255, 255, 255, 0.94)" : "rgba(31, 34, 35, 0.92)",
      textPrimary: read("--text-primary", isLight ? "#181D20" : "#FFFFFF")
    };
  }

  function draw(state) {
    const { canvas, points, cumulativePoints, chartType, unit, labels, hoverIdx } = state;
    const isRainCombo = chartType === "rain-combo" && Array.isArray(cumulativePoints) && cumulativePoints.length === points.length;
    const primarySeries = isRainCombo ? cumulativePoints : points;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const theme = getThemePalette();
    const dpr = global.devicePixelRatio || 1;
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;

    ctx.fillStyle = theme.canvasBg;
    ctx.fillRect(0, 0, w, h);

    const padTop = 18;
    const padBottom = 18;
    const padLeft = 8;
    const padRight = 10;
    const plotW = Math.max(20, w - padLeft - padRight);
    const plotH = Math.max(20, h - padTop - padBottom);

    const validNums = primarySeries.filter((v) => typeof v === "number" && Number.isFinite(v));
    if (validNums.length === 0) {
      ctx.restore();
      return;
    }

    let minY = Math.min(...validNums);
    let maxY = Math.max(...validNums);
    const isZeroFloor = chartType === "bar" || isRainCombo;
    if (isZeroFloor) {
      minY = Math.min(0, minY);
      if (maxY === 0) maxY = 1;
    }
    if (minY === maxY) {
      const span = minY === 0 ? 1 : Math.max(0.5, Math.abs(minY) * 0.1);
      minY -= isZeroFloor && minY === 0 ? 0 : span;
      maxY += span;
    } else {
      const margin = (maxY - minY) * 0.08;
      if (!(isZeroFloor && minY === 0)) {
        minY -= margin;
      }
      maxY += margin;
    }

    const ticks = niceTicks(minY, maxY, 5);
    const tickStep = ticks[1] - ticks[0];

    ctx.font = '12px "Inter", "Roboto", system-ui, sans-serif';
    ctx.textBaseline = "bottom";

    for (let i = 0; i < ticks.length; i++) {
      const ratio = (ticks[i] - minY) / (maxY - minY);
      const y = padTop + plotH - ratio * plotH;

      ctx.strokeStyle = theme.gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft + 28, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();

      ctx.fillStyle = theme.tickColor;
      ctx.textAlign = "left";
      ctx.fillText(formatTick(ticks[i], tickStep), padLeft, y + 4);
    }

    const chartLeft = padLeft + 34;
    const chartW = Math.max(10, w - padRight - chartLeft);
    const count = primarySeries.length;

    const getX = (idx) => {
      if (count <= 1) return chartLeft + chartW / 2;
      return chartLeft + (idx / (count - 1)) * chartW;
    };

    const getY = (val) => {
      const ratio = (val - minY) / (maxY - minY);
      return padTop + plotH - ratio * plotH;
    };

    if (isRainCombo) {
      const baseY = getY(minY);
      ctx.fillStyle = theme.areaFill;
      ctx.beginPath();
      let firstX = null;
      let lastX = null;
      for (let i = 0; i < count; i++) {
        const cv = cumulativePoints[i];
        if (cv === null || !Number.isFinite(cv)) continue;
        const x = getX(i);
        const y = getY(cv);
        if (firstX === null) {
          firstX = x;
          ctx.moveTo(x, baseY);
        }
        ctx.lineTo(x, y);
        lastX = x;
      }
      if (firstX !== null && lastX !== null) {
        ctx.lineTo(lastX, baseY);
        ctx.closePath();
        ctx.fill();
      }

      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      let startedAccum = false;
      for (let i = 0; i < count; i++) {
        const cv = cumulativePoints[i];
        if (cv === null || !Number.isFinite(cv)) {
          startedAccum = false;
          continue;
        }
        const x = getX(i);
        const y = getY(cv);
        if (!startedAccum) {
          ctx.moveTo(x, y);
          startedAccum = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      const validIntervals = points.filter((v) => typeof v === "number" && Number.isFinite(v));
      const maxInterval = Math.max(0.5, ...validIntervals);
      ctx.strokeStyle = theme.intervalLineColor;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < count; i++) {
        const iv = points[i];
        if (iv === null || !Number.isFinite(iv)) {
          started = false;
          continue;
        }
        const x = getX(i);
        const y = baseY - (iv / maxInterval) * (plotH * 0.72);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    } else if (chartType === "bar") {
      const barW = Math.max(2, Math.min(18, (chartW / Math.max(1, count)) * 0.65));
      const baseY = getY(minY);
      ctx.fillStyle = theme.barFill;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1;
      for (let i = 0; i < count; i++) {
        const val = primarySeries[i];
        if (val === null || !Number.isFinite(val)) continue;
        const x = getX(i) - barW / 2;
        const y = getY(val);
        const barH = Math.max(1.5, baseY - y);
        ctx.fillRect(x, baseY - barH, barW, barH);
      }
    } else {
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < count; i++) {
        const val = primarySeries[i];
        if (val === null || !Number.isFinite(val)) {
          started = false;
          continue;
        }
        const x = getX(i);
        const y = getY(val);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    let focusIdx = hoverIdx;
    if (focusIdx === null || focusIdx < 0 || focusIdx >= count || primarySeries[focusIdx] === null) {
      for (let i = count - 1; i >= 0; i--) {
        if (primarySeries[i] !== null && Number.isFinite(primarySeries[i])) {
          focusIdx = i;
          break;
        }
      }
    }

    if (focusIdx !== null && focusIdx >= 0 && primarySeries[focusIdx] !== null) {
      const fx = getX(focusIdx);
      const fy = getY(primarySeries[focusIdx]);
      let valText = primarySeries[focusIdx].toFixed(chartType === "bar" || isRainCombo ? 2 : 1) + (unit ? " " + unit : "");
      if (isRainCombo && typeof points[focusIdx] === "number" && points[focusIdx] > 0) {
        valText += ` (+${points[focusIdx].toFixed(2)} ${unit})`;
      }
      const timeText = labels[focusIdx] || "";
      const caption = hoverIdx !== null && timeText ? valText + " · " + timeText : valText;

      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.arc(fx, fy, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '500 13px "Inter", "Roboto", system-ui, sans-serif';
      const textW = ctx.measureText(caption).width;
      const boxW = textW + 14;
      const boxH = 24;
      const boxX = Math.min(Math.max(chartLeft, fx - boxW / 2), w - padRight - boxW);
      const boxY = fy - boxH - 10 >= padTop ? fy - boxH - 10 : Math.min(h - boxH - 4, fy + 10);

      ctx.fillStyle = theme.calloutBg;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = theme.textPrimary;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(caption, boxX + boxW / 2, boxY + boxH / 2);
    }

    ctx.restore();
    state.chartLeft = chartLeft;
    state.chartW = chartW;
  }

  function destroy() {
    if (!activeState) return;
    const { canvas, onMove, onLeave, ro } = activeState;
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerleave", onLeave);
    if (ro) ro.disconnect();
    activeState = null;
  }

  function render(canvas, cfg) {
    destroy();
    const state = {
      canvas,
      points: cfg.values || [],
      cumulativePoints: cfg.cumulativeValues || null,
      labels: cfg.labels || [],
      chartType: cfg.chartType || "line",
      unit: cfg.unit || "",
      hoverIdx: null,
      chartLeft: 42,
      chartW: canvas.clientWidth || 300,
      onMove: null,
      onLeave: null,
      ro: null
    };

    state.onMove = (evt) => {
      const rect = canvas.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const count = state.points.length;
      if (count <= 0) return;
      const ratio = Math.min(1, Math.max(0, (x - state.chartLeft) / Math.max(1, state.chartW)));
      const idx = Math.round(ratio * (count - 1));
      if (idx !== state.hoverIdx) {
        state.hoverIdx = idx;
        draw(state);
      }
    };

    state.onLeave = () => {
      if (state.hoverIdx !== null) {
        state.hoverIdx = null;
        draw(state);
      }
    };

    canvas.addEventListener("pointermove", state.onMove);
    canvas.addEventListener("pointerleave", state.onLeave);

    if (typeof global.ResizeObserver === "function") {
      state.ro = new global.ResizeObserver(() => draw(state));
      state.ro.observe(canvas);
    }

    activeState = state;
    draw(state);
  }

  function redraw() {
    if (activeState) draw(activeState);
  }

  global.FrostlineChartFallback = { render, destroy, redraw };
})(window);
