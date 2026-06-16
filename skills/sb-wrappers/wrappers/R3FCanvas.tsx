/**
 * R3FCanvas — react-three-fiber wrapper with auto GL cleanup.
 *
 * Wraps `@react-three/fiber`'s Canvas. Handles canvas sizing, camera defaults,
 * optional OrbitControls. When `vrtSafe` is set, switches to demand frameloop
 * (caller wires `invalidate` via useFrame in the scene to drive snapshots).
 *
 * REQUIRES: `@react-three/fiber`, optionally `@react-three/drei` for controls.
 * If those aren't installed, this wrapper renders a placeholder warning.
 *
 * @example
 * <R3FCanvas camera={{ position: [0, 0, 5] }} controls={['orbit']}>
 *   <ambientLight intensity={0.6} />
 *   <directionalLight position={[5, 5, 5]} />
 *   <mesh>
 *     <boxGeometry args={[1, 1, 1]} />
 *     <meshStandardMaterial color="hotpink" />
 *   </mesh>
 * </R3FCanvas>
 *
 * Storybook-only — never imported from app code.
 */
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';

type R3FCanvasComponent = ComponentType<{
  camera?: { position?: [number, number, number]; fov?: number };
  frameloop?: 'always' | 'demand' | 'never';
  children?: ReactNode;
  style?: React.CSSProperties;
}>;
type OrbitControlsComponent = ComponentType<Record<string, unknown>>;

interface R3FModules {
  Canvas: R3FCanvasComponent;
  OrbitControls: OrbitControlsComponent | null;
}

let cachedModules: R3FModules | null = null;
let loadPromise: Promise<R3FModules | null> | null = null;

async function loadR3F(): Promise<R3FModules | null> {
  if (cachedModules) return cachedModules;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const fiber = (await import(/* @vite-ignore */ '@react-three/fiber')) as { Canvas: R3FCanvasComponent };
      let orbit: OrbitControlsComponent | null = null;
      try {
        const drei = (await import(/* @vite-ignore */ '@react-three/drei')) as { OrbitControls: OrbitControlsComponent };
        orbit = drei.OrbitControls;
      } catch {
        // OrbitControls is optional
      }
      cachedModules = { Canvas: fiber.Canvas, OrbitControls: orbit };
      return cachedModules;
    } catch (err) {
      console.error('[R3FCanvas] @react-three/fiber not installed. Run: npm install @react-three/fiber three');
      return null;
    }
  })();

  return loadPromise;
}

export interface R3FCanvasProps {
  camera?: { position?: [number, number, number]; fov?: number };
  /** Built-in controls: 'orbit' adds OrbitControls (requires @react-three/drei) */
  controls?: Array<'orbit'>;
  /** When true, switches to demand frameloop (snapshot after settling) */
  vrtSafe?: boolean;
  height?: number | string;
  children?: ReactNode;
}

export function R3FCanvas({
  camera = { position: [0, 0, 5] },
  controls = [],
  vrtSafe = false,
  height = 280,
  children,
}: R3FCanvasProps): JSX.Element {
  const [mods, setMods] = useState<R3FModules | null>(cachedModules);

  useEffect(() => {
    if (cachedModules) return;
    let mounted = true;
    loadR3F().then((m) => {
      if (mounted) setMods(m);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!mods) {
    return (
      <div
        style={{
          width: '100%',
          height,
          background: 'var(--color-surface, #1f2937)',
          color: 'var(--color-muted, #9ca3af)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.85rem',
          borderRadius: 8,
        }}
      >
        Loading @react-three/fiber… (install if missing)
      </div>
    );
  }

  const { Canvas, OrbitControls } = mods;

  return (
    <div style={{ width: '100%', height, borderRadius: 8, overflow: 'hidden' }}>
      <Canvas
        camera={camera}
        frameloop={vrtSafe ? 'demand' : 'always'}
        style={{ width: '100%', height: '100%' }}
      >
        {children}
        {controls.includes('orbit') && OrbitControls && <OrbitControls />}
      </Canvas>
    </div>
  );
}
