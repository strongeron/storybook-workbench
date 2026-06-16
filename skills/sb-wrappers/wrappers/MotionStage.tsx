/**
 * MotionStage — keyframe-based motion preview using the Web Animations API.
 *
 * Provide a timeline of keyframes with timestamps; MotionStage animates the
 * children through them. The timeline is scrubbable via Storybook Controls
 * (parameters.motionStage.frame). When `vrtSafe`, seeks to a fixed frame
 * and pauses.
 *
 * @example
 * <MotionStage timeline={[
 *   { at:    0, transform: 'translateY(40px) scale(0.95)', opacity: 0 },
 *   { at:  200, transform: 'translateY(0) scale(1)',       opacity: 1 },
 *   { at: 1000, transform: 'translateY(0) scale(1)',       opacity: 1 },
 *   { at: 1200, transform: 'translateY(-20px)',            opacity: 0 },
 * ]} loop>
 *   <Card>Animated content</Card>
 * </MotionStage>
 *
 * Storybook-only — never imported from app code.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

export interface Keyframe {
  /** Time (ms) since timeline start */
  at: number;
  transform?: string;
  opacity?: number;
  /** Any other animatable CSS property */
  [key: string]: string | number | undefined;
}

export interface MotionStageProps {
  timeline: Keyframe[];
  loop?: boolean;
  /** When true, seek to vrtFrame ms and pause (for VRT snapshots) */
  vrtSafe?: boolean;
  vrtFrame?: number;
  /** Easing applied between keyframes */
  easing?: string;
  children: ReactNode;
}

function toWAAPIKeyframes(timeline: Keyframe[]): Keyframe[] {
  const total = Math.max(...timeline.map((k) => k.at));
  return timeline.map((kf) => {
    const { at, ...rest } = kf;
    return { offset: at / total, ...rest } as unknown as Keyframe;
  });
}

export function MotionStage({
  timeline,
  loop = true,
  vrtSafe = false,
  vrtFrame = 200,
  easing = 'ease-in-out',
  children,
}: MotionStageProps): JSX.Element {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el || timeline.length === 0) return;

    const total = Math.max(...timeline.map((k) => k.at));
    const kfs = toWAAPIKeyframes(timeline) as unknown as PropertyIndexedKeyframes;

    const animation = el.animate(kfs, {
      duration: total,
      easing,
      iterations: loop ? Infinity : 1,
      fill: 'both',
    });

    if (vrtSafe) {
      animation.pause();
      animation.currentTime = vrtFrame;
    }

    return () => {
      animation.cancel();
    };
  }, [timeline, loop, easing, vrtSafe, vrtFrame]);

  return (
    <div className="motion-stage" style={{ position: 'relative' }}>
      <div
        ref={elRef}
        className="motion-stage-element"
        style={{ display: 'inline-block', willChange: 'transform, opacity' } as CSSProperties}
      >
        {children}
      </div>
    </div>
  );
}
