import { onRequest } from "firebase-functions/v2/https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { calculatePlanetPositions, calculateLST, convertRaDecToAltAz } from "./planetMath.js";
import { UPCOMING_EVENTS } from "./eventsData.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "data");

// Helper to compute Moon Phase and Illumination
function calculateMoonPhase(date) {
  const julianDate = (date.getTime() / 86400000) + 2440587.5;
  const newMoonJD = 2451550.26; // New Moon on Jan 6, 2000
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
  return {
    name: phaseName,
    emoji: emoji,
    illumination: illumination
  };
}

// Helper to format Azimuth into compass directions
function getCompassDirection(azimuth) {
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const index = Math.round(azimuth / 22.5) % 16;
  return directions[index];
}

// Helper to determine if US Daylight Saving Time (DST) is active
function isUSDST(date) {
  const year = date.getUTCFullYear();
  
  // DST in US starts on the second Sunday of March
  let startDST = new Date(Date.UTC(year, 2, 8, 2, 0, 0));
  while (startDST.getUTCDay() !== 0) {
    startDST.setUTCDate(startDST.getUTCDate() + 1);
  }
  
  // DST in US ends on the first Sunday of November
  let endDST = new Date(Date.UTC(year, 10, 1, 2, 0, 0));
  while (endDST.getUTCDay() !== 0) {
    endDST.setUTCDate(endDST.getUTCDate() + 1);
  }
  
  const time = date.getTime();
  return time >= startDST.getTime() && time < endDST.getTime();
}

// GET /api/trmnl
export const trmnl = onRequest({ cors: true, invoker: "public" }, (req, res) => {
  try {
    const lat = parseFloat(req.query.lat) || 40.7128;
    const lon = parseFloat(req.query.lon) || -74.0060;
    
    const dateStr = req.query.date || new Date().toISOString();
    const date = new Date(dateStr);

    // Calculate timezone offset (hours) based on longitude or query parameter
    let tzOffset = parseFloat(req.query.tz);
    if (isNaN(tzOffset)) {
      tzOffset = Math.round(lon / 15);
      // Adjust for US Daylight Saving Time (DST)
      if (tzOffset >= -8 && tzOffset <= -5 && isUSDST(date)) {
        tzOffset += 1;
      }
    }

    const positions = calculatePlanetPositions(date, lat, lon);
    const moon = calculateMoonPhase(date);

    // Map planets for display
    const planetList = Object.keys(positions)
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

    // Find next upcoming event
    const nowMs = date.getTime();
    const upcoming = UPCOMING_EVENTS
      .filter(ev => new Date(ev.date).getTime() > nowMs)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let nextEvent = null;
    if (upcoming.length > 0) {
      const ev = upcoming[0];
      const evDate = new Date(ev.date);
      
      // Format event date in the local timezone
      const evLocalTime = evDate.getTime() + tzOffset * 60 * 60 * 1000;
      const evLocalDate = new Date(evLocalTime);
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const evMonth = months[evLocalDate.getUTCMonth()];
      const evDay = evLocalDate.getUTCDate();
      const evHours = String(evLocalDate.getUTCHours()).padStart(2, "0");
      const evMinutes = String(evLocalDate.getUTCMinutes()).padStart(2, "0");
      
      nextEvent = {
        title: ev.title,
        date_formatted: `${evMonth} ${evDay}, ${evHours}:${evMinutes}`,
        description: ev.description
      };
    }

    // Format local date/time string for display
    const localTime = date.getTime() + tzOffset * 60 * 60 * 1000;
    const localDate = new Date(localTime);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[localDate.getUTCMonth()];
    const day = localDate.getUTCDate();
    const hours = String(localDate.getUTCHours()).padStart(2, "0");
    const minutes = String(localDate.getUTCMinutes()).padStart(2, "0");
    const lastUpdated = `${month} ${day}, ${hours}:${minutes}`;

    res.json({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      last_updated: lastUpdated,
      moon_phase: moon.name,
      moon_phase_emoji: moon.emoji,
      moon_illumination: moon.illumination,
      planets: planetList,
      next_event: nextEvent
    });
  } catch (error) {
    console.error("Error in /trmnl API:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sky.svg
export const sky = onRequest({ cors: true, invoker: "public" }, (req, res) => {
  try {
    const lat = parseFloat(req.query.lat) || 40.7128;
    const lon = parseFloat(req.query.lon) || -74.0060;
    const dateStr = req.query.date || new Date().toISOString();
    const date = new Date(dateStr);

    const LST_deg = calculateLST(date, lon);
    const planetPositions = calculatePlanetPositions(date, lat, lon);

    // Setup SVG dimensions (centered at 200, 200 with radius 160)
    const size = 400;
    const cx = 200;
    const cy = 200;
    const r = 160;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="100%" height="100%">\n`;
    
    // Background style (pure white for E-Ink, black/gray drawing lines)
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

    // Outer sky vault canvas background
    svg += `  <circle cx="${cx}" cy="${cy}" r="${r}" class="sky-bg" />\n`;

    // Projected Coordinate helper
    const project = (alt, az) => {
      // Map Altitude (0 to 90) to radius (r to 0)
      const pr = r * (1 - (alt / 90));
      // Map Azimuth: 0 = North (up), 90 = East (right), 180 = South (down), 270 = West (left)
      const theta = (az - 90) * (Math.PI / 180);
      return {
        x: cx + pr * Math.cos(theta),
        y: cy + pr * Math.sin(theta)
      };
    };

    // 1. Draw Grid Lines (Horizon crosshairs)
    svg += `  <!-- Grid & Horizon -->\n`;
    svg += `  <circle cx="${cx}" cy="${cy}" r="${r}" class="horizon" />\n`;
    svg += `  <circle cx="${cx}" cy="${cy}" r="${r * 0.5}" class="grid-line" />\n`; // 45 deg altitude circle
    svg += `  <line x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy + r}" class="grid-line" />\n`; // N-S axis
    svg += `  <line x1="${cx - r}" y1="${cy}" x2="${cx + r}" y2="${cy}" class="grid-line" />\n`; // E-W axis

    // 2. Draw Constellations
    svg += `  <!-- Constellations -->\n`;
    try {
      const constellationsFile = path.join(dataDir, "constellations.lines.json");
      if (fs.existsSync(constellationsFile)) {
        const constellations = JSON.parse(fs.readFileSync(constellationsFile, "utf8"));
        constellations.features.forEach(feature => {
          feature.geometry.coordinates.forEach(lineString => {
            for (let i = 0; i < lineString.length - 1; i++) {
              const [ra1, dec1] = lineString[i];
              const [ra2, dec2] = lineString[i + 1];

              const pos1 = convertRaDecToAltAz(ra1, dec1, lat, LST_deg);
              const pos2 = convertRaDecToAltAz(ra2, dec2, lat, LST_deg);

              // Only draw if both points are above the horizon (or very close to it)
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

    // 3. Draw Bright Stars (mag < 4.0)
    svg += `  <!-- Bright Stars -->\n`;
    try {
      const starsFile = path.join(dataDir, "stars.6.json");
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
              // Star size varies by magnitude
              const starRadius = Math.max(0.5, 2.5 - 0.5 * mag);
              svg += `  <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${starRadius.toFixed(1)}" class="star" />\n`;
            }
          }
        });
      }
    } catch (e) {
      console.error("Error drawing stars:", e);
    }

    // 4. Draw Planets & Sun with label collision avoidance
    svg += `  <!-- Sun & Planets -->\n`;
    const obstacles = [
      { x1: 190, y1: 15, x2: 210, y2: 35 },  // North
      { x1: 355, y1: 190, x2: 385, y2: 215 }, // East
      { x1: 190, y1: 360, x2: 210, y2: 390 }, // South
      { x1: 15, y1: 190, x2: 45, y2: 215 }   // West
    ];

    // Add all planet dots as obstacles so labels don't cover them
    Object.keys(planetPositions)
      .filter(p => p !== "Earth")
      .forEach(name => {
        const data = planetPositions[name];
        if (data.altitude >= 0) {
          const pt = project(data.altitude, data.azimuth);
          const rSize = name === "Sun" ? 8 : 4;
          obstacles.push({
            x1: pt.x - rSize,
            y1: pt.y - rSize,
            x2: pt.x + rSize,
            y2: pt.y + rSize
          });
        }
      });

    const checkOverlap = (box) => {
      for (const obs of obstacles) {
        const noOverlap = box.x2 < obs.x1 || box.x1 > obs.x2 || box.y2 < obs.y1 || box.y1 > obs.y2;
        if (!noOverlap) return true;
      }
      return false;
    };

    Object.keys(planetPositions)
      .filter(p => p !== "Earth")
      .forEach(name => {
        const data = planetPositions[name];
        if (data.altitude >= 0) {
          const pt = project(data.altitude, data.azimuth);
          const px = pt.x;
          const py = pt.y;

          if (name === "Sun") {
            svg += `  <g>\n`;
            svg += `    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="6" class="sun-body" />\n`;
            svg += `    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="1.5" fill="black" />\n`;
          } else {
            svg += `  <g>\n`;
            svg += `    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" class="planet" />\n`;
          }

          // Determine label position
          const labelWidth = name.length * 6.5;
          const labelHeight = 10;
          let lx = px;
          let ly = py - 8;
          let anchor = "middle";
          let found = false;

          // Try 4 directions: Top, Bottom, Right, Left
          const candidates = [
            { lx: px, ly: py - 8, anchor: "middle", box: { x1: px - labelWidth/2, y1: py - 8 - labelHeight, x2: px + labelWidth/2, y2: py - 8 } },
            { lx: px, ly: py + 12, anchor: "middle", box: { x1: px - labelWidth/2, y1: py + 12, x2: px + labelWidth/2, y2: py + 12 + labelHeight } },
            { lx: px + 8, ly: py + 3, anchor: "start", box: { x1: px + 8, y1: py + 3 - labelHeight/2, x2: px + 8 + labelWidth, y2: py + 3 + labelHeight/2 } },
            { lx: px - 8, ly: py + 3, anchor: "end", box: { x1: px - 8 - labelWidth, y1: py + 3 - labelHeight/2, x2: px - 8, y2: py + 3 + labelHeight/2 } }
          ];

          for (const cand of candidates) {
            if (!checkOverlap(cand.box)) {
              lx = cand.lx;
              ly = cand.ly;
              anchor = cand.anchor;
              obstacles.push(cand.box);
              found = true;
              break;
            }
          }

          // Fallback: stack vertically if all directions are blocked
          if (!found) {
            let offset = 8;
            while (true) {
              const testBox = { x1: px - labelWidth/2, y1: py - offset - labelHeight, x2: px + labelWidth/2, y2: py - offset };
              if (!checkOverlap(testBox)) {
                lx = px;
                ly = py - offset;
                anchor = "middle";
                obstacles.push(testBox);
                break;
              }
              offset += 10;
              if (offset > 100) { // Safety limit
                lx = px;
                ly = py - 8;
                anchor = "middle";
                break;
              }
            }
          }

          svg += `    <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="label" text-anchor="${anchor}">${name}</text>\n`;
          svg += `  </g>\n`;
        }
      });

    // 5. Draw Cardinal Direction Markers
    svg += `  <!-- Cardinal Directions -->\n`;
    svg += `  <text x="${cx}" y="${cy - r - 6}" class="cardinal" text-anchor="middle">N</text>\n`;
    svg += `  <text x="${cx + r + 6}" y="${cy + 4}" class="cardinal" text-anchor="start">E</text>\n`;
    svg += `  <text x="${cx}" y="${cy + r + 15}" class="cardinal" text-anchor="middle">S</text>\n`;
    svg += `  <text x="${cx - r - 15}" y="${cy + 4}" class="cardinal" text-anchor="start">W</text>\n`;

    svg += `</svg>`;

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=600");
    res.send(svg);
  } catch (error) {
    console.error("Error in /sky.svg API:", error);
    res.status(500).send(`<svg><text x="10" y="20">Error: ${error.message}</text></svg>`);
  }
});
