import http from "http";
import url from "url";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { calculatePlanetPositions, calculateLST, convertRaDecToAltAz } from "../functions/planetMath.js";
import { UPCOMING_EVENTS } from "../functions/eventsData.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const functionsDataDir = path.resolve(__dirname, "../functions/data");

// Helper to compute Moon Phase
function calculateMoonPhase(date) {
  const julianDate = (date.getTime() / 86400000) + 2440587.5;
  const newMoonJD = 2451550.26;
  const synodicMonth = 29.530588853;
  const daysSinceNew = julianDate - newMoonJD;
  let phase = (daysSinceNew / synodicMonth) % 1;
  if (phase < 0) phase += 1;

  let phaseName = "";
  let emoji = "";

  if (phase < 0.03 || phase > 0.97) {
    phaseName = "New Moon";
    emoji = "🌑";
  } else if (phase < 0.22) {
    phaseName = "Waxing Crescent";
    emoji = "🌒";
  } else if (phase < 0.28) {
    phaseName = "First Quarter";
    emoji = "🌓";
  } else if (phase < 0.47) {
    phaseName = "Waxing Gibbous";
    emoji = "🌔";
  } else if (phase < 0.53) {
    phaseName = "Full Moon";
    emoji = "🌕";
  } else if (phase < 0.72) {
    phaseName = "Waning Gibbous";
    emoji = "🌖";
  } else if (phase < 0.78) {
    phaseName = "Third Quarter";
    emoji = "🌗";
  } else {
    phaseName = "Waning Crescent";
    emoji = "🌘";
  }

  const illumination = Math.round(50 * (1 - Math.cos(2 * Math.PI * phase)));
  return { name: phaseName, emoji, illumination };
}

function getCompassDirection(azimuth) {
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return directions[Math.round(azimuth / 22.5) % 16];
}

const PORT = 3001;

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  const lat = parseFloat(query.lat) || 40.7128;
  const lon = parseFloat(query.lon) || -74.0060;
  const dateStr = query.date || new Date().toISOString();
  const date = new Date(dateStr);

  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === "/api/trmnl") {
    try {
      const positions = calculatePlanetPositions(date, lat, lon);
      const moon = calculateMoonPhase(date);

      const planets = Object.keys(positions)
        .filter(p => p !== "Earth")
        .map(name => {
          const data = positions[name];
          return {
            name: name,
            altitude: Math.round(data.altitude * 10) / 10,
            azimuth: Math.round(data.azimuth * 10) / 10,
            altitude_formatted: `${data.altitude >= 0 ? "+" : ""}${Math.round(data.altitude * 10) / 10}°`,
            azimuth_formatted: `${Math.round(data.azimuth)}° ${getCompassDirection(data.azimuth)}`,
            visible: data.altitude >= 0
          };
        });

      const nowMs = date.getTime();
      const upcoming = UPCOMING_EVENTS
        .filter(ev => new Date(ev.date).getTime() > nowMs)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let nextEvent = null;
      if (upcoming.length > 0) {
        const ev = upcoming[0];
        const evDate = new Date(ev.date);
        const options = { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" };
        nextEvent = {
          title: ev.title,
          date_formatted: evDate.toLocaleDateString("en-US", options),
          description: ev.description
        };
      }

      const lastUpdated = date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        latitude: lat.toFixed(4),
        longitude: lon.toFixed(4),
        last_updated: lastUpdated,
        moon_phase: moon.name,
        moon_phase_emoji: moon.emoji,
        moon_illumination: moon.illumination,
        planets,
        next_event: nextEvent
      }, null, 2));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (pathname === "/api/sky.svg") {
    try {
      const LST_deg = calculateLST(date, lon);
      const planetPositions = calculatePlanetPositions(date, lat, lon);

      const size = 400;
      const cx = 200;
      const cy = 200;
      const r = 160;

      let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="100%" height="100%">\n`;
      svg += `  <style>\n`;
      svg += `    .horizon { stroke: black; stroke-width: 1.5; fill: none; }\n`;
      svg += `    .grid-line { stroke: #d0d0d0; stroke-width: 0.5; stroke-dasharray: 2,4; fill: none; }\n`;
      svg += `    .constellation-line { stroke: #c0c0c0; stroke-width: 0.8; stroke-dasharray: 2,2; fill: none; }\n`;
      svg += `    .star { fill: black; stroke: none; }\n`;
      svg += `    .planet { fill: black; stroke: black; stroke-width: 1; }\n`;
      svg += `    .sun-body { fill: none; stroke: black; stroke-width: 1.5; }\n`;
      svg += `    .label { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 10px; fill: black; font-weight: bold; }\n`;
      svg += `    .cardinal { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 12px; fill: black; font-weight: 800; }\n`;
      svg += `    .sky-bg { fill: white; }\n`;
      svg += `  </style>\n`;

      svg += `  <circle cx="${cx}" cy="${cy}" r="${r}" class="sky-bg" />\n`;

      const project = (alt, az) => {
        const pr = r * (1 - (alt / 90));
        const theta = (az - 90) * (Math.PI / 180);
        return {
          x: cx + pr * Math.cos(theta),
          y: cy + pr * Math.sin(theta)
        };
      };

      svg += `  <!-- Grid & Horizon -->\n`;
      svg += `  <circle cx="${cx}" cy="${cy}" r="${r}" class="horizon" />\n`;
      svg += `  <circle cx="${cx}" cy="${cy}" r="${r * 0.5}" class="grid-line" />\n`;
      svg += `  <line x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy + r}" class="grid-line" />\n`;
      svg += `  <line x1="${cx - r}" y1="${cy}" x2="${cx + r}" y2="${cy}" class="grid-line" />\n`;

      // Draw Constellations
      svg += `  <!-- Constellations -->\n`;
      try {
        const constellationsFile = path.join(functionsDataDir, "constellations.lines.json");
        if (fs.existsSync(constellationsFile)) {
          const constellations = JSON.parse(fs.readFileSync(constellationsFile, "utf8"));
          constellations.features.forEach(feature => {
            feature.geometry.coordinates.forEach(lineString => {
              for (let i = 0; i < lineString.length - 1; i++) {
                const [ra1, dec1] = lineString[i];
                const [ra2, dec2] = lineString[i + 1];

                const pos1 = convertRaDecToAltAz(ra1, dec1, lat, LST_deg);
                const pos2 = convertRaDecToAltAz(ra2, dec2, lat, LST_deg);

                if (pos1.altitude >= -2 && pos2.altitude >= -2) {
                  const pt1 = project(pos1.altitude, pos1.azimuth);
                  const pt2 = project(pos2.altitude, pos2.azimuth);
                  svg += `  <line x1="${pt1.x.toFixed(1)}" y1="${pt1.y.toFixed(1)}" x2="${pt2.x.toFixed(1)}" y2="${pt2.y.toFixed(1)}" class="constellation-line" />\n`;
                }
              }
            });
          });
        }
      } catch (e) {
        console.error("Error drawing constellations:", e);
      }

      // Draw Bright Stars (mag < 4.0)
      svg += `  <!-- Bright Stars -->\n`;
      try {
        const starsFile = path.join(functionsDataDir, "stars.6.json");
        if (fs.existsSync(starsFile)) {
          const stars = JSON.parse(fs.readFileSync(starsFile, "utf8"));
          stars.features.forEach(feature => {
            const ra = feature.geometry.coordinates[0];
            const dec = feature.geometry.coordinates[1];
            const mag = feature.properties.mag;

            if (mag <= 4.0) {
              const pos = convertRaDecToAltAz(ra, dec, lat, LST_deg);
              if (pos.altitude >= 0) {
                const pt = project(pos.altitude, pos.azimuth);
                const starRadius = Math.max(0.5, 2.5 - 0.5 * mag);
                svg += `  <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${starRadius.toFixed(1)}" class="star" />\n`;
              }
            }
          });
        }
      } catch (e) {
        console.error("Error drawing stars:", e);
      }

      // Draw Planets & Sun
      svg += `  <!-- Sun & Planets -->\n`;
      Object.keys(planetPositions)
        .filter(p => p !== "Earth")
        .forEach(name => {
          const data = planetPositions[name];
          if (data.altitude >= 0) {
            const pt = project(data.altitude, data.azimuth);
            if (name === "Sun") {
              svg += `  <g>\n`;
              svg += `    <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="6" class="sun-body" />\n`;
              svg += `    <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="1.5" fill="black" />\n`;
              svg += `    <text x="${pt.x.toFixed(1)}" y="${(pt.y - 10).toFixed(1)}" class="label" text-anchor="middle">Sun</text>\n`;
              svg += `  </g>\n`;
            } else {
              svg += `  <g>\n`;
              svg += `    <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3" class="planet" />\n`;
              svg += `    <text x="${pt.x.toFixed(1)}" y="${(pt.y - 7).toFixed(1)}" class="label" text-anchor="middle">${name}</text>\n`;
              svg += `  </g>\n`;
            }
          }
        });

      // Cardinal Directions
      svg += `  <!-- Cardinal Directions -->\n`;
      svg += `  <text x="${cx}" y="${cy - r - 6}" class="cardinal" text-anchor="middle">N</text>\n`;
      svg += `  <text x="${cx + r + 6}" y="${cy + 4}" class="cardinal" text-anchor="start">E</text>\n`;
      svg += `  <text x="${cx}" y="${cy + r + 15}" class="cardinal" text-anchor="middle">S</text>\n`;
      svg += `  <text x="${cx - r - 15}" y="${cy + 4}" class="cardinal" text-anchor="start">W</text>\n`;

      svg += `</svg>`;

      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      res.end(svg);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(e.message);
    }
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

server.listen(PORT, () => {
  console.log(`Local test server running at http://localhost:${PORT}`);
  console.log(`- JSON API: http://localhost:${PORT}/api/trmnl?lat=40.7128&lon=-74.0060`);
  console.log(`- SVG Sky Map: http://localhost:${PORT}/api/sky.svg?lat=40.7128&lon=-74.0060`);
});
