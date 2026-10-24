import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars, Text, useTexture, Billboard } from '@react-three/drei';

const getImageSrc = (planet) => {
  const jpgPlanets = ['Venus', 'Mars', 'Jupiter', 'Saturn', 'Sun'];
  if (jpgPlanets.includes(planet)) {
    return `/planets/${planet}.jpg`;
  }
  return `/planets/${planet}.png`;
};

// A single planet mesh
function Planet({ name, position, scale = 1 }) {
  const textureUrl = getImageSrc(name);
  const texture = useTexture(textureUrl);
  const meshRef = useRef();
  
  // Slowly rotate planets
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.01;
    }
  });

  return (
    <group position={position}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[scale, 32, 32]} />
        {/* We use MeshStandardMaterial for lighting response, but MeshBasicMaterial is good if we want them to glow */}
        {name === 'Sun' ? (
          <meshBasicMaterial map={texture} />
        ) : (
          <meshStandardMaterial map={texture} />
        )}
      </mesh>
      <Billboard follow={true} lockX={false} lockY={false} lockZ={false}>
        <Text
          position={[0, scale + 0.5, 0]}
          fontSize={0.8}
          color="white"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.05}
          outlineColor="#000"
        >
          {name}
        </Text>
      </Billboard>
    </group>
  );
}

// Preload textures
const preloadTextures = () => {
  const planets = ['Sun', 'Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
  planets.forEach(p => useTexture.preload(getImageSrc(p)));
};

function SolarSystemGroup({ planetData }) {
  return (
    <group>
      {/* Sun at center */}
      <Planet name="Sun" position={[0, 0, 0]} scale={1.5} />
      {/* Point light from the Sun */}
      <pointLight position={[0, 0, 0]} intensity={2.0} color="#ffffff" distance={200} />
      <ambientLight intensity={0.1} />

      {Object.keys(planetData).map(planet => {
        const data = planetData[planet];
        if (!data || planet === 'Sun') return null;
        
        // Scale AU to units (e.g. 1 AU = 3 units)
        // Heliocentric coords: xecl, yecl, zecl
        const x = data.xecl * 3;
        const z = -data.yecl * 3;
        const y = data.zecl * 3;
        
        return <Planet key={planet} name={planet} position={[x, y, z]} scale={0.5} />;
      })}
    </group>
  );
}

function CelestialSphereGroup({ planetData }) {
  return (
    <group>
      <ambientLight intensity={1.0} />
      
      {/* Earth at center */}
      <Planet name="Earth" position={[0, 0, 0]} scale={1} />

      {Object.keys(planetData).map(planet => {
        if (planet === 'Earth') return null;
        const data = planetData[planet];
        if (!data || !data.geocentric) return null;
        
        // Use geocentric equatorial coords
        const { xgeo, ygeo, zgeo } = data.geocentric;
        const dist = Math.sqrt(xgeo*xgeo + ygeo*ygeo + zgeo*zgeo);
        
        // Normalize and place on a sphere of radius 15
        const R = 15;
        const x = (xgeo / dist) * R;
        const z = (-ygeo / dist) * R;
        const y = (zgeo / dist) * R;
        
        return <Planet key={planet} name={planet} position={[x, y, z]} scale={0.6} />;
      })}
    </group>
  );
}

function ViewCamera({ viewType }) {
  const { camera } = useThree();
  React.useEffect(() => {
    if (viewType === '3D-SolarSystem') {
      camera.position.set(0, 10, 20);
    } else {
      camera.position.set(0, 0, 35);
    }
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [viewType, camera]);
  return null;
}

export default function ThreeDView({ planetData, viewType }) {
  if (!planetData || Object.keys(planetData).length === 0) return null;
  
  // Trigger preload immediately
  try { preloadTextures(); } catch(e) {}

  return (
    <div className="threed-view-container">
      <Canvas camera={{ position: [0, 10, 20], fov: 60 }}>
        <color attach="background" args={['#050510']} />
        <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
        
        <ViewCamera viewType={viewType} />
        <OrbitControls makeDefault />
        
        {viewType === '3D-SolarSystem' ? (
          <SolarSystemGroup planetData={planetData} />
        ) : (
          <CelestialSphereGroup planetData={planetData} />
        )}
      </Canvas>
      <div className="threed-overlay-text">
        <p>Use mouse to drag, rotate, and zoom.</p>
      </div>
    </div>
  );
}
