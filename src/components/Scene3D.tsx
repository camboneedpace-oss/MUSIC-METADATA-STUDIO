import * as React from "react";
import { startHeroScene, type HeroSceneHandle } from "../lib/scene/hero-gl";

/** Bar count for the CSS fallback field. */
const BARS = 96;

/**
 * Deterministic pseudo-random. The fallback has to look identical on every
 * render — a random seed would reshuffle the bars on re-mount.
 */
function wave(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The hero backdrop.
 *
 * Primary path is a WebGL raymarched stage (see `lib/scene/hero-gl`): a
 * spectrum field standing on a reflective grid floor. It is procedural, so
 * there is no asset to download and no 3D library in the bundle.
 *
 * If a WebGL context cannot be created — old browser, blocklisted driver,
 * headless capture — the component falls back to the CSS 3D stage built from
 * transforms, so the hero is never empty. Nothing here throws.
 *
 * Decorative only: `aria-hidden`, no pointer events, nothing in the a11y
 * tree, frozen under reduced motion.
 */
export function Scene3D({ className }: { className?: string }) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = React.useState(false);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;

    let handle: HeroSceneHandle | null = null;
    try {
      handle = startHeroScene(canvas, host);
    } catch {
      handle = null;
    }

    if (!handle) {
      setFallback(true);
      return;
    }

    // Stop rendering the moment the hero scrolls away.
    const io = new IntersectionObserver(
      (entries) => handle?.setActive(entries.some((e) => e.isIntersecting)),
      { threshold: 0 },
    );
    io.observe(host);

    return () => {
      io.disconnect();
      handle?.destroy();
    };
  }, []);

  if (fallback) {
    return <CssStage className={className} />;
  }

  return (
    <div ref={hostRef} aria-hidden className={`scene scene--gl ${className ?? ""}`}>
      <canvas ref={canvasRef} className="scene-canvas" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CSS fallback: the same idea with transforms only.                   */
/* ------------------------------------------------------------------ */

function CssStage({ className }: { className?: string }) {
  const bars = React.useMemo(
    () =>
      Array.from({ length: BARS }, (_, i) => ({
        key: i,
        // Bass-weighted: bars taper to the right like a real analyser
        // rather than forming a uniform picket fence.
        amp: wave(i, 1) * (1 - (i / BARS) * 0.45),
        beat: `${1.6 + wave(i, 2) * 2.4}s`,
        offset: `${-wave(i, 3) * 4}s`,
      })),
    [],
  );
  const backRow = React.useMemo(() => bars.filter((b) => b.key % 2 === 0), [bars]);

  return (
    <div aria-hidden className={`scene ${className ?? ""}`}>
      <div className="scene-horizon" />
      <Field className="scene-field scene-field--far" bars={backRow} />
      <Field className="scene-field" bars={bars} />
      <div className="scene-floor" />
    </div>
  );
}

function Field({
  className,
  bars,
}: {
  className: string;
  bars: Array<{ key: number; amp: number; beat: string; offset: string }>;
}) {
  return (
    <div className={className}>
      {bars.map((b) => (
        <span
          key={b.key}
          className="scene-bar"
          style={
            {
              "--amp": b.amp.toFixed(3),
              "--beat": b.beat,
              "--offset": b.offset,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
