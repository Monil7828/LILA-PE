const els = {
  mapSelect: document.querySelector("#mapSelect"),
  dateSelect: document.querySelector("#dateSelect"),
  matchSelect: document.querySelector("#matchSelect"),
  humanToggle: document.querySelector("#humanToggle"),
  botToggle: document.querySelector("#botToggle"),
  markerToggle: document.querySelector("#markerToggle"),
  playButton: document.querySelector("#playButton"),
  speedSelect: document.querySelector("#speedSelect"),
  timeSlider: document.querySelector("#timeSlider"),
  timeLabel: document.querySelector("#timeLabel"),
  durationLabel: document.querySelector("#durationLabel"),
  humanCount: document.querySelector("#humanCount"),
  botCount: document.querySelector("#botCount"),
  lootCount: document.querySelector("#lootCount"),
  combatCount: document.querySelector("#combatCount"),
  activeContext: document.querySelector("#activeContext"),
  matchTitle: document.querySelector("#matchTitle"),
  summaryStrip: document.querySelector("#summaryStrip"),
  minimap: document.querySelector("#minimap"),
  heatCanvas: document.querySelector("#heatCanvas"),
  pathCanvas: document.querySelector("#pathCanvas"),
  eventFeed: document.querySelector("#eventFeed"),
  heatmapButtons: [...document.querySelectorAll("[data-heatmap]")],
};

const heatCtx = els.heatCanvas.getContext("2d");
const pathCtx = els.pathCanvas.getContext("2d");

const state = {
  data: null,
  mapId: "",
  date: "all",
  matchId: "",
  heatmap: "traffic",
  showHumans: true,
  showBots: true,
  showMarkers: true,
  time: 0,
  playing: false,
  speed: 1,
};

let animationFrame = 0;
let lastFrameAt = 0;
const heatmapCache = new Map();

const HEATMAP_EVENTS = {
  traffic: new Set(["Position", "BotPosition"]),
  kills: new Set(["Kill", "BotKill"]),
  deaths: new Set(["Killed", "BotKilled", "KilledByStorm"]),
  loot: new Set(["Loot"]),
};

const EVENT_LABELS = {
  Position: "Position",
  BotPosition: "Bot position",
  Kill: "Player kill",
  Killed: "Player death",
  BotKill: "Bot kill",
  BotKilled: "Bot death",
  KilledByStorm: "Storm death",
  Loot: "Loot pickup",
};

const HEAT_COLORS = {
  traffic: [56, 189, 248],
  kills: [239, 68, 68],
  deaths: [232, 121, 249],
  loot: [250, 204, 21],
};

const POSITION_EVENTS = new Set(["Position", "BotPosition"]);
const COMBAT_EVENTS = new Set(["Kill", "Killed", "BotKill", "BotKilled", "KilledByStorm"]);

async function init() {
  document.body.classList.add("loading");
  try {
    const response = await fetch("data/dataset.json");
    if (!response.ok) {
      throw new Error(`Could not load dataset (${response.status})`);
    }
    state.data = await response.json();
    initControls();
    renderAll();
  } catch (error) {
    els.matchTitle.textContent = "Dataset failed to load";
    els.activeContext.textContent = error.message;
  } finally {
    document.body.classList.remove("loading");
  }
}

function initControls() {
  const mapsByVolume = [...state.data.maps].sort((a, b) => {
    return state.data.summary.maps[b].matches - state.data.summary.maps[a].matches;
  });
  state.mapId = mapsByVolume[0];

  els.mapSelect.innerHTML = mapsByVolume
    .map((mapId) => {
      const config = state.data.mapConfigs[mapId];
      const count = state.data.summary.maps[mapId].matches;
      return `<option value="${mapId}">${config.label} (${count})</option>`;
    })
    .join("");

  els.dateSelect.innerHTML = [
    `<option value="all">All dates</option>`,
    ...state.data.dates.map((date) => `<option value="${date}">${formatDate(date)}</option>`),
  ].join("");

  state.matchId = chooseBestMatch(getFilteredMatches())?.id || "";
  updateMatchOptions();

  els.mapSelect.addEventListener("change", () => {
    state.mapId = els.mapSelect.value;
    state.matchId = chooseBestMatch(getFilteredMatches())?.id || "";
    updateMatchOptions();
    resetToEnd();
    renderAll();
  });

  els.dateSelect.addEventListener("change", () => {
    state.date = els.dateSelect.value;
    state.matchId = chooseBestMatch(getFilteredMatches())?.id || "";
    updateMatchOptions();
    resetToEnd();
    renderAll();
  });

  els.matchSelect.addEventListener("change", () => {
    pause();
    state.matchId = els.matchSelect.value;
    resetToEnd();
    renderAll();
  });

  els.heatmapButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.heatmap = button.dataset.heatmap;
      els.heatmapButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      renderHeatmap();
    });
  });

  els.humanToggle.addEventListener("change", () => {
    state.showHumans = els.humanToggle.checked;
    renderAll();
  });

  els.botToggle.addEventListener("change", () => {
    state.showBots = els.botToggle.checked;
    renderAll();
  });

  els.markerToggle.addEventListener("change", () => {
    state.showMarkers = els.markerToggle.checked;
    renderPathsAndFeed();
  });

  els.playButton.addEventListener("click", togglePlayback);
  els.speedSelect.addEventListener("change", () => {
    state.speed = Number(els.speedSelect.value);
  });

  els.timeSlider.addEventListener("input", () => {
    pause();
    state.time = Number(els.timeSlider.value);
    renderPathsAndFeed();
  });

  resetToEnd();
}

function updateMatchOptions() {
  const matches = getFilteredMatches();
  els.matchSelect.innerHTML = matches
    .map((match) => {
      const combat = combatCount(match);
      const label = `${match.shortId} | ${match.humanPlayers}H ${match.botPlayers}B | ${combat} combat | ${match.rows} rows`;
      return `<option value="${match.id}">${label}</option>`;
    })
    .join("");
  els.matchSelect.value = state.matchId;
}

function getFilteredMatches() {
  if (!state.data || !state.mapId) return [];
  return state.data.matches.filter((match) => {
    return match.mapId === state.mapId && (state.date === "all" || match.date === state.date);
  });
}

function getActiveMatch() {
  return state.data.matches.find((match) => match.id === state.matchId) || getFilteredMatches()[0];
}

function chooseBestMatch(matches) {
  return [...matches].sort((a, b) => matchScore(b) - matchScore(a))[0];
}

function matchScore(match) {
  return combatCount(match) * 120 + match.eventCounts.Loot * 8 + match.humanPlayers * 45 + match.rows;
}

function combatCount(match) {
  return [...COMBAT_EVENTS].reduce((total, event) => total + (match.eventCounts[event] || 0), 0);
}

function resetToEnd() {
  const match = getActiveMatch();
  state.time = match ? match.durationMs : 0;
  syncTimelineControls();
}

function renderAll() {
  const match = getActiveMatch();
  if (!match) return;
  state.matchId = match.id;
  els.matchSelect.value = match.id;
  setMinimap(match.mapId);
  syncTimelineControls();
  renderHeader(match);
  renderStats(match);
  renderHeatmap();
  renderPathsAndFeed();
}

function renderHeader(match) {
  const config = state.data.mapConfigs[state.mapId];
  const filtered = getFilteredMatches();
  const rowCount = filtered.reduce((total, item) => total + item.rows, 0);
  const heatEvents = countHeatmapEvents(filtered);
  const dateLabel = state.date === "all" ? "All dates" : formatDate(state.date);

  els.activeContext.textContent = `${config.label} / ${dateLabel}`;
  els.matchTitle.textContent = `Match ${match.shortId}`;
  els.summaryStrip.innerHTML = [
    `${filtered.length} matches`,
    `${formatNumber(rowCount)} rows`,
    `${formatNumber(heatEvents)} ${state.heatmap}`,
    `${formatDuration(match.durationMs)} selected`,
  ]
    .map((label) => `<span class="summary-pill">${label}</span>`)
    .join("");
}

function renderStats(match) {
  els.humanCount.textContent = formatNumber(match.humanPlayers);
  els.botCount.textContent = formatNumber(match.botPlayers);
  els.lootCount.textContent = formatNumber(match.eventCounts.Loot || 0);
  els.combatCount.textContent = formatNumber(combatCount(match));
}

function setMinimap(mapId) {
  const config = state.data.mapConfigs[mapId];
  if (els.minimap.dataset.mapId !== mapId) {
    els.minimap.src = config.image;
    els.minimap.alt = `${config.label} minimap`;
    els.minimap.dataset.mapId = mapId;
  }
}

function renderHeatmap() {
  heatCtx.clearRect(0, 0, 1024, 1024);
  const matches = getFilteredMatches();
  if (!matches.length) return;

  const bins = getHeatmapBins(matches);
  if (!bins.max) return;

  const [red, green, blue] = HEAT_COLORS[state.heatmap];
  const cellSize = bins.cellSize;
  heatCtx.save();
  heatCtx.globalCompositeOperation = "screen";

  for (const [key, count] of bins.cells.entries()) {
    const [cellX, cellY] = key.split(":").map(Number);
    const intensity = Math.sqrt(count / bins.max);
    const centerX = cellX * cellSize + cellSize / 2;
    const centerY = cellY * cellSize + cellSize / 2;
    const radius = cellSize * (1.5 + intensity * 2.6);
    const gradient = heatCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    gradient.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${0.36 + intensity * 0.42})`);
    gradient.addColorStop(0.58, `rgba(${red}, ${green}, ${blue}, ${0.16 + intensity * 0.18})`);
    gradient.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
    heatCtx.fillStyle = gradient;
    heatCtx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  }

  heatCtx.restore();
}

function getHeatmapBins(matches) {
  const key = [
    state.mapId,
    state.date,
    state.heatmap,
    state.showHumans,
    state.showBots,
  ].join("|");
  if (heatmapCache.has(key)) return heatmapCache.get(key);

  const eventSet = HEATMAP_EVENTS[state.heatmap];
  const cellSize = 16;
  const cells = new Map();
  let max = 0;

  for (const match of matches) {
    for (const player of match.players) {
      if (!shouldShowPlayer(player)) continue;
      for (const eventRow of player.events) {
        const event = eventName(eventRow[3]);
        if (!eventSet.has(event)) continue;
        const [x, y] = worldToPixel(match.mapId, eventRow[1], eventRow[2]);
        const cellX = clamp(Math.floor(x / cellSize), 0, 63);
        const cellY = clamp(Math.floor(y / cellSize), 0, 63);
        const cellKey = `${cellX}:${cellY}`;
        const value = (cells.get(cellKey) || 0) + 1;
        cells.set(cellKey, value);
        max = Math.max(max, value);
      }
    }
  }

  const bins = { cells, max, cellSize };
  heatmapCache.set(key, bins);
  return bins;
}

function renderPathsAndFeed() {
  const match = getActiveMatch();
  if (!match) return;

  pathCtx.clearRect(0, 0, 1024, 1024);
  const visibleMarkers = [];

  for (const player of match.players) {
    if (!shouldShowPlayer(player)) continue;
    const positions = [];

    for (const eventRow of player.events) {
      if (eventRow[0] > state.time) continue;
      const event = eventName(eventRow[3]);
      if (POSITION_EVENTS.has(event)) {
        positions.push(worldToPixel(match.mapId, eventRow[1], eventRow[2]));
      } else if (state.showMarkers) {
        visibleMarkers.push({ player, eventRow, event });
      }
    }

    drawPath(player, positions);
  }

  if (state.showMarkers) {
    for (const marker of visibleMarkers) {
      drawMarker(match.mapId, marker.eventRow, marker.event, marker.player.type);
    }
  }

  renderEventFeed(visibleMarkers);
  syncTimelineControls();
}

function drawPath(player, positions) {
  if (!positions.length) return;
  pathCtx.save();
  pathCtx.lineWidth = player.type === "human" ? 2.25 : 1.7;
  pathCtx.strokeStyle = player.type === "human" ? "rgba(45, 212, 191, 0.78)" : "rgba(245, 158, 11, 0.62)";
  pathCtx.lineJoin = "round";
  pathCtx.lineCap = "round";
  if (player.type === "bot") {
    pathCtx.setLineDash([8, 8]);
  }
  pathCtx.beginPath();
  positions.forEach(([x, y], index) => {
    if (index === 0) pathCtx.moveTo(x, y);
    else pathCtx.lineTo(x, y);
  });
  pathCtx.stroke();
  pathCtx.setLineDash([]);

  const [headX, headY] = positions[positions.length - 1];
  pathCtx.fillStyle = player.type === "human" ? "#2dd4bf" : "#f59e0b";
  pathCtx.strokeStyle = "rgba(0, 0, 0, 0.55)";
  pathCtx.lineWidth = 2;
  pathCtx.beginPath();
  pathCtx.arc(headX, headY, player.type === "human" ? 4.2 : 3.5, 0, Math.PI * 2);
  pathCtx.fill();
  pathCtx.stroke();
  pathCtx.restore();
}

function drawMarker(mapId, eventRow, event, playerType) {
  const [x, y] = worldToPixel(mapId, eventRow[1], eventRow[2]);
  const size = playerType === "human" ? 8 : 7;
  pathCtx.save();
  pathCtx.lineWidth = 2.2;
  pathCtx.strokeStyle = "rgba(14, 15, 16, 0.78)";

  if (event === "Kill" || event === "BotKill") {
    pathCtx.fillStyle = event === "Kill" ? "#ef4444" : "#fb923c";
    pathCtx.beginPath();
    pathCtx.moveTo(x, y - size);
    pathCtx.lineTo(x + size, y + size);
    pathCtx.lineTo(x - size, y + size);
    pathCtx.closePath();
    pathCtx.fill();
    pathCtx.stroke();
  } else if (event === "Killed" || event === "BotKilled") {
    pathCtx.strokeStyle = "#e879f9";
    pathCtx.beginPath();
    pathCtx.moveTo(x - size, y - size);
    pathCtx.lineTo(x + size, y + size);
    pathCtx.moveTo(x + size, y - size);
    pathCtx.lineTo(x - size, y + size);
    pathCtx.stroke();
  } else if (event === "KilledByStorm") {
    pathCtx.fillStyle = "rgba(139, 92, 246, 0.86)";
    pathCtx.beginPath();
    pathCtx.arc(x, y, size, 0, Math.PI * 2);
    pathCtx.fill();
    pathCtx.stroke();
  } else if (event === "Loot") {
    pathCtx.fillStyle = "#facc15";
    pathCtx.translate(x, y);
    pathCtx.rotate(Math.PI / 4);
    pathCtx.fillRect(-size * 0.7, -size * 0.7, size * 1.4, size * 1.4);
    pathCtx.strokeRect(-size * 0.7, -size * 0.7, size * 1.4, size * 1.4);
  }

  pathCtx.restore();
}

function renderEventFeed(markers) {
  const latest = markers
    .slice()
    .sort((a, b) => b.eventRow[0] - a.eventRow[0])
    .slice(0, 10);

  if (!latest.length) {
    els.eventFeed.innerHTML = `<li><strong>No events visible</strong>Move the timeline or change filters.</li>`;
    return;
  }

  els.eventFeed.innerHTML = latest
    .map((marker) => {
      const player = shortPlayer(marker.player.id);
      return `<li><strong>${EVENT_LABELS[marker.event]}</strong>${formatDuration(marker.eventRow[0])} / ${marker.player.type} ${player}</li>`;
    })
    .join("");
}

function togglePlayback() {
  if (state.playing) {
    pause();
    return;
  }
  const match = getActiveMatch();
  if (!match) return;
  if (state.time >= match.durationMs) {
    state.time = 0;
  }
  state.playing = true;
  lastFrameAt = 0;
  els.playButton.textContent = "Pause";
  animationFrame = requestAnimationFrame(stepPlayback);
}

function pause() {
  state.playing = false;
  els.playButton.textContent = "Play";
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }
}

function stepPlayback(now) {
  const match = getActiveMatch();
  if (!match || !state.playing) return;
  if (!lastFrameAt) lastFrameAt = now;
  const elapsedWallMs = now - lastFrameAt;
  lastFrameAt = now;
  const fullPlaybackMs = 15000 / state.speed;
  const dataMsPerWallMs = match.durationMs / fullPlaybackMs;
  state.time = Math.min(match.durationMs, state.time + elapsedWallMs * dataMsPerWallMs);
  renderPathsAndFeed();

  if (state.time >= match.durationMs) {
    pause();
    return;
  }
  animationFrame = requestAnimationFrame(stepPlayback);
}

function syncTimelineControls() {
  const match = getActiveMatch();
  const duration = match ? match.durationMs : 0;
  els.timeSlider.max = String(Math.max(1, duration));
  els.timeSlider.value = String(Math.round(clamp(state.time, 0, duration)));
  els.timeLabel.textContent = `t+${formatDuration(state.time)}`;
  els.durationLabel.textContent = `duration ${formatDuration(duration)}`;
}

function countHeatmapEvents(matches) {
  const eventSet = HEATMAP_EVENTS[state.heatmap];
  let count = 0;
  for (const match of matches) {
    for (const event of eventSet) {
      count += match.eventCounts[event] || 0;
    }
  }
  return count;
}

function shouldShowPlayer(player) {
  return (player.type === "human" && state.showHumans) || (player.type === "bot" && state.showBots);
}

function eventName(code) {
  return state.data.codeToEvent[code] || code;
}

function worldToPixel(mapId, x, z) {
  const config = state.data.mapConfigs[mapId];
  const u = (x - config.originX) / config.scale;
  const v = (z - config.originZ) / config.scale;
  return [u * 1024, (1 - v) * 1024];
}

function formatDate(value) {
  return value.replace("_", " ");
}

function formatDuration(value) {
  const rounded = Math.round(value);
  if (rounded < 1000) return `${rounded} ms`;
  return `${(rounded / 1000).toFixed(1)} s`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function shortPlayer(id) {
  return id.length > 10 ? id.slice(0, 8) : id;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

init();
