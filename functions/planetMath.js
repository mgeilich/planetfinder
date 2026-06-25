export const PLANET_DATA = {
  Mercury: {
    rev_period: 87.98989325057869,
    base: {'a': 0.38709927, 'e': 0.20563593, 'w_bar': 77.45779628, 'i': 7.00497902, 'L': 252.2503235, 'W': 48.33076593},
    adj: {'a': 3.7e-07, 'e': 1.906e-05, 'i': -0.00594749, 'L': 149472.67411175, 'w_bar': 0.16047689, 'W': -0.12534091}
  },
  Venus: {
    rev_period: 224.70023735821758,
    base: {'a': 0.72333566, 'e': 0.00677672, 'w_bar': 131.60246718, 'i': 3.39467605, 'L': 181.9790995, 'W': 76.67984255},
    adj: {'a': 3.9e-06, 'e': -4.107e-05, 'i': -0.0007889, 'L': 58517.81538729, 'w_bar': 0.00268329, 'W': -0.27769418}
  },
  Earth: {
    rev_period: 365.256365740741,
    base: {'a': 1.00000261, 'e': 0.01671123, 'w_bar': 102.93768193, 'i': -1.531e-05, 'L': 100.46457166, 'W': 0.0},
    adj: {'a': 5.62e-06, 'e': -4.392e-05, 'i': -0.01294668, 'L': 35999.37244981, 'w_bar': 0.32327364, 'W': 0.0}
  },
  Mars: {
    rev_period: 686.9814778124999,
    base: {'a': 1.52371034, 'e': 0.0933941, 'w_bar': -23.94362959, 'i': 1.84969142, 'L': -4.55343205, 'W': 49.55953891},
    adj: {'a': 1.847e-05, 'e': 7.882e-05, 'i': -0.00813131, 'L': 19140.30268499, 'w_bar': 0.44441088, 'W': -0.29257343}
  },
  Jupiter: {
    rev_period: 4332.415330960648,
    base: {'a': 5.202887, 'e': 0.04838624, 'w_bar': 14.72847983, 'i': 1.30439695, 'L': 34.39644051, 'W': 100.47390909},
    adj: {'a': -0.00011607, 'e': -0.00013253, 'i': -0.00183714, 'L': 3034.74612775, 'w_bar': 0.21252668, 'W': 0.20469106}
  },
  Saturn: {
    rev_period: 10759.283714351852,
    base: {'a': 9.53667594, 'e': 0.05386179, 'w_bar': 92.59887831, 'i': 2.48599187, 'L': 49.95424423, 'W': 113.66242448},
    adj: {'a': -0.0012506, 'e': -0.00050991, 'i': 0.00193609, 'L': 1222.49362201, 'w_bar': -0.41897216, 'W': -0.28867794}
  },
  Uranus: {
    rev_period: 30684.49329878472,
    base: {'a': 19.18916464, 'e': 0.04725744, 'w_bar': 170.9542763, 'i': 0.77263783, 'L': 313.23810451, 'W': 74.01692503},
    adj: {'a': -0.00196176, 'e': -4.397e-05, 'i': -0.00242939, 'L': 428.48202785, 'w_bar': 0.40805281, 'W': 0.04240589}
  },
  Neptune: {
    rev_period: 60188.40497222221,
    base: {'a': 30.06992276, 'e': 0.00859048, 'w_bar': 44.96476227, 'i': 1.77004347, 'L': -55.12002969, 'W': 131.78422574},
    adj: {'a': 0.00026291, 'e': 5.105e-05, 'i': 0.00035372, 'L': 218.45945325, 'w_bar': -0.32241464, 'W': -0.00508664}
  },
};


export function calculateLST(date, lon) {
    const J2000 = new Date(Date.UTC(2000, 0, 1, 11, 58, 55, 816));
    const diffDays = (date - J2000) / (1000 * 60 * 60 * 24);
    const GST = 280.46061837 + 360.98564736629 * diffDays;
    let LST_deg = (GST + lon) % 360;
    if (LST_deg < 0) LST_deg += 360;
    return LST_deg;
}

export function convertRaDecToAltAz(RA_deg, decl_deg, lat_deg, LST_deg) {
    const lat_rad = lat_deg * Math.PI / 180;
    const decl_rad = decl_deg * Math.PI / 180;
    
    let HA_deg = LST_deg - RA_deg;
    const HA_rad = HA_deg * Math.PI / 180;
    
    const sin_alt = Math.sin(lat_rad) * Math.sin(decl_rad) + Math.cos(lat_rad) * Math.cos(decl_rad) * Math.cos(HA_rad);
    const alt_rad = Math.asin(sin_alt);
    const alt_deg = alt_rad * 180 / Math.PI;
    
    const cos_az = (Math.sin(decl_rad) - Math.sin(lat_rad) * sin_alt) / (Math.cos(lat_rad) * Math.cos(alt_rad));
    let az_rad = Math.acos(Math.max(-1, Math.min(1, cos_az))); // Clamp to [-1, 1] to avoid NaN
    let az_deg = az_rad * 180 / Math.PI;
    
    if (Math.sin(HA_rad) > 0) {
        az_deg = 360 - az_deg;
    }
    
    return { altitude: alt_deg, azimuth: az_deg };
}

export function calculatePlanetPositions(date, lat = 0, lon = 0) {
    const J2000 = new Date(Date.UTC(2000, 0, 1, 11, 58, 55, 816));
    const JD_2000 = 2451545.0;
    
    // Difference in days
    const diffDays = (date - J2000) / (1000 * 60 * 60 * 24);
    const T = diffDays / 36525.0;
    
    const results = {};
    
    for (const [planet, data] of Object.entries(PLANET_DATA)) {
        // Calculate current elements
        const a = data.base.a + data.adj.a * T;
        const e = data.base.e + data.adj.e * T;
        let i = data.base.i + data.adj.i * T;
        let L = data.base.L + data.adj.L * T;
        let w_bar = data.base.w_bar + data.adj.w_bar * T;
        let W = data.base.W + data.adj.W * T;
        
        // Convert to radians
        const rad = Math.PI / 180;
        i *= rad;
        L *= rad;
        w_bar *= rad;
        W *= rad;
        
        const w = w_bar - W;
        let M = L - w_bar;
        // Normalize M to [0, 2PI]
        M = M % (2 * Math.PI);
        if (M < 0) M += 2 * Math.PI;
        
        // Solve Kepler's equation: E = M + e * sin(E)
        let E = M + e * Math.sin(M);
        for (let iter = 0; iter < 10; iter++) {
            E = M + e * Math.sin(E);
        }
        
        // Heliocentric coordinates in orbital plane
        const x_prime = a * (Math.cos(E) - e);
        const y_prime = a * Math.sqrt(1 - e*e) * Math.sin(E);
        
        // Heliocentric ecliptic coordinates
        const xecl = x_prime * (Math.cos(w)*Math.cos(W) - Math.sin(w)*Math.sin(W)*Math.cos(i)) - y_prime * (Math.sin(w)*Math.cos(W) + Math.cos(w)*Math.sin(W)*Math.cos(i));
        const yecl = x_prime * (Math.cos(w)*Math.sin(W) + Math.sin(w)*Math.cos(W)*Math.cos(i)) - y_prime * (Math.sin(w)*Math.sin(W) - Math.cos(w)*Math.cos(W)*Math.cos(i));
        const zecl = x_prime * (Math.sin(w)*Math.sin(i)) + y_prime * (Math.cos(w)*Math.sin(i));
        
        results[planet] = { xecl, yecl, zecl, a, e, i, M, E };
    }
    
    // Obliquity of the ecliptic
    const obliq = 23.43928 * Math.PI / 180;
    
    // Equatorial coordinates
    for (const planet in results) {
        const { xecl, yecl, zecl } = results[planet];
        const xeq = xecl;
        const yeq = yecl * Math.cos(obliq) - zecl * Math.sin(obliq);
        const zeq = yecl * Math.sin(obliq) + zecl * Math.cos(obliq);
        results[planet].xeq = xeq;
        results[planet].yeq = yeq;
        results[planet].zeq = zeq;
    }
    
    // Geocentric coordinates and local horizon calculations
    const earth = results['Earth'];
    
    // Add Sun geocentric position (inverse of Earth heliocentric)
    results['Sun'] = {
        geocentric: {
            xgeo: -earth.xeq,
            ygeo: -earth.yeq,
            zgeo: -earth.zeq
        }
    };
    
    // Calculate Moon geocentric position using J2000.0 Keplerian elements
    const d = diffDays;
    let moon_L = (218.316 + 13.176396 * d) % 360;
    let moon_M = (115.366 + 13.064993 * d) % 360;
    let moon_N = (125.1228 - 0.0529538 * d) % 360;
    let moon_w_bar = (318.063 + 0.164357 * d) % 360;
    
    if (moon_L < 0) moon_L += 360;
    if (moon_M < 0) moon_M += 360;
    if (moon_N < 0) moon_N += 360;
    if (moon_w_bar < 0) moon_w_bar += 360;
    
    const rad = Math.PI / 180;
    const M_rad = moon_M * rad;
    const N_rad = moon_N * rad;
    const w_bar_rad = moon_w_bar * rad;
    const w_rad = w_bar_rad - N_rad; // Argument of perigee
    const moon_i = 5.1454 * rad;
    const moon_e = 0.054900;
    const moon_a = 0.00257; // in AU
    
    // Solve Kepler's Equation for the Moon
    let moon_E = M_rad + moon_e * Math.sin(M_rad);
    for (let iter = 0; iter < 10; iter++) {
        moon_E = M_rad + moon_e * Math.sin(moon_E);
    }
    
    const moon_x_prime = moon_a * (Math.cos(moon_E) - moon_e);
    const moon_y_prime = moon_a * Math.sqrt(1 - moon_e*moon_e) * Math.sin(moon_E);
    
    const moon_xecl = moon_x_prime * (Math.cos(w_rad)*Math.cos(N_rad) - Math.sin(w_rad)*Math.sin(N_rad)*Math.cos(moon_i)) - moon_y_prime * (Math.sin(w_rad)*Math.cos(N_rad) + Math.cos(w_rad)*Math.sin(N_rad)*Math.cos(moon_i));
    const moon_yecl = moon_x_prime * (Math.cos(w_rad)*Math.sin(N_rad) + Math.sin(w_rad)*Math.cos(N_rad)*Math.cos(moon_i)) - moon_y_prime * (Math.sin(w_rad)*Math.sin(N_rad) - Math.cos(w_rad)*Math.cos(N_rad)*Math.cos(moon_i));
    const moon_zecl = moon_x_prime * (Math.sin(w_rad)*Math.sin(moon_i)) + moon_y_prime * (Math.cos(w_rad)*Math.sin(moon_i));
    
    const obliq2 = 23.43928 * rad;
    const moon_xeq = moon_xecl;
    const moon_yeq = moon_yecl * Math.cos(obliq2) - moon_zecl * Math.sin(obliq2);
    const moon_zeq = moon_yecl * Math.sin(obliq2) + moon_zecl * Math.cos(obliq2);
    
    results['Moon'] = {
        geocentric: {
            xgeo: moon_xeq,
            ygeo: moon_yeq,
            zgeo: moon_zeq
        }
    };
    
    // Calculate Local Sidereal Time (LST)
    const LST_deg = calculateLST(date, lon);

    for (const planet in results) {
        if (planet === 'Earth') continue;
        
        let xgeo, ygeo, zgeo;
        if (planet === 'Sun') {
            xgeo = results['Sun'].geocentric.xgeo;
            ygeo = results['Sun'].geocentric.ygeo;
            zgeo = results['Sun'].geocentric.zgeo;
        } else if (planet === 'Moon') {
            xgeo = results['Moon'].geocentric.xgeo;
            ygeo = results['Moon'].geocentric.ygeo;
            zgeo = results['Moon'].geocentric.zgeo;
        } else {
            xgeo = results[planet].xeq - earth.xeq;
            ygeo = results[planet].yeq - earth.yeq;
            zgeo = results[planet].zeq - earth.zeq;
            results[planet].geocentric = { xgeo, ygeo, zgeo };
        }
        
        // Right Ascension and Declination
        let RA = Math.atan2(ygeo, xgeo);
        if (RA < 0) RA += 2 * Math.PI;
        const RA_hours = RA * 24 / (2 * Math.PI);
        const RA_deg = RA_hours * 15;
        
        const decl = Math.atan2(zgeo, Math.sqrt(xgeo*xgeo + ygeo*ygeo));
        const decl_deg = decl * 180 / Math.PI;
        
        results[planet].RA_hours = RA_hours;
        results[planet].decl_deg = decl_deg;

        // Altitude and Azimuth calculations
        const { altitude, azimuth } = convertRaDecToAltAz(RA_deg, decl_deg, lat, LST_deg);
        results[planet].altitude = altitude;
        results[planet].azimuth = azimuth;
    }
    
    // Calculate Sky Map coordinates
    const sunRA = results['Sun'] ? results['Sun'].RA_hours * 15 : 0;
    // Fractional day from Julian Date (diffDays + 2451545.0)
    // Note: diffDays = (date - J2000) / ms_per_day. J2000 is noon, so diffDays is exact.
    // Excel used B41 - ROUNDDOWN(B41, 0) which is just the fractional part of the current date.
    // For a JavaScript Date object, we can just use the local time fraction or UTC time fraction.
    // Since the original spreadsheet used local time (NOW()), we'll use local time fraction.
    const timeOfDay = (date.getHours() + date.getMinutes()/60 + date.getSeconds()/3600) / 24.0;
    const easternHorizonRaw = sunRA + 360 * (timeOfDay - 0.25);
    
    // Normalize Eastern Horizon to 0-360
    let easternHorizon = easternHorizonRaw % 360;
    if (easternHorizon < 0) easternHorizon += 360;

    for (const planet in results) {
        if (planet === 'Earth') continue;
        
        const planetRA = results[planet].RA_hours * 15;
        let diff = easternHorizon - planetRA;
        
        // Wrap difference to -180 to 180
        diff = ((diff + 180) % 360 + 360) % 360 - 180;
        
        // Calculate X and Y coordinates for the map (-1 to 1)
        const rad = diff * Math.PI / 180;
        results[planet].mapX = Math.cos(rad);
        results[planet].mapY = Math.sin(rad);
    }

    return results;
}
