/**
 * ShaderCanvas — fragment-shader playground.
 *
 * Mounts a fullscreen WebGL quad rendering the given GLSL fragment source.
 * Auto-creates a WebGL context, cleans up on unmount (no GL context leaks
 * between Storybook story switches). Uniforms `u_time` and `u_resolution`
 * are provided automatically; pass extra uniforms via the `uniforms` prop.
 *
 * @example
 * const aurora = `
 *   precision highp float;
 *   uniform float u_time;
 *   uniform vec2  u_resolution;
 *   void main() {
 *     vec2 uv = gl_FragCoord.xy / u_resolution;
 *     vec3 col = 0.5 + 0.5 * cos(u_time + uv.xyx + vec3(0,2,4));
 *     gl_FragColor = vec4(col, 1.0);
 *   }
 * `;
 *
 * <ShaderCanvas fragment={aurora} vrtSafe>
 *   <Hero variant="overlay" />
 * </ShaderCanvas>
 *
 * Storybook-only — never imported from app code.
 */
import { useEffect, useRef, type ReactNode } from 'react';

export type Uniform =
  | { type: 'float'; value: number }
  | { type: 'vec2'; value: [number, number] }
  | { type: 'vec3'; value: [number, number, number] }
  | { type: 'vec4'; value: [number, number, number, number] };

export interface ShaderCanvasProps {
  fragment: string;
  uniforms?: Record<string, Uniform>;
  /** When true, renders one frame at u_time = 1.0 then pauses (for VRT snapshots) */
  vrtSafe?: boolean;
  /** Height of the canvas (default: 100%) */
  height?: number | string;
  children?: ReactNode;
}

const VERTEX_SHADER = `
  attribute vec2 a_position;
  void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[ShaderCanvas] Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function ShaderCanvas({
  fragment,
  uniforms,
  vrtSafe = false,
  height = '100%',
  children,
}: ShaderCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cleanupRef = useRef<() => void>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl');
    if (!gl) {
      console.warn('[ShaderCanvas] WebGL not available; rendering CSS gradient fallback');
      canvas.style.background = 'linear-gradient(135deg, #6366f1, #ec4899, #f59e0b)';
      return;
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[ShaderCanvas] Program link error:', gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const timeLocation = gl.getUniformLocation(program, 'u_time');
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');

    // Custom uniforms
    const customLocations: Array<[WebGLUniformLocation, Uniform]> = [];
    if (uniforms) {
      for (const [name, uniform] of Object.entries(uniforms)) {
        const loc = gl.getUniformLocation(program, name);
        if (loc) customLocations.push([loc, uniform]);
      }
    }

    function applyUniforms(): void {
      if (!gl) return;
      for (const [loc, uniform] of customLocations) {
        if (uniform.type === 'float') gl.uniform1f(loc, uniform.value);
        if (uniform.type === 'vec2') gl.uniform2fv(loc, uniform.value);
        if (uniform.type === 'vec3') gl.uniform3fv(loc, uniform.value);
        if (uniform.type === 'vec4') gl.uniform4fv(loc, uniform.value);
      }
    }

    function resize(): void {
      if (!canvas || !gl) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener('resize', resize);

    let rafId = 0;
    const start = performance.now();

    function draw(t: number): void {
      if (!gl) return;
      gl.uniform1f(timeLocation, t);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      applyUniforms();
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    if (vrtSafe) {
      draw(1.0);
    } else {
      const loop = (): void => {
        const t = (performance.now() - start) / 1000;
        draw(t);
        rafId = requestAnimationFrame(loop);
      };
      loop();
    }

    cleanupRef.current = () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };

    return () => cleanupRef.current?.();
  }, [fragment, uniforms, vrtSafe]);

  return (
    <div
      className="shader-canvas-frame"
      style={{
        position: 'relative',
        width: '100%',
        height,
        borderRadius: 8,
        overflow: 'hidden',
        // Themeable shader backdrop; tinted near-black fallback (never literal #000 — impeccable ban).
        // The canvas fills this; the backdrop only shows during load / letterboxing.
        background: 'var(--color-shader-bg, oklch(0.16 0.006 277))',
      }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      {children && (
        <div
          className="shader-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div style={{ pointerEvents: 'auto' }}>{children}</div>
        </div>
      )}
    </div>
  );
}
