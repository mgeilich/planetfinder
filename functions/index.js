import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { calculatePlanetPositions, calculateLST, convertRaDecToAltAz } from "./planetMath.js";
import { UPCOMING_EVENTS } from "./eventsData.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "data");

// Cap scaling so a bug or abusive traffic can't run up the bill.
// Each request takes milliseconds, so 5 instances x 80 concurrent requests is ample.
setGlobalOptions({ maxInstances: 5, concurrency: 80, cpu: 1 });

const DEFAULT_LAT = 40.7128;
const DEFAULT_LON = -74.0060;

// Parse a coordinate such as "40.7128", "-74.006", "40.7128 N" or "74.006°W".
// Returns the fallback when the value is empty, and null when it is invalid.
function parseCoordinate(value, limit, fallback) {
  if (value === undefined || String(value).trim() === "") return fallback;
  const match = String(value).trim().match(/^([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?$/i);
  if (!match) return null;
  let coord = parseFloat(match[1]);
  const hemisphere = (match[2] || "").toUpperCase();
  if (hemisphere === "S" || hemisphere === "W") coord = -Math.abs(coord);
  if (Math.abs(coord) > limit) return null;
  return coord;
}

function parseLocation(query) {
  const lat = parseCoordinate(query.lat, 90, DEFAULT_LAT);
  const lon = parseCoordinate(query.lon, 180, DEFAULT_LON);
  return {
    lat: lat ?? DEFAULT_LAT,
    lon: lon ?? DEFAULT_LON,
    error: lat === null || lon === null ? "Check latitude/longitude in plugin settings" : null
  };
}

// UTC offset (hours) of an IANA time zone such as "America/New_York" at a given instant
function zoneOffsetHours(zone, date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric"
  }).formatToParts(date);
  const get = type => parseInt(parts.find(p => p.type === type).value, 10);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUTC - Math.floor(date.getTime() / 60000) * 60000) / 60000) / 60;
}

// Time zone from the tz parameter (IANA name or hour offset), else estimated from longitude
function resolveTzOffset(tz, lon, date) {
  const value = (tz || "").trim();
  if (value !== "") {
    if (/^[+-]?\d+(\.\d+)?$/.test(value)) return parseFloat(value);
    try {
      return zoneOffsetHours(value, date);
    } catch {
      // Unknown zone name: fall through to the estimate
    }
  }
  let offset = Math.round(lon / 15);
  // Adjust for US Daylight Saving Time (DST)
  if (offset >= -8 && offset <= -5 && isUSDST(date)) {
    offset += 1;
  }
  return offset;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Approximate equinox/solstice instants (Meeus, Astronomical Algorithms ch. 27, mean terms)
function seasonDates(year) {
  const y = (year - 2000) / 1000;
  const jdes = [
    2451623.80984 + 365242.37404 * y + 0.05169 * y ** 2 - 0.00411 * y ** 3 - 0.00057 * y ** 4,
    2451716.56767 + 365241.62603 * y + 0.00325 * y ** 2 + 0.00888 * y ** 3 - 0.00030 * y ** 4,
    2451810.21715 + 365242.01767 * y - 0.11575 * y ** 2 + 0.00337 * y ** 3 + 0.00078 * y ** 4,
    2451900.05952 + 365242.74049 * y - 0.06223 * y ** 2 - 0.00823 * y ** 3 + 0.00032 * y ** 4
  ];
  return jdes.map(jde => new Date((jde - 2440587.5) * 86400000));
}

// Recurring events (meteor shower peaks, equinoxes, solstices) for a year
function recurringEvents(year, lat) {
  const north = lat >= 0;
  const showers = [
    [0, 3, "Quadrantid Meteor Shower", "Peak of the Quadrantids, with up to 40 meteors an hour from a dark site. Best after midnight."],
    [3, 22, "Lyrid Meteor Shower", "Peak of the Lyrids, about 20 meteors an hour. Best in the hours before dawn."],
    [4, 6, "Eta Aquariid Meteor Shower", "Peak of the Eta Aquariids, debris from Halley's Comet. Best before dawn, especially from the Southern Hemisphere."],
    [7, 12, "Perseid Meteor Shower", "Peak of the Perseids, up to 60 meteors an hour. Best after midnight from a dark site."],
    [9, 21, "Orionid Meteor Shower", "Peak of the Orionids, debris from Halley's Comet. Best after midnight."],
    [10, 17, "Leonid Meteor Shower", "Peak of the Leonids, about 15 meteors an hour. Best before dawn."],
    [11, 14, "Geminid Meteor Shower", "Peak of the Geminids, the year's richest shower at up to 120 meteors an hour."]
  ].map(([month, day, title, description]) => ({
    title, description, dateOnly: true,
    // Noon UTC keeps the calendar day the same across time zones
    time: Date.UTC(year, month, day, 12)
  }));

  const [march, june, september, december] = seasonDates(year);
  const seasons = [
    [march, "March Equinox", north ? "spring" : "autumn"],
    [june, "June Solstice", north ? "summer" : "winter"],
    [september, "September Equinox", north ? "autumn" : "spring"],
    [december, "December Solstice", north ? "winter" : "summer"]
  ].map(([date, title, season]) => ({
    title, dateOnly: true, time: date.getTime(), useTz: true,
    description: `The first day of ${season} in the ${north ? "Northern" : "Southern"} Hemisphere.`
  }));

  return [...showers, ...seasons];
}

// Next upcoming event: curated planet events from eventsData.js plus recurring ones
function findNextEvent(date, lat, tzOffset) {
  const year = date.getUTCFullYear();
  const curated = UPCOMING_EVENTS.map(ev => {
    // Curated dates are local wall-clock times with no zone; keep them as written
    const [d, t] = ev.date.split("T");
    const [y, m, day] = d.split("-").map(Number);
    const [hh, mm] = t.split(":").map(Number);
    return {
      title: ev.title, description: ev.description,
      time: Date.UTC(y, m - 1, day, hh, mm) - tzOffset * 3600000,
      wallClock: { month: m - 1, day, hh, mm }
    };
  });
  const candidates = [...curated, ...recurringEvents(year, lat), ...recurringEvents(year + 1, lat)];
  const now = date.getTime();
  const next = candidates
    .filter(ev => ev.time > now)
    .sort((a, b) => a.time - b.time)[0];
  if (!next) return null;

  let dateFormatted;
  if (next.wallClock) {
    const { month, day, hh, mm } = next.wallClock;
    dateFormatted = `${MONTHS[month]} ${day}, ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  } else {
    const shown = new Date(next.time + (next.useTz ? tzOffset * 3600000 : 0));
    dateFormatted = `${MONTHS[shown.getUTCMonth()]} ${shown.getUTCDate()}`;
  }
  return { title: next.title, date_formatted: dateFormatted, description: next.description };
}

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
    const { lat, lon, error: coordsError } = parseLocation(req.query);

    const dateStr = req.query.date || new Date().toISOString();
    const date = new Date(dateStr);

    const tzOffset = resolveTzOffset(req.query.tz, lon, date);

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
          compass_direction: getCompassDirection(data.azimuth),
          visible: data.altitude >= 0
        };
      });

    const nextEvent = findNextEvent(date, lat, tzOffset);

    // Format local date/time string for display
    const localTime = date.getTime() + tzOffset * 60 * 60 * 1000;
    const localDate = new Date(localTime);
    const month = MONTHS[localDate.getUTCMonth()];
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
      next_event: nextEvent,
      coords_error: coordsError
    });
  } catch (error) {
    console.error("Error in /trmnl API:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sky.svg
export const sky = onRequest({ cors: true, invoker: "public" }, (req, res) => {
  try {
    const { lat, lon } = parseLocation(req.query);
    const dateStr = req.query.date || new Date().toISOString();
    const date = new Date(dateStr);

    const LST_deg = calculateLST(date, lon);
    const planetPositions = calculatePlanetPositions(date, lat, lon);

    // Setup SVG dimensions (defaults to 680x480, centered at 390, 320)
    let width = 680;
    let height = 480;
    let cx = 390; // Shifted dome center X to 390 (twice as much to the right)
    let cy = 320; // Shifted center down to 320 to allow a larger dome radius
    let r = 246; // Coordinate space radius (reduced by 15% from 290 to 246)
    let fontSize = 30;

    if (req.query.width || req.query.height) {
      width = parseFloat(req.query.width) || 680;
      height = parseFloat(req.query.height) || 480;
      // Fit the dome to the frame. With the 22° pitch below, a dome of radius r spans
      // 2r wide and r above / 0.375r below its center; leave room for labels around it.
      // Font size depends on r, so iterate a few times to settle both.
      let top = 0;
      fontSize = 16;
      for (let i = 0; i < 3; i++) {
        const side = fontSize * 0.6;
        top = fontSize * 1.4;
        const bottom = fontSize * 1.2;
        r = Math.min((width - 2 * side) / 2, (height - top - bottom) / 1.375);
        fontSize = Math.max(16, Math.round(30 * (r / 246)));
      }
      cx = width / 2;
      cy = top + r;
    }

    const scaleFactor = fontSize / 30.0;

    // Rotation angles for 3D perspective
    const alpha = -30 * (Math.PI / 180); // Yaw
    const beta = 22 * (Math.PI / 180);  // Pitch
    
    const cosA = Math.cos(alpha);
    const sinA = Math.sin(alpha);
    const cosB = Math.cos(beta);
    const sinB = Math.sin(beta);

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">\n`;
    
    // Background style (pure white for E-Ink, black/gray drawing lines)
    svg += `  <style>\n`;
    svg += `    .horizon { stroke: black; stroke-width: 2.0; fill: none; }\n`;
    svg += `    .constellation-line { stroke: #b0b0b0; stroke-width: 1.0; stroke-dasharray: 2,2; fill: none; }\n`;
    svg += `    .star { fill: black; stroke: none; }\n`;
    svg += `    .planet { fill: black; stroke: white; stroke-width: 2.0; }\n`;
    svg += `    .sun-body { fill: none; stroke: black; stroke-width: 2.0; }\n`;
    svg += `    .leader-line { stroke: black; stroke-width: 1.0; stroke-dasharray: 1,2; fill: none; }\n`;
    svg += `    .label { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: ${fontSize}px; fill: black; font-weight: bold; }\n`;
    svg += `    .label-bg { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: ${fontSize}px; fill: none; stroke: white; stroke-width: ${Math.max(4, fontSize * 0.2)}px; stroke-linejoin: round; font-weight: bold; }\n`;
    svg += `    .cardinal { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: ${fontSize}px; fill: #707070; font-weight: 400; }\n`;
    svg += `    .sky-bg { fill: white; }\n`;
    svg += `  </style>\n`;

    // Outer sky vault canvas background
    svg += `  <rect width="${width}" height="${height}" class="sky-bg" />\n`;

    // Projected Coordinate helper
    const project = (alt, az, radius = r) => {
      const altRad = alt * (Math.PI / 180);
      const azRad = az * (Math.PI / 180);
      const y = radius * Math.sin(altRad);
      const r_xz = radius * Math.cos(altRad);
      const x = r_xz * Math.sin(azRad);
      const z = -r_xz * Math.cos(azRad);

      // Rotate around Y axis (Yaw)
      const x1 = x * cosA - z * sinA;
      const z1 = x * sinA + z * cosA;
      
      // Rotate around X axis (Pitch)
      const y2 = y * cosB - z1 * sinB;
      const z2 = y * sinB + z1 * cosB;
      
      return {
        x: cx + x1,
        y: cy - y2,
        z: z2,
        r_ref: radius
      };
    };

    // 1. Draw Grid Lines (Horizon and altitude rings, meridians)
    svg += `  <!-- Grid & Horizon -->\n`;
    
    // Horizon boundary (altitude 0)
    let horizonPath = "";
    for (let az = 0; az <= 360; az += 5) {
      const pt = project(0, az);
      horizonPath += `${az === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)} `;
    }
    horizonPath += "Z";
    svg += `  <path d="${horizonPath}" class="horizon" />\n`;

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
              const starRadius = Math.max(0.8, 3.5 - 0.7 * mag);
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
    const obstacles = [];

    // Add all planet dots as obstacles so labels don't cover them
    Object.keys(planetPositions)
      .filter(p => p !== "Earth")
      .forEach(name => {
        const data = planetPositions[name];
        if (data.altitude >= 0) {
          const pt = project(data.altitude, data.azimuth);
          const depthNorm = Math.max(-1.5, Math.min(1.5, pt.z / r));
          const depthScale = 1.0 - 0.25 * depthNorm;
          const rSize = (name === "Sun" ? 22 : (name === "Moon" ? 18 : 14)) * depthScale;
          obstacles.push({
            x1: pt.x - rSize,
            y1: pt.y - rSize,
            x2: pt.x + rSize,
            y2: pt.y + rSize
          });
        }
      });

    const checkOverlap = (box) => {
      if (box.y1 < 4 || box.y2 > height - 4 || box.x1 < 4 || box.x2 > width - 4) {
        return true;
      }
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
          
          // Calculate a depth scale based on z-coordinate to give 3D perspective
          // North (front) has negative z, South (back) has positive z
          const depthNorm = Math.max(-1.5, Math.min(1.5, pt.z / r));
          const depthScale = 1.0 - 0.25 * depthNorm; // Range ~ [0.625, 1.375]

          if (name === "Sun") {
            svg += `  <g>\n`;
            svg += `    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(16 * depthScale).toFixed(1)}" class="sun-body" />\n`;
            svg += `    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(4 * depthScale).toFixed(1)}" fill="black" />\n`;
          } else if (name === "Moon") {
            svg += `  <g>\n`;
            svg += `    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(13 * depthScale).toFixed(1)}" class="planet" />\n`;
          } else {
            svg += `  <g>\n`;
            svg += `    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(10 * depthScale).toFixed(1)}" class="planet" />\n`;
          }

          // Determine label position without altitude (makes it cleaner)
          const labelText = name;
          const labelWidth = labelText.length * 18.0 * scaleFactor;
          const labelHeight = 36 * scaleFactor;
          const lxOffset = 18 * scaleFactor;
          const lyOffset = 4 * scaleFactor;
          let lx = px;
          let ly = py - 18 * scaleFactor;
          let anchor = "middle";
          let found = false;
          let finalBox = null;

          // Centered labels slide sideways to stay inside the frame near its edges
          const cx_label = Math.min(Math.max(px, labelWidth / 2 + 4), width - labelWidth / 2 - 4);

          // Try 4 directions: Top, Bottom, Right, Left
          const candidates = [
            { lx: cx_label, ly: py - 18 * scaleFactor, anchor: "middle", box: { x1: cx_label - labelWidth/2, y1: py - 18 * scaleFactor - labelHeight, x2: cx_label + labelWidth/2, y2: py - 18 * scaleFactor } },
            { lx: cx_label, ly: py + 26 * scaleFactor, anchor: "middle", box: { x1: cx_label - labelWidth/2, y1: py + 26 * scaleFactor, x2: cx_label + labelWidth/2, y2: py + 26 * scaleFactor + labelHeight } },
            { lx: px + lxOffset, ly: py + lyOffset, anchor: "start", box: { x1: px + lxOffset, y1: py + lyOffset - labelHeight/2, x2: px + lxOffset + labelWidth, y2: py + lyOffset + labelHeight/2 } },
            { lx: px - lxOffset, ly: py + lyOffset, anchor: "end", box: { x1: px - lxOffset - labelWidth, y1: py + lyOffset - labelHeight/2, x2: px - lxOffset, y2: py + lyOffset + labelHeight/2 } }
          ];

          for (const cand of candidates) {
            if (!checkOverlap(cand.box)) {
              lx = cand.lx;
              ly = cand.ly;
              anchor = cand.anchor;
              obstacles.push(cand.box);
              finalBox = cand.box;
              found = true;
              break;
            }
          }

          // Fallback: stack vertically if all directions are blocked
          if (!found) {
            let offset = 9 * scaleFactor;
            while (true) {
              const testBoxUp = { x1: cx_label - labelWidth/2, y1: py - offset - labelHeight, x2: cx_label + labelWidth/2, y2: py - offset };
              if (!checkOverlap(testBoxUp)) {
                lx = cx_label;
                ly = py - offset;
                anchor = "middle";
                obstacles.push(testBoxUp);
                finalBox = testBoxUp;
                break;
              }
              const testBoxDown = { x1: cx_label - labelWidth/2, y1: py + offset, x2: cx_label + labelWidth/2, y2: py + offset + labelHeight };
              if (!checkOverlap(testBoxDown)) {
                lx = cx_label;
                ly = py + offset + labelHeight * 0.8;
                anchor = "middle";
                obstacles.push(testBoxDown);
                finalBox = testBoxDown;
                break;
              }
              offset += 12 * scaleFactor;
              if (offset > 120 * scaleFactor) { // Safety limit
                lx = cx_label;
                ly = py - 9 * scaleFactor;
                anchor = "middle";
                finalBox = candidates[0].box;
                break;
              }
            }
          }

          if (finalBox) {
            const boxCenterX = (finalBox.x1 + finalBox.x2) / 2;
            const boxCenterY = (finalBox.y1 + finalBox.y2) / 2;
            const dist = Math.hypot(boxCenterX - px, boxCenterY - py);
            if (dist > 10 * scaleFactor) {
              svg += `    <line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${boxCenterX.toFixed(1)}" y2="${boxCenterY.toFixed(1)}" class="leader-line" />\n`;
            }
          }
          svg += `    <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="label-bg" text-anchor="${anchor}">${labelText}</text>\n`;
          svg += `    <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="label" text-anchor="${anchor}">${labelText}</text>\n`;
          svg += `  </g>\n`;
        }
      });

    // 5. Draw Cardinal Direction Markers
    const labelRadius = r + 15 * scaleFactor;
    const nPt = project(0, 0, labelRadius);
    const ePt = project(0, 90, labelRadius);
    const sPt = project(0, 180, labelRadius);
    const wPt = project(0, 270, labelRadius);

    svg += `  <!-- Cardinal Directions -->\n`;
    svg += `  <text x="${nPt.x.toFixed(1)}" y="${(nPt.y + 8 * scaleFactor).toFixed(1)}" class="cardinal" text-anchor="middle">N</text>\n`;
    svg += `  <text x="${ePt.x.toFixed(1)}" y="${(ePt.y + 8 * scaleFactor).toFixed(1)}" class="cardinal" text-anchor="middle">E</text>\n`;
    svg += `  <text x="${sPt.x.toFixed(1)}" y="${(sPt.y + 8 * scaleFactor).toFixed(1)}" class="cardinal" text-anchor="middle">S</text>\n`;
    svg += `  <text x="${wPt.x.toFixed(1)}" y="${(wPt.y + 8 * scaleFactor).toFixed(1)}" class="cardinal" text-anchor="middle">W</text>\n`;

    svg += `</svg>`;

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=600");
    res.send(svg);
  } catch (error) {
    console.error("Error in /sky.svg API:", error);
    res.status(500).send(`<svg><text x="10" y="20">Error: ${error.message}</text></svg>`);
  }
});
