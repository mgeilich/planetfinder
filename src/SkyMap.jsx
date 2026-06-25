import { useMemo } from 'react';
import './SkyMap.css';

const getImageSrc = (planet) => {
  const jpgPlanets = ['Venus', 'Mars', 'Jupiter', 'Saturn', 'Sun'];
  if (jpgPlanets.includes(planet)) {
    return `/planets/${planet}.jpg`;
  }
  return `/planets/${planet}.png`;
};

function SkyMap({ planetData }) {
  const positionedPlanets = useMemo(() => {
    if (!planetData || Object.keys(planetData).length === 0) return [];
    
    const planets = Object.keys(planetData)
      .filter(planet => planet !== 'Earth')
      .map(planet => {
        const data = planetData[planet];
        if (!data || data.mapX === undefined || data.mapY === undefined) return null;
        
        // Direction unit vector from the center (50, 50)
        const ux = data.mapX;
        const uy = -data.mapY;
        const R = 41; // Start at outer boundary (R = 41%)
        
        return {
          name: planet,
          ux,
          uy,
          x: 50 + R * ux,
          y: 50 + R * uy,
          r: R
        };
      })
      .filter(Boolean);

    const minDistance = 12.0; // in percent (equivalent to 48px on a 400px map)
    const earthMinDistance = 11.0; // avoid overlapping with central Earth label
    
    // Perform relaxation to separate nearby planets radially
    for (let iter = 0; iter < 100; iter++) {
      // 1. Repulsion between planet nodes
      for (let i = 0; i < planets.length; i++) {
        for (let j = i + 1; j < planets.length; j++) {
          const dx = planets[i].x - planets[j].x;
          const dy = planets[i].y - planets[j].y;
          let dist = Math.sqrt(dx*dx + dy*dy);
          
          if (dist < 0.001) {
            // Seed a small difference if they are identical
            planets[i].x += 0.01;
            dist = 0.01;
          }
          
          if (dist < minDistance) {
            const force = (minDistance - dist) / 2;
            const pushX = ((planets[i].x - planets[j].x) / dist) * force;
            const pushY = ((planets[i].y - planets[j].y) / dist) * force;
            
            planets[i].x += pushX;
            planets[i].y += pushY;
            planets[j].x -= pushX;
            planets[j].y -= pushY;
          }
        }
      }
      
      // 2. Repulsion from Earth (center)
      for (let i = 0; i < planets.length; i++) {
        const dx = planets[i].x - 50;
        const dy = planets[i].y - 50;
        const dist = Math.sqrt(dx*dx + dy*dy) || 0.001;
        if (dist < earthMinDistance) {
          const force = earthMinDistance - dist;
          planets[i].x += (dx / dist) * force;
          planets[i].y += (dy / dist) * force;
        }
      }
      
      // 3. Keep within outer map boundary (R <= 41)
      for (let i = 0; i < planets.length; i++) {
        const dx = planets[i].x - 50;
        const dy = planets[i].y - 50;
        const dist = Math.sqrt(dx*dx + dy*dy) || 0.001;
        if (dist > 41) {
          planets[i].x = 50 + (dx / dist) * 41;
          planets[i].y = 50 + (dy / dist) * 41;
        }
      }
      
      // 4. Force radial constraint: project back onto the radial line
      for (let i = 0; i < planets.length; i++) {
        const p = planets[i];
        const dx = p.x - 50;
        const dy = p.y - 50;
        // Project onto radial unit vector
        let R = dx * p.ux + dy * p.uy;
        
        // Clamp radius to stay within allowed ring region [earthMinDistance, 41]
        if (R < earthMinDistance) {
          R = earthMinDistance;
        }
        if (R > 41) {
          R = 41;
        }
        
        p.r = R;
        p.x = 50 + R * p.ux;
        p.y = 50 + R * p.uy;
      }
    }
    
    return planets;
  }, [planetData]);

  if (!planetData || Object.keys(planetData).length === 0) return null;

  return (
    <div className="sky-map-container">
      <div className="sky-map">
        <div className="horizon-line horizontal"></div>
        <div className="horizon-line vertical"></div>
        <div className="sky-map-center">Earth</div>
        
        {/* Connector lines for radially displaced planets */}
        <svg className="sky-map-connectors-svg" style={{
          position: 'absolute',
          top: 0, left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 5
        }}>
          {positionedPlanets.map(p => {
            if (p.r < 38) {
              return (
                <line 
                  key={`line-${p.name}`}
                  x1={`${50 + 41 * p.ux}%`} 
                  y1={`${50 + 41 * p.uy}%`} 
                  x2={`${p.x}%`} 
                  y2={`${p.y}%`}
                  stroke="rgba(255, 255, 255, 0.25)"
                  strokeWidth="1"
                  strokeDasharray="3,3"
                />
              );
            }
            return null;
          })}
        </svg>

        {positionedPlanets.map(p => {
          return (
            <div 
              key={p.name} 
              className="sky-map-planet"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`
              }}
              title={p.name}
            >
              <div 
                className="sky-map-icon" 
                style={{backgroundImage: `url(${getImageSrc(p.name)})`}}
              ></div>
              <span className="sky-map-label">{p.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SkyMap;
