import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars, Text, useTexture, Billboard } from '@react-three/drei';
import { calculateLST, convertRaDecToAltAz } from './planetMath';
import './ThreeDView.css';

const getImageSrc = (planet) => {
  const jpgPlanets = ['Venus', 'Mars', 'Jupiter', 'Saturn', 'Sun'];
  if (jpgPlanets.includes(planet)) {
    return `/planets/${planet}.jpg`;
  }
  return `/planets/${planet}.png`;
};

function ZoomHandler() {
  const camera = useThree((state) => state.camera);
  
  useEffect(() => {
    const handleWheel = (e) => {
      e.preventDefault();
      // Prevent zooming out too far or in too much
      const newFov = Math.max(20, Math.min(100, camera.fov + e.deltaY * 0.05));
      camera.fov = newFov;
      camera.updateProjectionMatrix();
    };
    
    // Add event listener to the canvas element specifically
    const canvas = camera.el || document.querySelector('canvas');
    if (canvas) {
      canvas.addEventListener('wheel', handleWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', handleWheel);
    } else {
      window.addEventListener('wheel', handleWheel, { passive: false });
      return () => window.removeEventListener('wheel', handleWheel);
    }
  }, [camera]);
  
  return null;
}

function CameraController({ planetData, focusPlanets }) {
  const { camera } = useThree();
  
  useEffect(() => {
    if (!focusPlanets || focusPlanets.length === 0 || !planetData) return;
    
    let minAz = Infinity, maxAz = -Infinity;
    let minAlt = Infinity, maxAlt = -Infinity;
    let validPlanets = 0;
    
    focusPlanets.forEach(p => {
       const data = planetData[p];
       if (data && data.altitude !== undefined && data.altitude > -5) {
          minAz = Math.min(minAz, data.azimuth);
          maxAz = Math.max(maxAz, data.azimuth);
          minAlt = Math.min(minAlt, data.altitude);
          maxAlt = Math.max(maxAlt, data.altitude);
          validPlanets++;
       }
    });
    
    if (validPlanets === 0) return;
    
    // Handle Azimuth wrapping around 360/0.
    // If the spread is greater than 180, it means the planets wrap around North.
    let spreadAz = maxAz - minAz;
    let centerAz = (minAz + maxAz) / 2;
    if (spreadAz > 180) {
       // Adjust for wrapping
       let adjustedMin = Infinity, adjustedMax = -Infinity;
       focusPlanets.forEach(p => {
          const data = planetData[p];
          if (data && data.altitude !== undefined && data.altitude > -5) {
             let az = data.azimuth;
             if (az < 180) az += 360;
             adjustedMin = Math.min(adjustedMin, az);
             adjustedMax = Math.max(adjustedMax, az);
          }
       });
       spreadAz = adjustedMax - adjustedMin;
       centerAz = ((adjustedMin + adjustedMax) / 2) % 360;
    }
    
    const azRad = centerAz * (Math.PI / 180);
    
    // Radius of camera from origin
    const r = 0.086;
    const camX = -r * Math.sin(azRad);
    const camZ = r * Math.cos(azRad);
    
    camera.position.set(camX, -0.05, camZ);
    camera.lookAt(0, 0, 0);
    
    const spreadAlt = maxAlt - minAlt;
    const maxSpread = Math.max(spreadAz, spreadAlt);
    
    // Calculate new FOV with padding
    let newFov = maxSpread + 25; 
    newFov = Math.max(30, Math.min(100, newFov));
    
    camera.fov = newFov;
    camera.updateProjectionMatrix();
    
  }, [focusPlanets, planetData, camera]);
  
  return null;
}

// A single planet mesh for the sky view
function SkyPlanet({ name, altitude, azimuth, radius = 50, isDaytime }) {
  const textureUrl = getImageSrc(name);
  const texture = useTexture(textureUrl);
  const meshRef = useRef();
  
  // Convert Altitude and Azimuth to 3D coordinates
  // Azimuth: 0 = North (-Z), 90 = East (+X), 180 = South (+Z), 270 = West (-X)
  // Altitude: 0 = Horizon, 90 = Zenith (+Y)
  const altRad = altitude * (Math.PI / 180);
  const azRad = azimuth * (Math.PI / 180);
  
  const y = radius * Math.sin(altRad);
  const r_xz = radius * Math.cos(altRad);
  const x = r_xz * Math.sin(azRad);
  const z = -r_xz * Math.cos(azRad);

  // Scale planets to be visible from afar. The Sun and Moon would appear larger.
  let scale = 1.0;
  if (name === 'Sun' || name === 'Moon') scale = 2.0;

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.01;
    }
  });

  return (
    <group position={[x, y, z]}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[scale, 32, 32]} />
        {name === 'Sun' ? (
          <meshBasicMaterial map={texture} color="#fff" />
        ) : (
          <meshStandardMaterial map={texture} />
        )}
      </mesh>
      
      {/* Label */}
      <Billboard follow={true} lockX={false} lockY={false} lockZ={false}>
        <Text
          position={[0, scale + 1.5, 0]}
          fontSize={1.5}
          color={isDaytime ? "#000000" : "#ffffff"}
          anchorX="center"
          anchorY="middle"
          outlineWidth={isDaytime ? 0 : 0.1}
          outlineColor="#000"
          fontWeight={isDaytime ? "bold" : "normal"}
        >
          {name}
        </Text>
      </Billboard>
    </group>
  );
}

function GroundAndCompass({ radius = 50 }) {
  return (
    <group>
      {/* Ground Plane */}
      <mesh position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0, radius * 2, 64]} />
        <meshBasicMaterial color="#081018" />
      </mesh>
      
      {/* Ground Cylinder for thickness */}
      <mesh position={[0, -5.1, 0]}>
        <cylinderGeometry args={[radius * 2, radius * 2, 10, 64]} />
        <meshBasicMaterial color="#050a0f" />
      </mesh>

      {/* Compass Markers */}
      <Billboard position={[0, 1, -radius + 2]}>
        <Text fontSize={3} color="#ef4444" outlineWidth={0.2} outlineColor="#000">N</Text>
      </Billboard>
      <Billboard position={[radius - 2, 1, 0]}>
        <Text fontSize={3} color="#88aadd" outlineWidth={0.2} outlineColor="#000">E</Text>
      </Billboard>
      <Billboard position={[0, 1, radius - 2]}>
        <Text fontSize={3} color="#88aadd" outlineWidth={0.2} outlineColor="#000">S</Text>
      </Billboard>
      <Billboard position={[-radius + 2, 1, 0]}>
        <Text fontSize={3} color="#88aadd" outlineWidth={0.2} outlineColor="#000">W</Text>
      </Billboard>
      
      {/* Horizon Line Grid (Optional) */}
      <gridHelper args={[radius * 2, 20, '#ffffff', '#ffffff']} position={[0, 0, 0]} material-opacity={0.1} material-transparent />
    </group>
  );
}

const CONSTELLATION_NAMES = {
  And: "Andromeda", Ant: "Antlia", Aps: "Apus", Aqr: "Aquarius", Aql: "Aquila",
  Ara: "Ara", Ari: "Aries", Aur: "Auriga", Boo: "Boötes", Cae: "Caelum",
  Cam: "Camelopardalis", Cnc: "Cancer", CVn: "Canes Venatici", CMa: "Canis Major",
  CMi: "Canis Minor", Cap: "Capricornus", Car: "Carina", Cas: "Cassiopeia",
  Cen: "Centaurus", Cep: "Cepheus", Cet: "Cetus", Cha: "Chamaeleon", Cir: "Circinus",
  Col: "Columba", Com: "Coma Berenices", CrA: "Corona Australis", CrB: "Corona Borealis",
  Crv: "Corvus", Crt: "Crater", Cru: "Crux", Cyg: "Cygnus", Del: "Delphinus",
  Dor: "Dorado", Dra: "Draco", Equ: "Equuleus", Eri: "Eridanus", For: "Fornax",
  Gem: "Gemini", Gru: "Grus", Her: "Hercules", Hor: "Horologium", Hya: "Hydra",
  Hyi: "Hydrus", Ind: "Indus", Lac: "Lacerta", Leo: "Leo", LMi: "Leo Minor",
  Lep: "Lepus", Lib: "Libra", Lup: "Lupus", Lyn: "Lynx", Lyr: "Lyra",
  Men: "Mensa", Mic: "Microscopium", Mon: "Monoceros", Mus: "Musca", Nor: "Norma",
  Oct: "Octans", Oph: "Ophiuchus", Ori: "Orion", Pav: "Pavo", Peg: "Pegasus",
  Per: "Perseus", Phe: "Phoenix", Pic: "Pictor", Psc: "Pisces", PsA: "Piscis Austrinus",
  Pup: "Puppis", Pyx: "Pyxis", Ret: "Reticulum", Sge: "Sagitta", Sgr: "Sagittarius",
  Sco: "Scorpius", Scl: "Sculptor", Sct: "Scutum", Ser: "Serpens", Sex: "Sextans",
  Tau: "Taurus", Tel: "Telescopium", Tri: "Triangulum", TrA: "Triangulum Australe",
  Tuc: "Tucana", UMa: "Ursa Major", UMi: "Ursa Minor", Vel: "Vela", Vir: "Virgo",
  Vol: "Volans", Vul: "Vulpecula"
};

function ConstellationOverlay({ date, lat, lon, isDaytime }) {
  const [starsData, setStarsData] = useState(null);
  const [linesData, setLinesData] = useState(null);

  useEffect(() => {
    fetch('/data/stars.6.json').then(r => r.json()).then(setStarsData).catch(e => console.error("Error loading stars:", e));
    fetch('/data/constellations.lines.json').then(r => r.json()).then(setLinesData).catch(e => console.error("Error loading lines:", e));
  }, []);

  const { starPoints, starColors, linePoints, labels } = useMemo(() => {
    if (!starsData || !linesData || !date) return { starPoints: null, starColors: null, linePoints: null, labels: null };
    
    const latitude = parseFloat(lat) || 0;
    const longitude = parseFloat(lon) || 0;
    const LST_deg = calculateLST(date, longitude);
    const radius = 50;
    
    const sPoints = [];
    const colors = [];
    
    starsData.features.forEach(feature => {
      const ra = feature.geometry.coordinates[0];
      const dec = feature.geometry.coordinates[1];
      const mag = feature.properties.mag;
      
      const { altitude, azimuth } = convertRaDecToAltAz(ra, dec, latitude, LST_deg);
      if (altitude < -5) return; 
      
      const altRad = altitude * (Math.PI / 180);
      const azRad = azimuth * (Math.PI / 180);
      
      const y = radius * Math.sin(altRad);
      const r_xz = radius * Math.cos(altRad);
      const x = r_xz * Math.sin(azRad);
      const z = -r_xz * Math.cos(azRad);
      
      sPoints.push(x, y, z);
      
      const brightness = Math.max(0.1, 1 - (mag / 6));
      colors.push(brightness, brightness, brightness);
    });
    
    const lPoints = [];
    const constelLabels = [];

    linesData.features.forEach(feature => {
      let sumX = 0, sumY = 0, sumZ = 0;
      let pointCount = 0;
      let anyAboveHorizon = false;

      feature.geometry.coordinates.forEach(lineString => {
         for (let i = 0; i < lineString.length - 1; i++) {
           const [ra1, dec1] = lineString[i];
           const [ra2, dec2] = lineString[i+1];
           
           const pos1 = convertRaDecToAltAz(ra1, dec1, latitude, LST_deg);
           const pos2 = convertRaDecToAltAz(ra2, dec2, latitude, LST_deg);
           
           if (pos1.altitude >= -5 || pos2.altitude >= -5) {
             anyAboveHorizon = true;
           }
           
           if (pos1.altitude < -5 && pos2.altitude < -5) continue;
           
           const altRad1 = pos1.altitude * (Math.PI / 180);
           const azRad1 = pos1.azimuth * (Math.PI / 180);
           const y1 = radius * Math.sin(altRad1);
           const r_xz1 = radius * Math.cos(altRad1);
           const x1 = r_xz1 * Math.sin(azRad1);
           const z1 = -r_xz1 * Math.cos(azRad1);
           
           const altRad2 = pos2.altitude * (Math.PI / 180);
           const azRad2 = pos2.azimuth * (Math.PI / 180);
           const y2 = radius * Math.sin(altRad2);
           const r_xz2 = radius * Math.cos(altRad2);
           const x2 = r_xz2 * Math.sin(azRad2);
           const z2 = -r_xz2 * Math.cos(azRad2);
           
           lPoints.push(x1, y1, z1, x2, y2, z2);

           sumX += x1 + x2;
           sumY += y1 + y2;
           sumZ += z1 + z2;
           pointCount += 2;
         }
      });

      if (anyAboveHorizon && pointCount > 0) {
        let cx = sumX / pointCount;
        let cy = sumY / pointCount;
        let cz = sumZ / pointCount;
        
        const mag = Math.sqrt(cx*cx + cy*cy + cz*cz);
        const labelRadius = 50; 
        cx = (cx / mag) * labelRadius;
        cy = (cy / mag) * labelRadius;
        cz = (cz / mag) * labelRadius;
        
        const name = CONSTELLATION_NAMES[feature.id] || feature.id;
        constelLabels.push({ id: feature.id, name, position: [cx, cy, cz] });
      }
    });
    
    return { 
      starPoints: new Float32Array(sPoints), 
      starColors: new Float32Array(colors),
      linePoints: new Float32Array(lPoints),
      labels: constelLabels
    };
  }, [starsData, linesData, date, lat, lon]);

  if (!starPoints) return null;

  return (
    <group>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={starPoints.length / 3} array={starPoints} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={starColors.length / 3} array={starColors} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={0.3} vertexColors={true} transparent opacity={0.8} />
      </points>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={linePoints.length / 3} array={linePoints} itemSize={3} />
        </bufferGeometry>
        <lineBasicMaterial color={isDaytime ? "#ffffff" : "#ffffff"} transparent opacity={isDaytime ? 0.7 : 0.3} />
      </lineSegments>
      {labels && labels.map(lbl => (
        <Billboard key={lbl.id} position={lbl.position}>
          <Text
            fontSize={1.2}
            color={isDaytime ? "#000000" : "#aaddff"}
            outlineWidth={isDaytime ? 0 : 0.15}
            outlineColor="#000000"
            fontWeight={isDaytime ? "bold" : "normal"}
            anchorX="center"
            anchorY="middle"
            fillOpacity={isDaytime ? 1 : 0.8}
          >
            {lbl.name}
          </Text>
        </Billboard>
      ))}
    </group>
  );
}

const LocalSkyView = ({ planetData, focusPlanets, latitude, longitude, date }) => {
  const [showConstellations, setShowConstellations] = useState(false);
  
  const planetsList = Object.keys(planetData).filter(p => p !== 'Earth');
  const sunData = planetData['Sun'];
  const isDaytime = sunData && sunData.altitude > 0;

  return (
    <div className="threed-view-container" style={{ borderRadius: '12px', overflow: 'hidden', height: '600px', border: '1px solid rgba(255,255,255,0.1)', position: 'relative' }}>
      {/* 
        Positioning the camera at a negative Y value (-0.05) makes it look UP towards the target [0,0,0].
        This pushes the horizon line lower on the screen by default to show more sky. 
      */}
      <Canvas camera={{ position: [0, -0.05, 0.086], fov: 60 }}>
        {/* Dynamic Background Color */}
        <color attach="background" args={[isDaytime ? '#4fa3d1' : '#020408']} />
        
        {/* Starry Sky - only visible at night */}
        {!isDaytime && !showConstellations && (
          <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
        )}

        {showConstellations && (
          <ConstellationOverlay date={date} lat={latitude} lon={longitude} isDaytime={isDaytime} />
        )}
        
        {/* Lighting changes based on daytime */}
        <ambientLight intensity={isDaytime ? 0.8 : 0.6} />
        {isDaytime ? (
          <directionalLight position={[0, 50, 0]} intensity={1.5} />
        ) : (
          <directionalLight position={[0, 50, 0]} intensity={1.0} />
        )}

        {/* OrbitControls for Looking Around */}
        <OrbitControls 
          target={[0, 0, 0]} 
          enableZoom={false} 
          enablePan={false}
          rotateSpeed={-0.5} // Invert rotation so dragging left moves view left
          enableDamping={true}
          dampingFactor={0.05}
          minPolarAngle={Math.PI / 2} // Restrict panning so camera doesn't go below horizon
          maxPolarAngle={Math.PI}
        />
        
        <ZoomHandler />
        <CameraController planetData={planetData} focusPlanets={focusPlanets} />

        <GroundAndCompass radius={50} />

        {planetsList.map(planet => {
          const data = planetData[planet];
          if (!data || data.altitude === undefined) return null;
          
          // Only show planets above or slightly below the horizon (atmospheric refraction / size)
          // We render them even if slightly below so they 'set' smoothly behind the ground plane
          if (data.altitude < -5) return null;

          return (
            <SkyPlanet 
              key={planet} 
              name={planet} 
              altitude={data.altitude} 
              azimuth={data.azimuth} 
              radius={50} 
              isDaytime={isDaytime}
            />
          );
        })}
      </Canvas>
      <div className="threed-overlay-text">
        <p>Use mouse to drag and look around. Scroll to zoom.</p>
      </div>
      
      <div className="constellation-toggle" style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.5)', padding: '10px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', zIndex: 10 }}>
        <input 
          type="checkbox" 
          id="toggleConstellations" 
          checked={showConstellations} 
          onChange={(e) => setShowConstellations(e.target.checked)} 
          style={{ cursor: 'pointer' }}
        />
        <label htmlFor="toggleConstellations" style={{ color: 'white', cursor: 'pointer', fontSize: '14px' }}>
          Constellations
        </label>
      </div>
    </div>
  );
};

export default LocalSkyView;
