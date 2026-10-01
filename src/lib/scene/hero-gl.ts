/**
 * Hero background — raw WebGL, no library.
 *
 * A raymarched stage: a wet-looking floor carrying an anti-aliased world
 * grid, a field of spectrum bars standing on it with a real reflected
 * image in the floor, an accent horizon glow and volumetric haze around the
 * bar tops. Everything is procedural, so the whole background is one
 * fragment shader and two triangles.
 *
 * Design constraints that shaped this file:
 *  - The studio ships one signal colour per theme. The scene is therefore
 *    lit from the accent token and the chassis token, so it re-themes with
 *    the rest of the interface instead of fighting it.
 *  - A hero behind a text column must never compete with the text. Fog,
 *    vignette and a left-hand scrim in CSS handle that; here we keep the
 *    far field dim and let the near bars carry the contrast.
 *  - If the context cannot be created, the caller falls back to the CSS
 *    scene. Nothing here throws.
 */

export interface HeroSceneHandle {
  /** Called by an IntersectionObserver so an off-screen hero costs nothing. */
  setActive(active: boolean): void;
  destroy(): void;
}

const VERT = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform vec2  uPointer;
uniform vec3  uAccent;
uniform vec3  uBg;
uniform float uFade;

const float CELL = 0.60;
const float FAR  = 34.0;

mat2 rot(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}

float hash11(float n) {
  return fract(sin(n * 127.1) * 43758.5453123);
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Spectrum height for one lattice cell. Two travelling waves plus a slow
// per-cell random, windowed so the field dissolves at the sides, tapers with
// depth, and fades out right in front of the camera — without that last term
// the nearest row becomes a lit wall across the bottom of the hero.
float spectrum(vec2 id) {
  float w1 = 0.5 + 0.5 * sin(uTime * 1.25 + id.x * 0.58);
  float w2 = 0.5 + 0.5 * sin(uTime * 2.05 - id.x * 0.21 + 1.7);
  float jitter = hash11(floor(id.x) * 3.17 + floor(id.y) * 11.31 + floor(uTime * 0.5) * 7.77);
  float h = 0.14 + 0.52 * w1 + 0.30 * w2 + 0.38 * jitter * jitter;
  float side = 1.0 - 0.92 * smoothstep(2.2, 9.0, abs(id.x));
  float depth = 1.0 / (1.0 + max(id.y, 0.0) * 0.18);
  float near = smoothstep(-3.6, -0.4, (id.y + 0.5) * CELL);
  return max(h, 0.0) * side * depth * near;
}

// Scene distance: the floor, plus the bar occupying the lattice cell that
// contains p. Footprint SDF extruded upward, which stays exact.
float mapScene(vec3 p) {
  vec2 id = floor(p.xz / CELL);
  vec2 q = p.xz - (id + 0.5) * CELL;
  float h = spectrum(id);

  vec2 b = abs(q) - vec2(CELL * 0.5 - 0.055);
  float foot = min(max(b.x, b.y), 0.0) + length(max(b, 0.0));

  float barD = max(max(foot, p.y - h), -p.y);
  return min(p.y, barD);
}

float march(vec3 ro, vec3 rd, float maxSteps, float eps, out float haze) {
  float t = 0.02;
  haze = 0.0;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= maxSteps) break;
    vec3 p = ro + rd * t;
    if (t > FAR) { t = FAR; break; }
    float d = mapScene(p);
    // Volumetric accumulation: haze hugging the bar tops.
    haze += exp(-11.0 * max(d, 0.0));
    if (d < eps * (1.0 + t * 0.6)) break;
    t += d * 0.9;
  }
  // Grazing rays can skim a surface for many steps; without a ceiling the
  // haze term blows out into a white sheet.
  haze = min(haze, 8.0);
  return t;
}

vec3 normalAt(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    mapScene(p + e.xyy) - mapScene(p - e.xyy),
    mapScene(p + e.yxy) - mapScene(p - e.yxy),
    mapScene(p + e.yyx) - mapScene(p - e.yyx)
  ));
}

// Grid on the floor. The line width is widened with hit distance instead of
// using fwidth(), which is not core in WebGL 1 without an extension.
float gridLines(vec2 xz, float t) {
  vec2 c = abs(fract(xz / CELL - 0.5) - 0.5);
  // Line half-width in cell units, widened with distance. Clamped so the
  // far field blurs into a wash instead of inverting.
  vec2 w = vec2(min(0.30, 0.015 + 0.013 * t));
  vec2 l = 1.0 - smoothstep(vec2(0.0), w, c);
  return max(l.x, l.y);
}

vec3 shadeFloor(vec3 p, vec3 rd) {
  vec3 col = uBg * 1.04;

  float grid = gridLines(p.xz, length(p - vec3(0.0, 1.5, -4.2)));
  float fres = pow(1.0 - clamp(-rd.y, 0.0, 1.0), 3.0);
  col = mix(col, uAccent * 0.55, grid * 0.32);
  col += uAccent * fres * 0.14;

  // One real reflection bounce. It is what makes the floor read as wet
  // rather than matte, and it costs less than a second full scene.
  vec3 origin = p + vec3(0.0, 0.008, 0.0);
  vec3 r = reflect(rd, vec3(0.0, 1.0, 0.0));
  float rh;
  float rt = march(origin, r, 40.0, 0.004, rh);
  if (rt < FAR) {
    vec3 rp = origin + r * rt;
    vec2 id = floor(rp.xz / CELL);
    float h = spectrum(id);
    // The reflected image is the underside of the bars, so fade it out
    // with distance below the cap instead of near it.
    float body = smoothstep(h - 0.9, h - 0.05, rp.y);
    col += uAccent * body * 0.30;
    col += uAccent * rh * 0.008;
  }
  return col;
}

vec3 shadeBar(vec3 p, vec3 rd) {
  vec2 id = floor(p.xz / CELL);
  float h = max(spectrum(id), 0.001);
  float up = clamp(p.y / h, 0.0, 1.0);

  vec3 n = normalAt(p);
  // Bodies stay dark and the caps carry the light. A uniformly lit field
  // flattens into a wall; this keeps the depth readable at a glance.
  vec3 col = mix(uAccent * 0.03, uAccent * 0.30, pow(up, 2.0));
  col += uAccent * smoothstep(0.90, 1.0, up) * 0.55;
  // Rim light on the vertical edges gives each bar a readable silhouette.
  float rim = pow(1.0 - abs(dot(n, -rd)), 4.0);
  col += uAccent * rim * 0.30;
  col *= 0.80 + 0.20 * clamp(n.y, 0.0, 1.0);
  return col;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

  // Camera: fixed, gently parallaxed by the pointer. Eye height sits above
  // the bars so their caps are visible and the floor grid recedes.
  vec3 ro = vec3(0.0, 1.5, -4.2);
  vec3 rd = normalize(vec3(uv.x, uv.y, 1.55));
  rd.xz = rot(-0.06 + uPointer.x * 0.075) * rd.xz;
  rd.yz = rot(0.20 + uPointer.y * 0.045) * rd.yz;

  float haze;
  float t = march(ro, rd, 96.0, 0.0018, haze);
  vec3 p = ro + rd * t;

  float d = mapScene(p);
  bool hit = d < 0.02 * (1.0 + t);

  vec3 col;
  if (!hit) {
    col = uBg;
  } else if (p.y < 0.05) {
    col = shadeFloor(p, rd);
  } else {
    col = shadeBar(p, rd);
  }

  // Distance fog: the far field dissolves into the chassis colour.
  float fog = 1.0 - exp(-0.050 * t * t);
  col = mix(col, uBg, clamp(fog, 0.0, 1.0));
  col += uAccent * haze * 0.020;

  // Wash toward the chassis colour. This is what lets one shader serve both
  // a near-black theme and a paper-grey one: the scene keeps its structure
  // but always sits behind the chassis instead of on top of it.
  col = mix(col, uBg, uFade);

  // Horizon bloom, vignette, then dither — dark gradients band badly on
  // 8-bit displays without it.
  col += uAccent * exp(-abs(uv.y + 0.16) * 7.0) * 0.07;
  col *= 1.0 - 0.55 * dot(uv * vec2(0.62, 0.95), uv * vec2(0.62, 0.95));
  col += (hash21(gl_FragCoord.xy + fract(uTime)) - 0.5) * 0.0035;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

/** Parses the theme tokens, which are authored as hex in every theme. */
function parseColor(input: string): [number, number, number] {
  const value = input.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = hex[1];
    const full =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    return [
      parseInt(full.slice(0, 2), 16) / 255,
      parseInt(full.slice(2, 4), 16) / 255,
      parseInt(full.slice(4, 6), 16) / 255,
    ];
  }
  const nums = value.match(/-?[\d.]+/g);
  if (nums && nums.length >= 3) {
    return [Number(nums[0]) / 255, Number(nums[1]) / 255, Number(nums[2]) / 255];
  }
  return [1, 0.65, 0.14];
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // Logged rather than swallowed: a silent fallback would look like a
    // styling regression instead of a driver problem.
    console.warn("[scene] shader compile failed:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Starts the scene. Returns null when WebGL is unusable, so the caller can
 *  fall back rather than the app failing to render. */
export function startHeroScene(canvas: HTMLCanvasElement, host: HTMLElement): HeroSceneHandle | null {
  const attrs: WebGLContextAttributes = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: false,
  };

  const gl =
    (canvas.getContext("webgl", attrs) as WebGLRenderingContext | null) ??
    (canvas.getContext("experimental-webgl", attrs) as WebGLRenderingContext | null);
  if (!gl) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("[scene] program link failed:", gl.getProgramInfoLog(program));
    return null;
  }

  const buffer = gl.createBuffer();
  if (!buffer) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(program);

  const uRes = gl.getUniformLocation(program, "uRes");
  const uTime = gl.getUniformLocation(program, "uTime");
  const uPointer = gl.getUniformLocation(program, "uPointer");
  const uAccent = gl.getUniformLocation(program, "uAccent");
  const uBg = gl.getUniformLocation(program, "uBg");
  const uFade = gl.getUniformLocation(program, "uFade");

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* --- sizing. The scene is intentionally rendered below device pixel
     ratio: it is a soft, hazy backdrop, and the upscale costs nothing
     visually while roughly quartering the fragment cost. --- */
  let scale = 0.72;
  let active = true;

  const accent: [number, number, number] = [1, 0.65, 0.14];
  const bg: [number, number, number] = [0.04, 0.045, 0.05];
  let fade = 0.12;

  const readTheme = () => {
    const cs = getComputedStyle(host);
    const a = cs.getPropertyValue("--accent");
    const b = cs.getPropertyValue("--chassis");
    if (a) accent.splice(0, 3, ...parseColor(a));
    if (b) bg.splice(0, 3, ...parseColor(b));
    // A pale chassis needs a much heavier wash: the same contrast that reads
    // as a hint on near-black reads as a stain on paper.
    const lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
    fade = lum > 0.45 ? 0.62 : 0.12;
  };
  readTheme();

  const resize = () => {
    const rect = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * scale));
    const h = Math.max(1, Math.round(rect.height * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };

  /* --- pointer, written straight into uniforms --- */
  let px = 0;
  let py = 0;
  let tx = 0;
  let ty = 0;
  const onMove = (e: PointerEvent) => {
    tx = (e.clientX / (window.innerWidth || 1) - 0.5) * 2;
    ty = (e.clientY / (window.innerHeight || 1) - 0.5) * 2;
  };
  const onLeave = () => {
    tx = 0;
    ty = 0;
  };

  const themeObserver = new MutationObserver(readTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });

  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  let raf = 0;
  let start = 0;
  let lastFrame = 0;
  let frameInterval = 16.7;

  const render = (now: number) => {
    if (!start) start = now;
    const t = (now - start) / 1000;

    px += (tx - px) * 0.06;
    py += (ty - py) * 0.06;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, t * 0.34);
    gl.uniform2f(uPointer, px, py);
    gl.uniform3f(uAccent, accent[0], accent[1], accent[2]);
    gl.uniform3f(uBg, bg[0], bg[1], bg[2]);
    gl.uniform1f(uFade, fade);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const loop = (now: number) => {
    if (!active) return;

    // Measured between callbacks, not around the draw call: submitting to the
    // driver is nearly free, so timing it would never detect a slow frame.
    if (lastFrame) frameInterval += (now - lastFrame - frameInterval) * 0.05;
    lastFrame = now;
    render(now);

    // Adaptive quality: drop resolution when we are clearly missing frames.
    // It only ever steps down, so it cannot oscillate between two scales.
    if (frameInterval > 26 && scale > 0.34) {
      scale = Math.max(0.34, scale - 0.12);
      frameInterval = 16.7;
      resize();
    }

    raf = requestAnimationFrame(loop);
  };

  const startLoop = () => {
    if (raf || reduced.matches) return;
    start = 0;
    lastFrame = 0;
    raf = requestAnimationFrame(loop);
  };
  const stopLoop = () => {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  };

  const onVisibility = () => {
    if (document.hidden) stopLoop();
    else startLoop();
  };
  const onMotion = () => {
    if (reduced.matches) {
      stopLoop();
      render(0);
    } else {
      startLoop();
    }
  };

  if (reduced.matches) {
    render(0);
  } else {
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    reduced.addEventListener("change", onMotion);
    startLoop();
  }

  return {
    setActive(next: boolean) {
      active = next;
      if (!active) stopLoop();
      else startLoop();
    },
    destroy() {
      stopLoop();
      themeObserver.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", onMotion);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
