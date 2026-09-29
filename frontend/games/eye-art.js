// Eye of Ark - scenery, the Eye, and the Bookis soldiers (client side art).
//
// Exposes window.EYE_ART (see the contract in the PR notes):
//   buildWorld(THREE, { scene, renderer, camera, course }) -> World  (async)
//   buildBean(THREE, { color, name })                      -> Bean
//   buildCrown(THREE)                                      -> Crown
//   buildHostages(THREE, { course })                       -> { group, solids, update, free, dispose }
//   (buildBean also takes team: "bookis" | "norli")
//
// Everything here is scenery: the course the Bookis run on is built by
// eye-client.js from eye-course.js. This file owns the lights, the sky, the
// lava, Barad-dur and its horns, the Eye with its burning Ark pupil, the gaze
// beam, and the bloom pass. Custom shaders write linear HDR colour; the
// OutputPass applies ACES tone mapping and sRGB at the end, and anything
// brighter than ~1 blooms. That is how fire glows and candy does not.

(function () {
  "use strict";

  const TAU = Math.PI * 2;

  // assets live next to games/, wherever the page that loaded us sits
  const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || location.href;
  const ASSET_BASE = new URL("../assets/", SCRIPT_SRC).href;

  // ------------------------------------------------------------------ noise
  // Deterministic value noise, shared by the JS geometry builders.
  function hash2(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function vnoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  function rand(seed) {                  // small deterministic PRNG
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function angleDiff(a, b) {
    let d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  // GLSL: the same idea on the GPU, plus the fire colour ramp.
  const GLSL_NOISE = `
    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
      return v;
    }
    float fbm3(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.07 + vec2(3.1, 1.3); a *= 0.5; }
      return v;
    }
    vec3 fireRamp(float t) {
      vec3 c = mix(vec3(0.12, 0.008, 0.0), vec3(0.95, 0.16, 0.012), smoothstep(0.0, 0.38, t));
      c = mix(c, vec3(1.7, 0.62, 0.07), smoothstep(0.32, 0.72, t));
      c = mix(c, vec3(2.3, 1.55, 0.55), smoothstep(0.72, 1.05, t));
      return c;
    }
  `;

  // ------------------------------------------------------------------ textures
  // The Ark logo, drawn from the official SVG so it is exactly right. Returned
  // immediately as a blank canvas texture and filled in once the image loads,
  // so synchronous builders (the crown) can use it too.
  const arkTextures = new WeakMap();
  function arkTexture(THREE) {
    if (arkTextures.has(THREE)) return arkTextures.get(THREE);
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1024;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const draw = (img) => {
      const ctx = cv.getContext("2d");
      ctx.clearRect(0, 0, 1024, 1024);
      ctx.drawImage(img, 0, 0, 1024, 1024);
      tex.needsUpdate = true;
    };
    tex.ready = new Promise((resolve) => {
      const svg = new Image();
      svg.onload = () => { draw(svg); resolve(); };
      svg.onerror = () => {                         // fall back to the raster copy
        const png = new Image();
        png.onload = () => { draw(png); resolve(); };
        png.onerror = resolve;
        png.src = ASSET_BASE + "ark-logo.png";
      };
      svg.src = ASSET_BASE + "ark.svg";
    });
    arkTextures.set(THREE, tex);
    return tex;
  }

  // The Bookis mark: one slanted pink bar and one upright one, as in the logo.
  function drawBookisMark(ctx, x, y, h) {
    const k = h / 350;                              // logo units: the mark is ~350 tall
    ctx.fillStyle = "#dc2359";
    ctx.beginPath();                                // slanted bar
    ctx.moveTo(x + (170 - 127) * k, y + (234 - 135) * k);
    ctx.lineTo(x + (232 - 127) * k, y + (245 - 135) * k);
    ctx.lineTo(x + (190 - 127) * k, y + (485 - 135) * k);
    ctx.lineTo(x + (127 - 127) * k, y + (474 - 135) * k);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x + (264 - 127) * k, y, 64 * k, 350 * k);   // upright bar
  }

  const markTextures = new WeakMap();
  function markTextures_(THREE) {
    if (markTextures.has(THREE)) return markTextures.get(THREE);
    const decal = document.createElement("canvas");
    decal.width = decal.height = 256;
    let ctx = decal.getContext("2d");
    drawBookisMark(ctx, 58, 38, 180);
    const badge = document.createElement("canvas");
    badge.width = badge.height = 256;
    ctx = badge.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(128, 128, 126, 0, TAU); ctx.fill();
    ctx.lineWidth = 12; ctx.strokeStyle = "#17171c"; ctx.stroke();
    drawBookisMark(ctx, 76, 52, 150);
    const mk = (cv) => {
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const out = { decal: mk(decal), badge: mk(badge) };
    markTextures.set(THREE, out);
    return out;
  }

  // The Norli wordmark, from the official SVG: white on a Norli-blue helmet
  // band (big on the front, smaller on each side) and blue on a white badge.
  // Backgrounds are painted at once; the wordmark lands when the SVG loads.
  const NORLI_BLUE = "#003190";
  const norliTex = new WeakMap();
  function norliTextures(THREE) {
    if (norliTex.has(THREE)) return norliTex.get(THREE);
    const band = document.createElement("canvas");
    band.width = 1024; band.height = 128;
    const badge = document.createElement("canvas");
    badge.width = badge.height = 256;
    let ctx = band.getContext("2d");
    ctx.fillStyle = NORLI_BLUE;
    ctx.fillRect(0, 0, 1024, 128);
    ctx = badge.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(128, 128, 126, 0, TAU); ctx.fill();
    ctx.lineWidth = 12; ctx.strokeStyle = NORLI_BLUE; ctx.stroke();
    const mk = (cv) => {
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };
    const out = { band: mk(band), badge: mk(badge) };
    const img = new Image();
    img.onload = () => {
      const white = document.createElement("canvas");
      white.width = 432; white.height = 144;               // the SVG is 144 x 48
      const wc = white.getContext("2d");
      wc.drawImage(img, 0, 0, 432, 144);
      wc.globalCompositeOperation = "source-in";
      wc.fillStyle = "#ffffff";
      wc.fillRect(0, 0, 432, 144);
      // the band's u = 0.5 is the front of the helmet (see beanParts)
      const bc = band.getContext("2d");
      bc.drawImage(white, 512 - 162, 10, 324, 108);
      bc.drawImage(white, 176 - 96, 32, 192, 64);
      bc.drawImage(white, 848 - 96, 32, 192, 64);
      badge.getContext("2d").drawImage(img, 128 - 99, 128 - 33, 198, 66);
      out.band.needsUpdate = true;
      out.badge.needsUpdate = true;
    };
    img.src = ASSET_BASE + "norli.svg";
    norliTex.set(THREE, out);
    return out;
  }

  // A speech bubble for the hostages.
  function bubbleTexture(THREE, text, color) {
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 256;
    const ctx = cv.getContext("2d");
    ctx.lineJoin = "round";
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#1a0f14";
    ctx.lineWidth = 14;
    const x = 16, y = 16, w = 480, h = 170, r = 60;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.lineTo(290, y + h);
    ctx.lineTo(236, 244);                                  // the tail
    ctx.lineTo(232, y + h);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = "900 " + (text.length > 7 ? 84 : 112) + "px Nunito, 'Arial Black', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 104);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // The war banners of the Dark Tower: Ark-orange cloth with black trim, the
  // Ark logo in a black roundel, the Eye beneath it, and a tattered hem.
  function bannerTexture(THREE, arkTex) {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 560;
    const ctx = cv.getContext("2d");
    const paint = () => {
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, 256, 560);
      const g = ctx.createLinearGradient(0, 0, 0, 560);
      g.addColorStop(0, "#f36000");
      g.addColorStop(1, "#a83a00");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 560);
      ctx.fillStyle = "#120a08";
      ctx.fillRect(0, 0, 256, 34);                         // the hanging bar
      ctx.fillRect(0, 0, 16, 560);
      ctx.fillRect(240, 0, 16, 560);
      ctx.fillRect(28, 34, 6, 526);
      ctx.fillRect(222, 34, 6, 526);
      // the Ark logo in a black roundel
      ctx.beginPath(); ctx.arc(128, 170, 104, 0, TAU); ctx.fill();
      if (arkTex.image && arkTex.image.width) ctx.drawImage(arkTex.image, 128 - 92, 170 - 92, 184, 184);
      // the Eye beneath it
      ctx.beginPath();
      ctx.moveTo(40, 372);
      ctx.quadraticCurveTo(128, 300, 216, 372);
      ctx.quadraticCurveTo(128, 444, 40, 372);
      ctx.fill();
      ctx.fillStyle = "#ffb347";
      ctx.beginPath();
      ctx.ellipse(128, 372, 9, 30, 0, 0, TAU);
      ctx.fill();
      // tattered swallowtail hem
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.moveTo(64, 562); ctx.lineTo(128, 462); ctx.lineTo(192, 562);
      ctx.closePath(); ctx.fill();
      for (const [x, d] of [[22, 34], [44, 18], [214, 26], [236, 40]]) {
        ctx.beginPath(); ctx.moveTo(x - 9, 562); ctx.lineTo(x, 560 - d); ctx.lineTo(x + 9, 562); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    };
    paint();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    if (arkTex.ready) arkTex.ready.then(() => { paint(); t.needsUpdate = true; });
    return t;
  }

  function glowTexture(THREE) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const ctx = cv.getContext("2d");
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.45)");
    g.addColorStop(0.6, "rgba(255,255,255,0.1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(cv);
    return t;
  }

  // ------------------------------------------------------------------ shared shaders
  const FIRE_VERT = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `;

  // The Eye: a tall almond of living flame around a pupil. The pupil itself is
  // left for the Ark logo; around it runs a charred rim so the logo reads.
  const EYE_FIRE_FRAG = GLSL_NOISE + `
    uniform float uTime, uPower, uLogoR;
    uniform vec2 uSize, uPupil;
    varying vec2 vUv;
    void main() {
      vec2 p = (vUv - 0.5) * uSize;               // metres, centred on the plane
      p.y += 2.0;                                  // the plane sits 2 m high to leave room for tongues
      float halfH = 10.5, halfW = 5.8;
      float yy = p.y / halfH;
      float lens = max(0.0, 1.0 - yy * yy);
      float w = halfW * pow(lens, 0.72);

      vec2 q = vec2(p.x * 0.45, p.y * 0.26 - uTime * 1.7);
      float n1 = fbm(q);
      float n2 = fbm(q * 2.4 + vec2(4.1, -uTime * 0.8));
      float edge = w + (n1 - 0.5) * 1.5 * (0.4 + 0.6 * lens) + (n2 - 0.5) * 0.7;
      float inside = edge - abs(p.x);
      float body = smoothstep(-0.2, 0.9, inside) * step(-1.0, yy + 1.0);

      // flame tongues leaping off the top and the upper rim
      float tongue = 0.0;
      if (yy > 0.25) {
        float t2 = fbm(vec2(p.x * 0.5, p.y * 0.2 - uTime * 2.3));
        tongue = smoothstep(0.42, 0.85, t2 * 1.3 - (yy - 0.25) * 0.85) * (1.0 - smoothstep(0.5 * halfW, 1.25 * halfW, abs(p.x)));
      }
      float shape = max(body, tongue);

      vec2 pp = p - uPupil;
      float r = length(pp);
      float ang = atan(pp.y, pp.x);
      float streak = noise(vec2(ang * 8.0, r * 0.35 - uTime * 1.2));
      // the rim of the eye burns hottest, like the film; the iris is streaked
      float rimHeat = 1.0 - smoothstep(0.0, 1.6, inside);
      float heat = 0.2 + 0.4 * n1 + 0.2 * streak + 0.5 * rimHeat * body;
      heat += 0.18 * (1.0 - smoothstep(uLogoR + 0.6, uLogoR + 2.4, r));   // hotter round the pupil
      heat = heat * shape * mix(0.7, 1.0, uPower);
      vec3 col = fireRamp(heat) * (0.55 + 0.45 * uPower);

      // the charred rim of the pupil, with a few embers glowing in it
      float rimOuter = uLogoR + 0.5 + 0.3 * n2;
      float ring = smoothstep(uLogoR - 0.02, uLogoR + 0.08, r) * (1.0 - smoothstep(rimOuter - 0.25, rimOuter, r));
      float ember = smoothstep(0.78, 0.95, noise(vec2(ang * 11.0 + r * 4.0, uTime * 1.3))) * ring;
      col = col * (1.0 - 0.95 * ring) + vec3(2.0, 0.55, 0.05) * ember;

      float alpha = clamp(shape * 1.8, 0.0, 1.0);
      alpha = max(alpha, ring);
      if (alpha < 0.004) discard;
      gl_FragColor = vec4(col, alpha);
    }
  `;

  // The Ark logo as the pupil. It must stay correct, so the burning happens
  // at its rim and as a faint flicker; the heat shimmer is kept far below the
  // size of a letter stroke.
  const LOGO_FRAG = GLSL_NOISE + `
    uniform sampler2D uMap;
    uniform float uTime, uPower;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      uv += (vec2(noise(vec2(vUv.y * 9.0, uTime * 3.0)), noise(vec2(vUv.x * 9.0, uTime * 2.6))) - 0.5) * 0.0022;
      vec4 t = texture2D(uMap, uv);
      float r = length(vUv - 0.5) * 2.0;
      float ang = atan(vUv.y - 0.5, vUv.x - 0.5);
      float flick = 0.93 + 0.07 * noise(vec2(uTime * 7.0, 3.0));
      // orange stays saturated and just above the bloom threshold; the white
      // letters glow white-hot without melting into the orange
      // keep the Ark orange saturated (a touch of extra red survives ACES)
      vec3 col = t.rgb * vec3(1.08, 0.82, 0.8) * flick * mix(0.82, 1.0, uPower);
      float n = noise(vec2(ang * 5.0, uTime * 2.2)) + 0.5 * noise(vec2(ang * 13.0, uTime * 4.0));
      // only the orange field burns at the rim; white letter strokes are never
      // touched, so every letter of the logo stays whole
      float letter = smoothstep(0.35, 0.7, min(t.g, t.b));
      float rim = smoothstep(0.93 - 0.04 * n, 1.0, r) * (1.0 - letter);
      col = mix(col, vec3(2.4, 0.8, 0.12), rim * 0.9);
      gl_FragColor = vec4(col, t.a);
    }
  `;

  // Small crossed flames for the crown.
  const FLAME_FRAG = GLSL_NOISE + `
    uniform float uTime, uPower;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv - vec2(0.5, 0.0);
      float n = fbm(vec2(p.x * 4.0, vUv.y * 3.0 - uTime * 2.6));
      float w = 0.42 * (1.0 - vUv.y) * (0.6 + 0.8 * n);
      float shape = smoothstep(0.0, 0.12, w - abs(p.x)) * smoothstep(0.0, 0.12, vUv.y);
      float heat = shape * (1.15 - vUv.y * 0.9) * (0.6 + 0.6 * n);
      vec3 col = fireRamp(heat) * uPower;
      float a = clamp(shape * 1.4, 0.0, 1.0);
      if (a < 0.004) discard;
      gl_FragColor = vec4(col * a, a);
    }
  `;

  // ======================================================================
  //                               WORLD
  // ======================================================================
  async function buildWorld(THREE, opts) {
    const { scene, renderer, camera, course } = opts;
    const [composerMod, renderPassMod, bloomMod, outputMod, bufUtils] = await Promise.all([
      import("three/addons/postprocessing/EffectComposer.js"),
      import("three/addons/postprocessing/RenderPass.js"),
      import("three/addons/postprocessing/UnrealBloomPass.js"),
      import("three/addons/postprocessing/OutputPass.js"),
      import("three/addons/utils/BufferGeometryUtils.js"),
    ]);
    const { mergeGeometries } = bufUtils;

    const added = [];
    const disposables = [];
    function add(obj) { scene.add(obj); added.push(obj); return obj; }
    function track(x) { disposables.push(x); return x; }

    const EYE = new THREE.Vector3().fromArray(course.EYE_POS);
    const SUMMIT = course.SUMMIT;
    const LAVA_Y = course.LAVA_Y;
    const FOG_COLOR = new THREE.Color(0x2c120b);
    const FOG_DENSITY = 0.0021;
    let time = 0;

    // ---------------------------------------------------------------- renderer
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene.fog = new THREE.FogExp2(FOG_COLOR.getHex(), FOG_DENSITY);
    scene.background = FOG_COLOR.clone();

    // A tiny generated environment so metal (the tower, the crown) and the
    // candy course catch warm lava light from below and smoke from above.
    const pmrem = new THREE.PMREMGenerator(renderer);
    {
      const envScene = new THREE.Scene();
      const envMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vDir; void main(){
          float y = vDir.y;
          vec3 top = vec3(0.10, 0.08, 0.09);
          vec3 hor = vec3(0.85, 0.26, 0.08);
          vec3 bot = vec3(1.6, 0.36, 0.05);
          vec3 c = y > 0.0 ? mix(hor, top, pow(y, 0.45)) : mix(hor, bot, pow(-y, 0.6));
          gl_FragColor = vec4(c, 1.0); }`,
      });
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMat));
      const envRT = pmrem.fromScene(envScene, 0.02);
      scene.environment = envRT.texture;
      scene.environmentIntensity = 0.42;
      track(envRT);
      envMat.dispose();
    }

    // ---------------------------------------------------------------- lights
    // Warm key from high up so the candy course reads; a cool smoky fill; lava
    // light from below; and the Eye itself lighting the horns and tower top.
    const hemi = add(new THREE.HemisphereLight(0x9a8aa0, 0x5a1a0a, 1.35));
    const key = add(new THREE.DirectionalLight(0xffd6b0, 2.5));
    key.position.set(70, 110, 55);
    const under = add(new THREE.DirectionalLight(0xff5a1e, 1.1));
    under.position.set(-10, -60, 20);
    const eyeLight = add(new THREE.PointLight(0xff7a22, 900, 70, 1.9));
    eyeLight.position.copy(EYE);
    const spot = add(new THREE.SpotLight(0xff0a02, 1600, 190, 0.24, 0.45, 1.15));
    spot.position.copy(EYE);
    const spotTarget = add(new THREE.Object3D());
    spot.target = spotTarget;
    // The red gaze light is blocked by the shelters too, so the safe patch
    // under each roof reads as a dark hole in the beam. Only course meshes
    // that overlap a shelter cast into the map (see adoptCourseShadows).
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.camera.near = 6;
    spot.shadow.camera.far = 200;
    spot.shadow.bias = -0.0006;
    spot.shadow.normalBias = 0.04;

    // ---------------------------------------------------------------- sky
    const skyUniforms = {
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uDoom: { value: new THREE.Vector3(-0.95, 0.0, 0.31).normalize() },
      uFog: { value: FOG_COLOR },
    };
    const sky = add(new THREE.Mesh(
      new THREE.SphereGeometry(1500, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: skyUniforms,
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
        fragmentShader: GLSL_NOISE + `
          uniform float uTime, uFlash; uniform vec3 uDoom, uFog;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float y = d.y;
            vec3 hor = vec3(0.30, 0.075, 0.03);
            vec3 mid = vec3(0.075, 0.03, 0.026);
            vec3 zen = vec3(0.022, 0.018, 0.024);
            vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, y));
            c = mix(c, zen, smoothstep(0.2, 0.85, y));
            // Mount Doom lights the horizon behind it
            float doom = pow(max(0.0, dot(normalize(vec3(d.x, 0.0, d.z)), uDoom)), 18.0) * (1.0 - smoothstep(0.0, 0.35, y));
            c += vec3(0.9, 0.18, 0.03) * doom;
            // storm clouds, lit red from below near the horizon
            vec2 uv = d.xz / (max(y, 0.0) + 0.18);
            float cl = fbm(uv * 1.1 + vec2(uTime * 0.012, uTime * 0.007));
            float cl2 = fbm3(uv * 2.7 - vec2(uTime * 0.02, 0.0));
            float cover = smoothstep(0.35, 0.75, cl * 0.75 + cl2 * 0.35);
            vec3 cloudCol = mix(vec3(0.05, 0.035, 0.035), vec3(0.34, 0.08, 0.03), (1.0 - smoothstep(0.0, 0.45, y)) * cl2);
            cloudCol += doom * vec3(0.5, 0.1, 0.02);
            cloudCol += uFlash * vec3(0.55, 0.5, 0.75) * cl2;
            c = mix(c, cloudCol, cover * smoothstep(-0.02, 0.08, y));
            c = mix(uFog, c, smoothstep(-0.05, 0.1, y));
            gl_FragColor = vec4(c, 1.0);
          }`,
      })
    ));
    sky.renderOrder = -10;
    sky.frustumCulled = false;

    // The storm wheels around the tower: a cloud vortex high above the Eye,
    // lit orange by it from below.
    const vortexUniforms = { uTime: { value: 0 }, uFlash: { value: 0 }, uEye: { value: 1 } };
    const vortex = add(new THREE.Mesh(
      new THREE.CircleGeometry(620, 64),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
        uniforms: vortexUniforms,
        vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: GLSL_NOISE + `
          uniform float uTime, uFlash, uEye; varying vec2 vP;
          void main() {
            float r = length(vP);
            float a = atan(vP.y, vP.x);
            float swirl = a + 160.0 / (r + 60.0) + uTime * 0.035;
            vec2 q = vec2(cos(swirl), sin(swirl)) * r * 0.012;
            float n = fbm(q + vec2(0.0, uTime * 0.01));
            float arms = 0.5 + 0.5 * sin(a * 3.0 + 60.0 / (r * 0.05 + 1.0) - uTime * 0.05);
            float dens = smoothstep(0.3, 0.8, n * 0.8 + arms * 0.3) * (1.0 - smoothstep(380.0, 620.0, r));
            dens *= smoothstep(14.0, 70.0, r);   // an eye in the storm right above the tower
            vec3 col = vec3(0.05, 0.035, 0.035);
            col += vec3(0.45, 0.12, 0.02) * uEye * exp(-r / 90.0) * (0.4 + n);
            col += vec3(0.35, 0.33, 0.5) * uFlash * n;
            gl_FragColor = vec4(col, dens * 0.92);
          }`,
      })
    ));
    vortex.rotation.x = Math.PI / 2;
    vortex.position.y = 150;
    vortex.renderOrder = -5;

    // ---------------------------------------------------------------- lava
    const lavaUniforms = {
      uTime: { value: 0 },
      uFog: { value: FOG_COLOR },
      uFogDensity: { value: FOG_DENSITY },
      uGazePhi: { value: 0 },
      uGazeInt: { value: 0 },
      uHalfW: { value: course.GAZE.halfWidth },
    };
    const lava = add(new THREE.Mesh(
      new THREE.CircleGeometry(1500, 72),
      new THREE.ShaderMaterial({
        uniforms: lavaUniforms,
        vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: GLSL_NOISE + `
          uniform float uTime, uFogDensity, uGazePhi, uGazeInt, uHalfW;
          uniform vec3 uFog;
          varying vec3 vW;
          void main() {
            vec2 p = vW.xz;
            float r = length(p);
            vec2 flow = vec2(uTime * 0.25, uTime * 0.12);
            float n = fbm(p * 0.022 + flow * 0.05);
            float n2 = fbm(p * 0.055 - flow * 0.12 + n * 2.0);
            float crack = 1.0 - smoothstep(0.0, 0.03, abs(n2 - 0.5));
            float far = smoothstep(120.0, 520.0, length(vW - cameraPosition));
            crack *= 1.0 - 0.75 * far;
            float pool = smoothstep(0.62, 0.82, n);
            float pulse = 0.8 + 0.2 * sin(uTime * 1.3 + n * 12.0);
            vec3 crust = vec3(0.045, 0.02, 0.016) * (0.6 + n);
            vec3 col = crust;
            col += vec3(1.25, 0.24, 0.025) * crack * pulse;
            col += vec3(0.8, 0.14, 0.015) * pool * (0.5 + 0.5 * n2) * (1.0 - 0.6 * far);
            // hotter where the tower meets the lake
            col += vec3(1.1, 0.22, 0.02) * exp(-max(0.0, r - 28.0) / 12.0) * (0.5 + n2);
            // the Eye's gaze scorches the lake where it sweeps
            float d = abs(mod(atan(p.y, p.x) - uGazePhi + 3.14159265, 6.2831853) - 3.14159265);
            float beam = (1.0 - smoothstep(uHalfW * 0.6, uHalfW * 1.4, d)) * smoothstep(12.0, 30.0, r) * (1.0 - smoothstep(90.0, 200.0, r));
            col += vec3(2.4, 0.25, 0.05) * beam * uGazeInt;
            float dist = length(vW - cameraPosition);
            float f = 1.0 - exp(-pow(uFogDensity * dist * 0.8, 2.0));
            col = mix(col, uFog * 1.4, f);
            gl_FragColor = vec4(col, 1.0);
          }`,
      })
    ));
    lava.rotation.x = -Math.PI / 2;
    lava.position.y = LAVA_Y;

    // ---------------------------------------------------------------- mountains
    // Two rings of jagged black ridges, the far one hazier.
    function ridgeRing(radius, base, amp, seed, colBot, colTop, segs) {
      const pos = [], col = [];
      const cb = new THREE.Color(colBot), ct = new THREE.Color(colTop);
      const heights = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * TAU;
        const u = (i % segs) / segs * 40;
        let h = base + amp * (0.55 * vnoise(u * 0.7, seed) + 0.3 * vnoise(u * 2.3, seed + 5) + 0.15 * vnoise(u * 7.1, seed + 9));
        h += (hash2(i, seed) - 0.5) * amp * 0.12;           // jagged teeth
        heights.push([a, h]);
      }
      for (let i = 0; i < segs; i++) {
        const [a0, h0] = heights[i], [a1, h1] = heights[i + 1];
        const p = (a, h) => [Math.cos(a) * radius, h, Math.sin(a) * radius];
        const b0 = p(a0, LAVA_Y - 4), b1 = p(a1, LAVA_Y - 4), t0 = p(a0, h0), t1 = p(a1, h1);
        pos.push(...b0, ...t0, ...b1, ...b1, ...t0, ...t1);
        col.push(...cb.toArray(), ...ct.toArray(), ...cb.toArray(), ...cb.toArray(), ...ct.toArray(), ...ct.toArray());
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
      return m;
    }
    add(ridgeRing(1100, 60, 230, 3, 0x1a0b08, 0x3a1a14, 240));
    add(ridgeRing(800, 20, 170, 11, 0x0b0605, 0x150a08, 300));

    // Mount Doom, smouldering on the horizon ahead of the start line.
    {
      const dir = skyUniforms.uDoom.value;
      const g = new THREE.ConeGeometry(170, 230, 64, 10, true);
      const posA = g.attributes.position;
      const colors = [];
      const v = new THREE.Vector3();
      for (let i = 0; i < posA.count; i++) {
        v.fromBufferAttribute(posA, i);
        const a = Math.atan2(v.z, v.x);
        const hN = (v.y + 115) / 230;                        // 0 base .. 1 top
        const jag = (vnoise(a * 6, hN * 5) - 0.5) * 22 * (1 - hN * 0.6);
        const rr = Math.hypot(v.x, v.z);
        if (rr > 0.01) { v.x += (v.x / rr) * jag; v.z += (v.z / rr) * jag; }
        if (hN > 0.97) v.y -= 10;                            // the crater
        posA.setXYZ(i, v.x, v.y, v.z);
        // a lava river down the flank facing the tower
        const toward = Math.cos(angleDiff(a, Math.atan2(-dir.z, -dir.x)) * 5 + vnoise(hN * 8, 2) * 1.5);
        const river = Math.max(0, toward - 0.9) * 10 * (hN > 0.25 ? 1 : 0);
        const glowTop = Math.pow(Math.max(0, hN - 0.8) / 0.2, 2);
        colors.push(0.05 + 2.8 * river + 2.2 * glowTop, 0.022 + 0.55 * river + 0.4 * glowTop, 0.018 + 0.05 * river);
      }
      g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      g.computeVertexNormals();
      const doom = add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));
      const dist = 700;
      doom.position.set(dir.x * dist, LAVA_Y + 100, dir.z * dist);
      const crater = add(new THREE.Sprite(new THREE.SpriteMaterial({
        map: track(glowTexture(THREE)), color: new THREE.Color(3.0, 0.7, 0.12),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      })));
      crater.position.set(dir.x * dist, LAVA_Y + 210, dir.z * dist);
      crater.scale.set(170, 110, 1);
    }

    // ---------------------------------------------------------------- tower
    const iron = track(new THREE.MeshStandardMaterial({
      color: 0x1b1819, metalness: 0.72, roughness: 0.42, flatShading: true,
      side: THREE.DoubleSide,
    }));
    const ironDark = track(new THREE.MeshStandardMaterial({
      color: 0x100e0f, metalness: 0.6, roughness: 0.55, flatShading: true, side: THREE.DoubleSide,
    }));
    // Iron facing the Eye glows with its fire, strongest close by: the inner
    // faces of the horns burn orange as in the film.
    const eyeGlow = {
      uEyeView: { value: new THREE.Vector3() },
      uGlow: { value: new THREE.Color(1.7, 0.48, 0.07) },
      uGlowPower: { value: 1 },
    };
    const glowChunk = `#include <emissivemap_fragment>
      {
        vec3 toEye = uEyeView + vViewPosition;
        float d = length(toEye);
        float ndl = max(dot(normal, toEye / d), 0.0);
        totalEmissiveRadiance += uGlow * uGlowPower * ndl * ndl * exp(-d / 7.5);
      }`;
    for (const m of [iron, ironDark]) {
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, eyeGlow);
        sh.fragmentShader = "uniform vec3 uEyeView; uniform vec3 uGlow; uniform float uGlowPower;\n" +
          sh.fragmentShader.replace("#include <emissivemap_fragment>", glowChunk);
      };
    }
    const rock = track(new THREE.MeshStandardMaterial({
      color: 0x1f1512, metalness: 0.1, roughness: 0.95, flatShading: true,
    }));

    const bridgePhi = SUMMIT.bridgePhi;
    const nearBridge = (th, y) => y > 33 && Math.abs(angleDiff(th, bridgePhi)) < 0.32;
    const nearHorn = (th) => SUMMIT.hornPhi.some((h) => Math.abs(angleDiff(th, h)) < 0.3);
    const R = (y) => course.towerRadiusAt(y);

    // The Dark Tower of ARK. Four faces each carry a column of great burning
    // Ark emblems, and between the faces hang the tower's war banners. The
    // azimuths sit in the gaps between the buttress fins (fins stand at
    // 7.4 + 30k and 22.4 + 30k degrees; banners hang at the low first rank,
    // which is tucked into the wall by then). Spikes and windows keep clear.
    const DEG = Math.PI / 180;
    const FACES = [82.4, 172.4, 262.4, 352.4].map((d) => d * DEG);     // 82.4 faces the start plaza
    const EMBLEMS = [];
    for (const phi of FACES) {
      EMBLEMS.push({ phi, y: 4.5, r: 4.2, out: 3.3 });
      EMBLEMS.push({ phi, y: 19.5, r: 3.3, out: 3.1 });
      // the top one would crowd the summit bridge on that face
      if (Math.abs(angleDiff(phi, bridgePhi)) > 0.5) EMBLEMS.push({ phi, y: 31.5, r: 2.5, out: 3.0 });
    }
    const BANNERS = [];
    for (const phi of FACES) {
      for (const [top, bot] of [[33.6, 26.2], [24.6, 16.2], [14.6, 6.4], [4.6, -0.5]]) {
        BANNERS.push({ phi: phi + 45 * DEG, top, bot, w: 4.0, out: 2.35 });
      }
    }
    function inBrand(th, y, margin) {
      const arc = R(y) + 2;
      for (const e of EMBLEMS) {
        if (Math.abs(y - e.y) < e.r + margin && Math.abs(angleDiff(th, e.phi)) * arc < e.r + margin) return true;
      }
      for (const b of BANNERS) {
        if (y > b.bot - margin && y < b.top + margin && Math.abs(angleDiff(th, b.phi)) * arc < b.w / 2 + margin) return true;
      }
      return false;
    }

    // Body: a ribbed, faceted spire. 18 sharp major ribs, fine ribs between,
    // a little noise so no two faces catch the light the same way.
    function ribAt(th, y) {
      const u = ((th / TAU) * 18) % 1;
      const tri = 1 - Math.abs(2 * u - 1);
      const u2 = ((th / TAU) * 54 + 0.5) % 1;
      const tri2 = 1 - Math.abs(2 * u2 - 1);
      let r = 1.9 * Math.pow(tri, 4) + 0.35 * tri2 * tri2;
      r += (vnoise(th * 9, y * 0.35) - 0.5) * 0.5;
      if (nearBridge(th, y)) r *= 0.2;
      return r;
    }

    function towerBody() {
      const NA = 144, NY = 84;
      const y0 = LAVA_Y - 3, y1 = SUMMIT.y - 0.02;
      const pos = [];
      const idx = [];
      for (let j = 0; j <= NY; j++) {
        const y = y0 + (y1 - y0) * (j / NY);
        for (let i = 0; i <= NA; i++) {
          const th = (i / NA) * TAU;
          const r = R(y) + ribAt(th, y) * (y > y1 - 0.5 ? 0.6 : 1);
          pos.push(Math.cos(th) * r, y, Math.sin(th) * r);
        }
      }
      const row = NA + 1;
      for (let j = 0; j < NY; j++) {
        for (let i = 0; i < NA; i++) {
          const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      // cap the top so nothing shows inside from the air
      const centre = pos.length / 3;
      pos.push(0, y1, 0);
      const topRow = NY * row;
      for (let i = 0; i < NA; i++) idx.push(centre, topRow + i + 1, topRow + i);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      return g.toNonIndexed();
    }

    // Battlement tiers: a corbelled band that steps out from the wall.
    function band(yb) {
      const r0 = R(yb - 2.2), r1 = R(yb) + 1.55;
      const pts = [
        new THREE.Vector2(r0 - 0.4, yb - 2.2),
        new THREE.Vector2(r1 - 0.5, yb - 0.5),
        new THREE.Vector2(r1, yb - 0.25),
        new THREE.Vector2(r1, yb + 0.55),
        new THREE.Vector2(R(yb + 0.6) + 0.3, yb + 0.6),
      ];
      const g = new THREE.LatheGeometry(pts, 96);
      return g.toNonIndexed();
    }

    // Buttress fins: triangles in the radial plane, thickened sideways.
    function fin(th, yBot, yTop, out, width) {
      const c = Math.cos(th), s = Math.sin(th);
      const tx = -s, tz = c;
      const inB = R(yBot) - 1, outB = R(yBot) + out, inT = R(yTop) - 0.3;
      const P = (r, y, w) => [c * r + tx * w, y, s * r + tz * w];
      const wb = width / 2, wt = width * 0.12;
      const A = P(inB, yBot, -wb), B = P(outB, yBot, -wb * 0.6), C = P(inT, yTop, -wt);
      const A2 = P(inB, yBot, wb), B2 = P(outB, yBot, wb * 0.6), C2 = P(inT, yTop, wt);
      const E = P(outB + 0.2, yBot, 0);                     // sharp outer edge
      const Et = P(inT + 0.6, yTop - 0.4, 0);
      const tris = [
        A, B, C, A2, C2, B2,                                 // sides
        B, E, Et, B, Et, C, B2, C2, Et, B2, Et, E,           // bevelled outer edge
      ];
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
      return g;
    }

    const bodyParts = [towerBody()];
    for (const yb of [-6, 5, 15, 25, 34]) bodyParts.push(band(yb));
    {
      const rnd = rand(7);
      // great buttresses rooted in the crag
      for (let i = 0; i < 12; i++) {
        const th = (i / 12) * TAU + 0.13;
        bodyParts.push(fin(th, LAVA_Y - 2, 14 + rnd() * 6, 3.7, 2.8));
      }
      // a second rank higher up, between the first
      for (let i = 0; i < 12; i++) {
        const th = ((i + 0.5) / 12) * TAU + 0.13;
        bodyParts.push(fin(th, 6, 28 + rnd() * 4, 3.0, 1.9));
      }
      // and slim ones climbing to the top, clear of the bridge and horns
      for (let i = 0; i < 16; i++) {
        const th = (i / 16) * TAU + 0.05;
        if (nearBridge(th, 40) || nearHorn(th)) continue;
        bodyParts.push(fin(th, 22, 39.6, 2.3, 1.2));
      }
    }
    const bodyGeo = mergeGeometries(bodyParts.map((g) => {
      g.deleteAttribute("normal"); g.deleteAttribute("uv");
      return g;
    }), false);
    bodyParts.forEach((g) => g.dispose());
    bodyGeo.computeVertexNormals();
    const tower = add(new THREE.Mesh(track(bodyGeo), iron));
    void tower;

    // Pinnacles: lesser spires clinging to the upper tower and rising past the
    // deck around its rim, the jagged crown of Barad-dur. They lean in with the
    // taper and keep clear of the bridge and the horns.
    {
      const rnd = rand(53);
      const parts = [];
      const spire = (th, y0, y1, r0, w) => {
        const r1 = Math.max(course.towerRadiusAt(y1) + 1.2, 10.2);
        const g = new THREE.CylinderGeometry(0.02, w, y1 - y0, 5, 1);
        // lean: shear the top towards the axis to follow the taper
        const pa = g.attributes.position;
        for (let i = 0; i < pa.count; i++) {
          const yl = pa.getY(i) + (y1 - y0) / 2;             // 0 .. height
          const k = yl / (y1 - y0);
          pa.setX(i, pa.getX(i) + (r1 - r0) * k);
        }
        g.translate(r0, (y0 + y1) / 2, 0);
        g.rotateY(-th);
        return g.toNonIndexed();
      };
      for (let i = 0; i < 26; i++) {
        const th = (i / 26) * TAU + rnd() * 0.12;
        const tall = i % 2 === 0;
        const y1 = tall ? 47 + rnd() * 8 : 37 + rnd() * 5;
        if (nearHorn(th)) continue;
        if (Math.abs(angleDiff(th, bridgePhi)) < 0.42) continue;
        const y0 = tall ? 24 + rnd() * 6 : 14 + rnd() * 8;
        parts.push(spire(th, y0, y1, course.towerRadiusAt(y0) + 1.4, tall ? 1.5 : 1.0));
      }
      parts.forEach((g) => { g.deleteAttribute("normal"); g.deleteAttribute("uv"); });
      const g = mergeGeometries(parts, false);
      parts.forEach((p) => p.dispose());
      g.computeVertexNormals();
      add(new THREE.Mesh(track(g), iron));
    }

    // The crag the tower grows out of.
    {
      const g = new THREE.CylinderGeometry(23.5, 32, 16, 48, 5, true);
      const p = g.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const a = Math.atan2(v.z, v.x);
        const rr = Math.hypot(v.x, v.z);
        const k = 1 + (vnoise(a * 5, v.y * 0.3) - 0.5) * 0.12;
        const lim = R(v.y + LAVA_Y + 5) + 3.8;               // stay inside the clearance
        const nr = Math.min(rr * k, lim);
        v.x = (v.x / rr) * nr; v.z = (v.z / rr) * nr;
        p.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      const crag = add(new THREE.Mesh(track(g.toNonIndexed()), rock));
      crag.geometry.computeVertexNormals();
      crag.position.y = LAVA_Y + 5;
    }

    // Merlons along each battlement.
    {
      const tiers = [-6, 5, 15, 25, 34];
      const mats = [];
      for (const yb of tiers) {
        const r = R(yb) + 1.35;
        const n = Math.floor((TAU * r) / 2.1);
        for (let i = 0; i < n; i++) {
          const th = (i / n) * TAU;
          if (nearBridge(th, yb + 1)) continue;
          mats.push({ th, r, y: yb + 1.05, h: 1.0 + (i % 3 === 0 ? 0.8 : 0) });
        }
      }
      const g = new THREE.BoxGeometry(1.0, 1, 0.55);
      const inst = add(new THREE.InstancedMesh(track(g), iron, mats.length));
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      mats.forEach((it, i) => {
        q.setFromAxisAngle(up, -it.th + Math.PI / 2);
        ps.set(Math.cos(it.th) * it.r, it.y + (it.h - 1) / 2, Math.sin(it.th) * it.r);
        sc.set(1, it.h, 1);
        m.compose(ps, q, sc);
        inst.setMatrixAt(i, m);
      });
    }

    // Spikes: iron thorns jutting out and up all over the tower and the horns.
    const spikeList = [];
    {
      const rnd = rand(19);
      for (let i = 0; i < 300; i++) {
        const y = -8 + rnd() * 46;
        const th = rnd() * TAU;
        if (nearBridge(th, y + 3)) continue;
        if (inBrand(th, y, 1.6)) continue;
        const base = R(y) + 0.6;
        const tilt = 0.35 + rnd() * 0.75;                    // radians above horizontal
        let len = 1.4 + rnd() * 2.8;
        len = Math.min(len, (4 - 0.8) / Math.cos(tilt));     // stay inside the clearance
        spikeList.push({ p: [Math.cos(th) * base, y, Math.sin(th) * base], th, tilt, len, w: 0.22 + rnd() * 0.25 });
      }
      // a jagged crown of spikes around the rim of the top, outside the deck
      for (let i = 0; i < 44; i++) {
        const th = (i / 44) * TAU + 0.04;
        if (nearBridge(th, 40) || nearHorn(th)) continue;
        const r = SUMMIT.radius + 0.9;
        spikeList.push({ p: [Math.cos(th) * r, 39.6, Math.sin(th) * r], th, tilt: 1.15 + (i % 2) * 0.25, len: 1.6 + (i % 3) * 0.9, w: 0.35 });
      }
    }

    // ---------------------------------------------------------------- horns
    // The two great prongs: blades that rise from the deck, bow outwards, and
    // hook back in over the Eye, sharp inner edge towards it.
    const hornProfile = [
      [8.3, 38.5], [8.45, 44], [9.6, 50], [11.6, 56], [12.6, 62], [12.1, 67.5], [10.4, 72.2], [8.0, 75.8], [5.6, 78.0],
    ];
    function hornGeometry(phi) {
      const dir = new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi));
      const e = new THREE.Vector3(-Math.sin(phi), 0, Math.cos(phi));
      const curve = new THREE.CatmullRomCurve3(hornProfile.map(([r, y]) => new THREE.Vector3(dir.x * r, y, dir.z * r)));
      const STEPS = 56;
      // cross-section: sharp inner edge (+N, towards the Eye), rounded back
      const sec = [[1.35, 0], [0.55, 0.75], [-0.35, 0.95], [-1, 0.45], [-1.05, 0], [-1, -0.45], [-0.35, -0.95], [0.55, -0.75]];
      const rings = [];
      const T = new THREE.Vector3(), N = new THREE.Vector3(), P = new THREE.Vector3();
      for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        curve.getPointAt(t, P);
        curve.getTangentAt(t, T);
        N.crossVectors(e, T).normalize();                    // inward, towards the axis
        // slim where it stands on the deck (the collidable base), then a broad
        // blade that tapers to a hooked point
        const swell = Math.sin(Math.min(1, t / 0.5) * Math.PI / 2);
        const a = (1.75 + 1.35 * swell) * Math.pow(1 - t, 0.75) + 0.03;   // across (radial) half-thickness
        const b = (1.3 + 0.55 * swell) * Math.pow(1 - t, 0.6) + 0.03;     // front-to-back half-depth
        const ring = sec.map(([sx, sy]) => [
          P.x + N.x * sx * a + e.x * sy * b,
          P.y + N.y * sx * a + e.y * sy * b,
          P.z + N.z * sx * a + e.z * sy * b,
        ]);
        rings.push({ ring, P: P.clone(), N: N.clone(), T: T.clone(), a, t });
      }
      const pos = [];
      for (let i = 0; i < STEPS; i++) {
        const r0 = rings[i].ring, r1 = rings[i + 1].ring;
        for (let k = 0; k < sec.length; k++) {
          const k2 = (k + 1) % sec.length;
          pos.push(...r0[k], ...r1[k], ...r0[k2], ...r0[k2], ...r1[k], ...r1[k2]);
        }
      }
      const tip = rings[STEPS].P.clone().addScaledVector(rings[STEPS].T, 1.4);
      const last = rings[STEPS].ring;
      for (let k = 0; k < sec.length; k++) pos.push(...last[k], ...tip.toArray(), ...last[(k + 1) % sec.length]);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      // thorns along the outer back of the blade, pointing out and up
      for (let i = 8; i < STEPS - 4; i += 4) {
        const rg = rings[i];
        const outward = rg.N.clone().multiplyScalar(-1);
        const p = rg.P.clone().addScaledVector(outward, rg.a * 0.95);
        spikeList.push({ p: p.toArray(), dirV: outward.clone().multiplyScalar(0.75).add(new THREE.Vector3(0, 0.66, 0)).normalize(), len: 1.2 + (1 - rg.t) * 1.8, w: 0.3 });
      }
      return g;
    }
    const hornGeo = mergeGeometries(SUMMIT.hornPhi.map(hornGeometry), false);
    add(new THREE.Mesh(track(hornGeo), iron));
    // heavy sockets the horns are bolted into, around the collidable bases
    {
      const parts = SUMMIT.hornPhi.map((phi) => {
        const g = new THREE.CylinderGeometry(2.25, 2.7, 3.2, 8);
        g.translate(Math.cos(phi) * SUMMIT.hornRing, SUMMIT.y + 0.4, Math.sin(phi) * SUMMIT.hornRing);
        return g.toNonIndexed();
      });
      parts.forEach((g) => { g.deleteAttribute("normal"); g.deleteAttribute("uv"); });
      const g = mergeGeometries(parts, false);
      g.computeVertexNormals();
      add(new THREE.Mesh(track(g), ironDark));
    }

    // build every spike as one instanced mesh
    {
      const g = new THREE.ConeGeometry(1, 1, 5);
      g.translate(0, 0.5, 0);                                  // base at the origin
      const inst = add(new THREE.InstancedMesh(track(g), iron, spikeList.length));
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
      spikeList.forEach((sp, i) => {
        if (sp.dirV) d.copy(sp.dirV);
        else d.set(Math.cos(sp.th) * Math.cos(sp.tilt), Math.sin(sp.tilt), Math.sin(sp.th) * Math.cos(sp.tilt));
        q.setFromUnitVectors(up, d.normalize());
        ps.fromArray(sp.p);
        sc.set(sp.w, sp.len, sp.w);
        m.compose(ps, q, sc);
        inst.setMatrixAt(i, m);
      });
    }

    // Burning windows: slits of furnace light in the black walls.
    {
      const rnd = rand(41);
      const list = [];
      for (let i = 0; i < 90; i++) {
        const y = -4 + rnd() * 41;
        const k = Math.floor(rnd() * 18);
        const th = ((k + 0.5) / 18) * TAU;                     // in the valleys between ribs
        if (nearBridge(th, y) || inBrand(th, y, 0.3)) continue;
        list.push({ th, y, r: R(y) + 0.28, h: 0.9 + rnd() * 1.4 });
      }
      const g = new THREE.BoxGeometry(0.34, 1, 0.3);
      const mat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 0.9, 0.18), fog: true }));
      const inst = add(new THREE.InstancedMesh(track(g), mat, list.length));
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      list.forEach((w, i) => {
        q.setFromAxisAngle(up, -w.th + Math.PI / 2);
        ps.set(Math.cos(w.th) * w.r, w.y, Math.sin(w.th) * w.r);
        sc.set(1, w.h, 1);
        m.compose(ps, q, sc);
        inst.setMatrixAt(i, m);
      });
    }

    // ---------------------------------------------------------------- ARK branding
    // Emblems: the correct Ark logo (same burning-rim shader as the pupil) in a
    // red-hot spiked iron frame, floodlit by an orange halo on the wall. All
    // emblems share three merged meshes. Banners: one merged, waving mesh.
    const brandUniforms = { uMap: { value: arkTexture(THREE) }, uTime: { value: 0 }, uPower: { value: 0.92 } };
    const bannerUniforms = { uTime: { value: 0 } };
    {
      const logoGeos = [], frameGeos = [], haloGeos = [];
      const dummy = new THREE.Object3D();
      for (const e of EMBLEMS) {
        const rr = R(e.y) + e.out;
        const c = Math.cos(e.phi), s = Math.sin(e.phi);
        const lean = (R(e.y - 2) - R(e.y + 2)) / 4;          // the wall leans in as it climbs
        dummy.position.set(c * rr, e.y, s * rr);
        dummy.lookAt(c * (rr + 1), e.y + lean, s * (rr + 1));
        dummy.updateMatrix();
        const logoG = new THREE.CircleGeometry(e.r, 72);
        logoG.applyMatrix4(dummy.matrix);
        logoGeos.push(logoG);
        const ring = new THREE.TorusGeometry(e.r + 0.22, 0.2 + e.r * 0.05, 8, 56);
        ring.translate(0, 0, -0.06);
        const parts = [ring];
        const n = 12;
        for (let i = 0; i < n; i++) {                        // iron thorns round the frame
          const a = (i / n) * TAU + TAU / 24;
          const len = (i % 2 ? 0.9 : 1.6) * (0.55 + e.r * 0.12);
          const sp = new THREE.ConeGeometry(0.22 + e.r * 0.02, len, 5);
          sp.translate(0, len / 2, 0);
          sp.rotateZ(a - Math.PI / 2);
          sp.translate(Math.cos(a) * (e.r + 0.3), Math.sin(a) * (e.r + 0.3), -0.1);
          parts.push(sp);
        }
        for (const p of parts) {
          p.deleteAttribute("uv");
          p.applyMatrix4(dummy.matrix);
          frameGeos.push(p.toNonIndexed());
          p.dispose();
        }
        const halo = new THREE.PlaneGeometry(e.r * 3.4, e.r * 3.4);
        halo.translate(0, 0, -0.3);
        halo.applyMatrix4(dummy.matrix);
        haloGeos.push(halo);
      }
      const logos = add(new THREE.Mesh(track(mergeGeometries(logoGeos, false)), track(new THREE.ShaderMaterial({
        uniforms: brandUniforms, vertexShader: FIRE_VERT, fragmentShader: LOGO_FRAG,
        transparent: true, fog: false,
      }))));
      logos.renderOrder = 2;
      const hotIron = track(new THREE.MeshStandardMaterial({
        color: 0x2a1510, metalness: 0.6, roughness: 0.45, flatShading: true,
        emissive: new THREE.Color(1.0, 0.26, 0.03), emissiveIntensity: 0.55,
      }));
      const frameGeo = mergeGeometries(frameGeos, false);
      frameGeo.computeVertexNormals();
      add(new THREE.Mesh(track(frameGeo), hotIron));
      const halos = add(new THREE.Mesh(track(mergeGeometries(haloGeos, false)), track(new THREE.MeshBasicMaterial({
        map: track(glowTexture(THREE)), color: new THREE.Color(0.95, 0.3, 0.04),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }))));
      halos.renderOrder = 1;
      logoGeos.concat(frameGeos, haloGeos).forEach((g) => g.dispose());

      // war banners, leaning with the wall, waving from the hem
      const bGeos = [];
      BANNERS.forEach((b, bi) => {
        const len = b.top - b.bot;
        const rTop = R(b.top) + b.out, rBot = R(b.bot) + b.out;
        const rMid = (rTop + rBot) / 2, yMid = (b.top + b.bot) / 2;
        const lean = (rBot - rTop) / len;
        const c = Math.cos(b.phi), s = Math.sin(b.phi);
        dummy.position.set(c * rMid, yMid, s * rMid);
        dummy.lookAt(c * (rMid + 1), yMid + lean, s * (rMid + 1));
        dummy.updateMatrix();
        const g = new THREE.PlaneGeometry(b.w, len, 2, 12);
        const uv = g.attributes.uv;
        const hang = new Float32Array(uv.count), phase = new Float32Array(uv.count);
        for (let i = 0; i < uv.count; i++) { hang[i] = 1 - uv.getY(i); phase[i] = bi * 1.7; }
        g.setAttribute("aHang", new THREE.BufferAttribute(hang, 1));
        g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
        g.applyMatrix4(dummy.matrix);
        bGeos.push(g);
      });
      const bannerTex = track(bannerTexture(THREE, arkTexture(THREE)));
      const bannerMat = track(new THREE.MeshStandardMaterial({
        map: bannerTex, emissiveMap: bannerTex, emissive: 0xffffff, emissiveIntensity: 0.3,
        roughness: 0.85, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5,
      }));
      bannerMat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = bannerUniforms.uTime;
        sh.vertexShader = "uniform float uTime;\nattribute float aHang;\nattribute float aPhase;\n" +
          sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
            transformed += objectNormal * sin(uTime * 1.6 + aPhase + aHang * 3.2) * 0.22 * aHang;`);
      };
      add(new THREE.Mesh(track(mergeGeometries(bGeos, false)), bannerMat));
      bGeos.forEach((g) => g.dispose());
    }

    // ---------------------------------------------------------------- the Eye
    const arkTex = arkTexture(THREE);
    const LOGO_R = 3.5;
    const eyeGroup = add(new THREE.Group());
    eyeGroup.position.copy(EYE);
    const eyeInner = new THREE.Group();                         // the pupil drifts inside the eye
    eyeGroup.add(eyeInner);

    const glowTex = track(glowTexture(THREE));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(1.6, 0.42, 0.07), transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    halo.scale.set(30, 34, 1);
    halo.position.z = -1.2;
    halo.renderOrder = 20;
    eyeGroup.add(halo);

    const eyeUniforms = {
      uTime: { value: 0 }, uPower: { value: 1 }, uLogoR: { value: LOGO_R },
      uSize: { value: new THREE.Vector2(16, 27) }, uPupil: { value: new THREE.Vector2(0, 0) },
    };
    const eyeFire = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 27),
      new THREE.ShaderMaterial({
        uniforms: eyeUniforms, vertexShader: FIRE_VERT, fragmentShader: EYE_FIRE_FRAG,
        transparent: true, depthWrite: false, fog: false,
      })
    );
    eyeFire.position.y = 2.0;                               // shader re-centres by the same 2 m
    eyeFire.renderOrder = 21;
    eyeGroup.add(eyeFire);

    const logoUniforms = { uMap: { value: arkTex }, uTime: { value: 0 }, uPower: { value: 1 } };
    const logo = new THREE.Mesh(
      new THREE.CircleGeometry(LOGO_R, 96),
      new THREE.ShaderMaterial({
        uniforms: logoUniforms, vertexShader: FIRE_VERT, fragmentShader: LOGO_FRAG,
        transparent: true, depthWrite: false, fog: false,
      })
    );
    logo.position.z = 0.12;
    logo.renderOrder = 22;
    eyeInner.add(logo);

    // sparks pouring upward off the Eye, and embers/ash in the air
    const emberUniforms = { uTime: { value: 0 }, uScale: { value: 400 }, uCam: { value: new THREE.Vector3() } };
    function makeEmbers(count, seed, area) {
      const rnd = rand(seed);
      const pos = new Float32Array(count * 3);
      const aSeed = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = (rnd() - 0.5) * area.w;
        pos[i * 3 + 1] = rnd() * area.h;
        pos[i * 3 + 2] = (rnd() - 0.5) * area.w;
        aSeed[i * 4] = rnd(); aSeed[i * 4 + 1] = rnd(); aSeed[i * 4 + 2] = rnd(); aSeed[i * 4 + 3] = rnd();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 4));
      return g;
    }
    const sparks = add(new THREE.Points(makeEmbers(420, 5, { w: 70, h: 110 }), new THREE.ShaderMaterial({
      uniforms: emberUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `
        uniform float uTime, uScale; attribute vec4 aSeed; varying float vA;
        void main() {
          float speed = 2.0 + aSeed.x * 5.0;
          float y = mod(position.y + uTime * speed, 110.0);
          vec3 p = vec3(position.x, ${(LAVA_Y).toFixed(1)} + y, position.z);
          // near the Eye they whirl upward out of the fire
          float swirl = uTime * (0.3 + aSeed.y) + aSeed.z * 6.28;
          p.x += sin(swirl) * (2.0 + aSeed.w * 4.0);
          p.z += cos(swirl) * (2.0 + aSeed.w * 4.0);
          vA = (1.0 - y / 110.0) * (0.5 + 0.5 * sin(uTime * 9.0 + aSeed.x * 40.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (0.18 + aSeed.w * 0.3) * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = (1.0 - smoothstep(0.1, 0.5, d)) * vA;
          gl_FragColor = vec4(vec3(3.0, 0.9, 0.2) * a, a);
        }`,
    })));
    sparks.frustumCulled = false;

    const ashUniforms = { uTime: { value: 0 }, uScale: { value: 400 }, uCam: emberUniforms.uCam };
    const ash = add(new THREE.Points(makeEmbers(1400, 23, { w: 90, h: 90 }), new THREE.ShaderMaterial({
      uniforms: ashUniforms, transparent: true, depthWrite: false, fog: false,
      vertexShader: `
        uniform float uTime, uScale; uniform vec3 uCam; attribute vec4 aSeed; varying float vA;
        void main() {
          vec3 drift = vec3(0.6 + aSeed.x, -0.7 - aSeed.y * 0.8, 0.3) * uTime;
          drift.x += sin(uTime * 0.7 + aSeed.z * 20.0) * 0.8;
          vec3 box = vec3(90.0);
          vec3 p = mod(position + drift - uCam + box * 0.5, box) - box * 0.5 + uCam;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = 0.55 * smoothstep(45.0, 20.0, length(p - uCam));
          gl_PointSize = (0.07 + aSeed.w * 0.08) * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = (1.0 - smoothstep(0.2, 0.5, d)) * vA;
          gl_FragColor = vec4(vec3(0.22, 0.2, 0.2), a);
        }`,
    })));
    ash.frustumCulled = false;

    // ---------------------------------------------------------------- gaze beam
    // A fan of light sheets from the Eye down to the lake along the gaze. Many
    // faint sheets read as a solid wedge of light from any angle.
    // Shelter roofs and walls stop the beam: every beam fragment checks the
    // ray from the Eye to itself against these boxes (yaw-only OBBs).
    const shelterBoxes = course.pieces.filter((p) => p.shelter && p.shape === "box" && /^shw?-/.test(p.id)).slice(0, 16);
    const MAX_BOXES = 16;
    const boxC = [], boxH = [], boxCS = [];
    for (let i = 0; i < MAX_BOXES; i++) {
      const b = shelterBoxes[i];
      boxC.push(b ? new THREE.Vector3().fromArray(b.pos) : new THREE.Vector3(0, -999, 0));
      boxH.push(b ? new THREE.Vector3(b.size[0] / 2 + 0.05, b.size[1] / 2 + 0.05, b.size[2] / 2 + 0.05) : new THREE.Vector3());
      const yaw = b ? b.rot[1] : 0;
      boxCS.push(new THREE.Vector2(Math.cos(yaw), Math.sin(yaw)));
    }
    const beamUniforms = {
      uTime: { value: 0 }, uInt: { value: 0 },
      uEye: { value: EYE.clone() },
      uBoxC: { value: boxC }, uBoxH: { value: boxH }, uBoxCS: { value: boxCS },
      uBoxN: { value: shelterBoxes.length },
    };
    let beam;
    {
      const hw = course.GAZE.halfWidth;
      const SHEETS = 9, ARC = 22;
      const b0 = (28 * Math.PI) / 180, b1 = (62 * Math.PI) / 180;
      const drop = EYE.y - LAVA_Y;
      const pos = [], at = [], ae = [], ab = [];
      for (let k = 0; k < SHEETS; k++) {
        const alpha = -hw + (2 * hw * k) / (SHEETS - 1);
        const edge = Math.abs(alpha) / hw;
        for (let i = 0; i < ARC; i++) {
          const pts = [i, i + 1].map((j) => {
            const beta = b0 + ((b1 - b0) * j) / ARC;
            const L = Math.min(170, drop / Math.sin(beta));
            return {
              p: [Math.cos(beta) * Math.cos(alpha) * L, -Math.sin(beta) * L, Math.cos(beta) * Math.sin(alpha) * L],
              b: j / ARC,
            };
          });
          pos.push(0, 0, 0, ...pts[0].p, ...pts[1].p);
          at.push(0, 1, 1);
          ae.push(edge, edge, edge);
          ab.push(0.5, pts[0].b, pts[1].b);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("aT", new THREE.Float32BufferAttribute(at, 1));
      g.setAttribute("aEdge", new THREE.Float32BufferAttribute(ae, 1));
      g.setAttribute("aB", new THREE.Float32BufferAttribute(ab, 1));
      beam = add(new THREE.Mesh(track(g), track(new THREE.ShaderMaterial({
        uniforms: beamUniforms, transparent: true, depthWrite: false, fog: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        vertexShader: `
          attribute float aT, aEdge, aB; varying float vT, vEdge, vB; varying vec3 vL; varying float vCam;
          varying vec3 vW;
          void main() { vT = aT; vEdge = aEdge; vB = aB; vL = position;
            vW = (modelMatrix * vec4(position, 1.0)).xyz;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vCam = -mv.z;
            gl_Position = projectionMatrix * mv; }`,
        fragmentShader: GLSL_NOISE + `
          uniform float uTime, uInt; varying float vT, vEdge, vB; varying vec3 vL; varying float vCam;
          varying vec3 vW;
          uniform vec3 uEye;
          uniform vec3 uBoxC[${MAX_BOXES}];
          uniform vec3 uBoxH[${MAX_BOXES}];
          uniform vec2 uBoxCS[${MAX_BOXES}];
          uniform int uBoxN;
          // does the segment from the Eye to this point pass through a shelter?
          bool shaded(vec3 p) {
            vec3 d = p - uEye;
            float len = length(d);
            vec3 rd = d / len;
            for (int i = 0; i < ${MAX_BOXES}; i++) {
              if (i >= uBoxN) break;
              vec3 o = uEye - uBoxC[i];
              vec2 cs = uBoxCS[i];
              vec3 lo = vec3(o.x * cs.x - o.z * cs.y, o.y, o.x * cs.y + o.z * cs.x);
              vec3 ld = vec3(rd.x * cs.x - rd.z * cs.y, rd.y, rd.x * cs.y + rd.z * cs.x);
              vec3 inv = 1.0 / (ld + vec3(1e-6));
              vec3 t0 = (-uBoxH[i] - lo) * inv, t1 = (uBoxH[i] - lo) * inv;
              vec3 tn3 = min(t0, t1), tf3 = max(t0, t1);
              float tn = max(max(tn3.x, tn3.y), tn3.z);
              float tf = min(min(tf3.x, tf3.y), tf3.z);
              if (tf > max(tn, 0.0) && tn < len) return true;
            }
            return false;
          }
          void main() {
            if (shaded(vW)) discard;                   // the beam stops at the cover
            float along = length(vL);
            float t = clamp(along / 150.0, 0.0, 1.0);
            float streak = 0.7 + 0.3 * noise(vec2(vB * 14.0, along * 0.08 - uTime * 3.0));
            float a = uInt * (1.0 - 0.75 * vEdge) * smoothstep(0.0, 0.05, t) * pow(1.0 - t, 0.9);
            a *= sin(3.14159 * clamp(vB, 0.0, 1.0)) * 0.85 + 0.15;
            a *= streak;
            // sheets right in front of the camera would stack into a wall of
            // orange when you stand in the beam; fade them out up close
            a *= smoothstep(3.0, 26.0, vCam);
            gl_FragColor = vec4(vec3(2.2, 0.36, 0.07) * a * 0.16, 1.0);
          }`,
      }))));
      beam.position.copy(EYE);
      beam.renderOrder = 15;
    }

    // The client builds the course after us, so adopt its meshes lazily: every
    // standard-material mesh receives the gaze shadow; the ones overlapping a
    // shelter box cast it. Checked every second for the first few seconds.
    const artMeshes = new Set();
    for (const o of added) o.traverse((c) => artMeshes.add(c));
    const shelterAabbs = shelterBoxes.map((b) => {
      const r = Math.hypot(b.size[0], b.size[2]) / 2 + 0.3;
      return new THREE.Box3(
        new THREE.Vector3(b.pos[0] - r, b.pos[1] - b.size[1] / 2 - 0.3, b.pos[2] - r),
        new THREE.Vector3(b.pos[0] + r, b.pos[1] + b.size[1] / 2 + 0.3, b.pos[2] + r));
    });
    const seenMeshes = new WeakSet();
    const tmpBox = new THREE.Box3();
    let adoptTimer = 0, adoptRuns = 0;
    function adoptCourseShadows() {
      scene.traverse((o) => {
        if (!o.isMesh || seenMeshes.has(o) || artMeshes.has(o) || o.isInstancedMesh) return;
        seenMeshes.add(o);
        const m = o.material;
        if (!m || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return;
        if (m.transparent || m.blending === THREE.AdditiveBlending) return;
        o.receiveShadow = true;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        o.updateWorldMatrix(true, false);
        tmpBox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        // big merged strips only cast if they are mostly shelter; small pieces if they touch one
        const size = tmpBox.getSize(new THREE.Vector3());
        if (size.x > 60 || size.z > 60) {
          // a merged batch spanning the course: cast only if its material looks like shelter iron
          o.castShadow = !!(m.color && m.color.getHSL({}).l < 0.2);
        } else {
          o.castShadow = shelterAabbs.some((a) => a.intersectsBox(tmpBox));
        }
      });
    }

    // ---------------------------------------------------------------- post
    const { EffectComposer } = composerMod;
    const { RenderPass } = renderPassMod;
    const { UnrealBloomPass } = bloomMod;
    const { OutputPass } = outputMod;
    const size = renderer.getSize(new THREE.Vector2());
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.42, 1.0);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    function setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      bloom.setSize(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
      emberUniforms.uScale.value = h * renderer.getPixelRatio() * 0.5 * 1.2;
      ashUniforms.uScale.value = emberUniforms.uScale.value;
    }
    setSize(size.x, size.y);

    // ---------------------------------------------------------------- update
    let power = 0.5;
    let flare = 0;
    let lightning = 0, nextLightning = 4 + Math.random() * 6;
    // Every flash on screen gets its thunder (from the shared sound kit, if loaded).
    const thunder = (opts) => {
      try { if (window.PARTY_AUDIO) window.PARTY_AUDIO.play("thunder", opts); } catch (e) { /* silent */ }
    };
    const toEye = new THREE.Vector3();

    function update(dt, rt, gaze, cameraPos) {
      time += dt;
      const g = gaze || course.gazeAt(rt);
      const camPos = cameraPos || camera.position;

      // how hard the Eye is burning right now
      let want = g.active ? 1 : g.warning ? g.intensity : 0.38;
      want += flare;
      power += (want - power) * Math.min(1, dt * (g.warning ? 20 : 4));
      flare = Math.max(0, flare - dt * 0.6);

      // storm lightning, now and then
      nextLightning -= dt;
      if (nextLightning <= 0) {
        lightning = 1;
        // a distant strike: the thunder rolls in a moment later, softer
        thunder({ volume: 0.45 + Math.random() * 0.3, delay: 0.4 + Math.random() * 1.1 });
        nextLightning = 5 + Math.random() * 10;
      }
      lightning = Math.max(0, lightning - dt * 3.2);
      const flash = lightning > 0 ? lightning * (0.6 + 0.4 * Math.sin(lightning * 40)) : 0;

      skyUniforms.uTime.value = time;
      skyUniforms.uFlash.value = flash;
      vortexUniforms.uTime.value = time;
      vortexUniforms.uFlash.value = flash;
      vortexUniforms.uEye.value = 0.5 + power * 0.7;
      hemi.intensity = 1.35 + flash * 1.6;
      sky.position.copy(camPos);

      lavaUniforms.uTime.value = time;
      lavaUniforms.uGazePhi.value = g.phi;
      lavaUniforms.uGazeInt.value = g.active ? 1 : g.warning ? g.intensity * 0.5 : 0;

      // The Eye always faces whoever looks at it, so the Ark in its pupil can
      // always be read; its pupil slides towards where it is actually looking.
      eyeGroup.lookAt(camPos);
      toEye.subVectors(camPos, EYE);
      const camPhi = Math.atan2(toEye.z, toEye.x);
      const off = Math.sin(angleDiff(g.phi, camPhi));           // + to the viewer's left or right
      const facing = Math.cos(angleDiff(g.phi, camPhi));
      const px = -off * 1.3;
      eyeInner.position.x += (px - eyeInner.position.x) * Math.min(1, dt * 5);
      eyeInner.position.y = -0.4 * Math.max(0, facing);
      eyeUniforms.uPupil.value.set(eyeInner.position.x, eyeInner.position.y);
      const stare = g.active && facing > 0.9 ? 0.25 : 0;          // it's looking at you
      eyeUniforms.uTime.value = time;
      eyeUniforms.uPower.value = power + stare;
      logoUniforms.uTime.value = time;
      logoUniforms.uPower.value = power + stare;
      brandUniforms.uTime.value = time;
      brandUniforms.uPower.value = 0.86 + 0.1 * power;
      bannerUniforms.uTime.value = time;
      const pulse = 0.85 + 0.15 * Math.sin(time * 7.3) * Math.sin(time * 3.1);
      halo.material.color.setRGB(0.42 * power * pulse, 0.11 * power * pulse, 0.02 * power);
      eyeLight.intensity = (300 + 520 * power) * pulse;
      camera.updateMatrixWorld();
      eyeGlow.uEyeView.value.copy(EYE).applyMatrix4(camera.matrixWorldInverse);
      eyeGlow.uGlowPower.value = (0.45 + 0.75 * power) * pulse;

      // the beam and the red spot it paints on the course
      beam.rotation.y = -g.phi;
      const bi = g.active ? 1 : g.warning ? g.intensity * 0.55 : 0.04;
      beamUniforms.uInt.value += (bi - beamUniforms.uInt.value) * Math.min(1, dt * (g.warning ? 25 : 6));
      beamUniforms.uTime.value = time;
      spotTarget.position.set(Math.cos(g.phi) * 33, 14, Math.sin(g.phi) * 33);
      spot.intensity = 1600 * beamUniforms.uInt.value;
      spot.visible = beamUniforms.uInt.value > 0.02;
      adoptTimer -= dt;
      if (adoptTimer <= 0 && adoptRuns < 12) { adoptTimer = 1; adoptRuns++; adoptCourseShadows(); }

      emberUniforms.uTime.value = time;
      emberUniforms.uCam.value.copy(camPos);
      ashUniforms.uTime.value = time;
    }

    function flashFn(kind) {
      if (kind === "win") flare = 1.4;
      if (kind === "eye") flare = Math.max(flare, 1.1);          // intro: the Eye flares at the camera
      if (kind === "lightning") { lightning = 1; nextLightning = 4 + Math.random() * 5; thunder({ volume: 1 }); }
    }

    function dispose() {
      for (const o of added) {
        scene.remove(o);
        o.traverse((c) => {
          if (c.geometry) c.geometry.dispose();
          if (c.material) {
            const ms = Array.isArray(c.material) ? c.material : [c.material];
            ms.forEach((m) => m.dispose());
          }
        });
      }
      disposables.forEach((d) => { try { d.dispose(); } catch (e) { /* best effort */ } });
      if (scene.environment) scene.environment = null;
      pmrem.dispose();
      composer.dispose();
      scene.fog = null;
    }

    return {
      _debug: { spot, eyeLight, bloom, key, hemi, beamUniforms },
      update,
      // Adopt the client's course meshes for shadows in one go, before the
      // first frame. Changing shadow flags later recompiles shaders, which
      // stuttered the intro; the periodic check below then has nothing left.
      prepare() { adoptCourseShadows(); adoptRuns = Math.max(adoptRuns, 10); },
      render() { composer.render(); },
      setSize,
      flash: flashFn,
      dispose,
    };
  }

  // ======================================================================
  //                               BEAN
  // ======================================================================
  const beanShared = new WeakMap();
  function beanParts(THREE) {
    if (beanShared.has(THREE)) return beanShared.get(THREE);
    const tex = markTextures_(THREE);
    const s = {
      body: new THREE.CapsuleGeometry(0.45, 0.66, 8, 20),
      face: new THREE.SphereGeometry(1, 20, 14),
      eye: new THREE.SphereGeometry(1, 14, 10),
      helmet: new THREE.SphereGeometry(0.5, 24, 10, 0, TAU, 0, Math.PI * 0.44),
      brim: new THREE.CylinderGeometry(0.535, 0.55, 0.08, 24),
      decal: new THREE.PlaneGeometry(0.24, 0.24),
      strap: new THREE.TorusGeometry(0.465, 0.035, 6, 36),
      badge: new THREE.CircleGeometry(0.105, 24),
      arm: new THREE.CapsuleGeometry(0.11, 0.22, 4, 10),
      leg: new THREE.CapsuleGeometry(0.13, 0.1, 4, 10),
      faceMat: new THREE.MeshStandardMaterial({ color: 0xffe6cf, roughness: 0.6 }),
      whiteMat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }),
      pupilMat: new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.2 }),
      helmetMat: new THREE.MeshStandardMaterial({ color: 0x16161b, roughness: 0.35, metalness: 0.35 }),
      strapMat: new THREE.MeshStandardMaterial({ color: 0x23201f, roughness: 0.7 }),
      decalMat: new THREE.MeshBasicMaterial({ map: tex.decal, transparent: true, depthWrite: false }),
      badgeMat: new THREE.MeshStandardMaterial({ map: tex.badge, roughness: 0.5 }),
      // Norli: a Norli-blue helmet with the white wordmark on a band round it.
      // thetaStart = PI puts u = 0.5 (the big wordmark) on the front, +z.
      band: new THREE.CylinderGeometry(0.452, 0.503, 0.15, 40, 1, true, Math.PI),
      norliHelmetMat: new THREE.MeshStandardMaterial({ color: 0x003190, roughness: 0.32, metalness: 0.3 }),
      norliBandMat: new THREE.MeshStandardMaterial({ map: norliTextures(THREE).band, roughness: 0.45 }),
      norliBadgeMat: new THREE.MeshStandardMaterial({ map: norliTextures(THREE).badge, roughness: 0.5 }),
    };
    s.arm.translate(0, -0.2, 0);                            // hang from the shoulder pivot
    s.leg.translate(0, -0.14, 0);                           // hang from the hip pivot
    beanShared.set(THREE, s);
    return s;
  }

  function buildBean(THREE, opts) {
    const S = beanParts(THREE);
    const norli = !!(opts && opts.team === "norli");
    const color = new THREE.Color((opts && opts.color) || "#ff5fa2");
    const bodyMat = new THREE.MeshStandardMaterial({ color: color.clone(), roughness: 0.5, metalness: 0.0 });
    const limbMat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.8), roughness: 0.55 });
    const CHAR = new THREE.Color(0x2a1a14);

    const group = new THREE.Group();
    const root = new THREE.Group();                          // animated: lean, dive, wobble, squash
    group.add(root);

    const BODY_Y = 0.95;
    const body = new THREE.Mesh(S.body, bodyMat);
    body.position.y = BODY_Y;
    root.add(body);

    const face = new THREE.Mesh(S.face, S.faceMat);
    face.scale.set(0.31, 0.25, 0.1);
    face.position.set(0, 1.24, 0.395);
    root.add(face);
    const eyes = [];
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(S.eye, S.whiteMat);
      e.scale.set(0.085, 0.11, 0.05);
      e.position.set(sx * 0.105, 1.265, 0.48);
      const p = new THREE.Mesh(S.eye, S.pupilMat);
      p.scale.set(0.045, 0.066, 0.03);
      p.position.set(sx * 0.1, 1.255, 0.518);
      root.add(e, p);
      eyes.push(e);
    }

    // the helmet: Bookis black with the pink mark on its front, or Norli blue
    // with the white wordmark on a band round it
    const helmetMat = norli ? S.norliHelmetMat : S.helmetMat;
    const helmet = new THREE.Mesh(S.helmet, helmetMat);
    helmet.position.y = 1.31;
    const brim = new THREE.Mesh(S.brim, helmetMat);
    brim.position.y = 1.31 + 0.5 * Math.cos(Math.PI * 0.44) - 0.02;
    root.add(helmet, brim);
    if (norli) {
      const band = new THREE.Mesh(S.band, S.norliBandMat);
      band.position.y = 1.475;
      root.add(band);
    } else {
      const decal = new THREE.Mesh(S.decal, S.decalMat);
      const da = 0.95;                                      // radians from the crown of the helmet
      decal.position.set(0, 1.31 + 0.507 * Math.cos(da), 0.507 * Math.sin(da));
      decal.rotation.x = -(Math.PI / 2 - da);
      root.add(decal);
    }

    // bandolier strap across the chest, with the Bookis badge on it
    const strapPivot = new THREE.Group();
    strapPivot.position.y = 0.86;
    strapPivot.rotation.z = 0.5;
    const strap = new THREE.Mesh(S.strap, S.strapMat);
    strap.rotation.x = Math.PI / 2;
    strap.scale.set(1.14, 1, 1);
    strapPivot.add(strap);
    root.add(strapPivot);
    const badge = new THREE.Mesh(S.badge, norli ? S.norliBadgeMat : S.badgeMat);
    const ba = -0.42;
    badge.position.set(0.462 * Math.sin(ba), 0.8, 0.462 * Math.cos(ba));
    badge.rotation.y = ba;
    root.add(badge);

    const arms = [], legs = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.44, 1.02, 0);
      const arm = new THREE.Mesh(S.arm, limbMat);
      arm.rotation.z = sx * 0.28;
      pivot.add(arm);
      root.add(pivot);
      arms.push({ pivot, sx });
      const hip = new THREE.Group();
      hip.position.set(sx * 0.19, 0.32, 0);
      hip.add(new THREE.Mesh(S.leg, limbMat));
      root.add(hip);
      legs.push({ hip, sx });
    }

    let phase = 0, wasAir = false, landT = 0, t = 0;
    let diveK = 0, grabK = 0, airK = 0, heldK = 0;
    let blinkT = 2 + Math.random() * 3;

    function update(dt, pose) {
      pose = pose || {};
      t += dt;
      const speed = pose.speed || 0;
      const sp = Math.min(1, speed / 7);
      const air = !!pose.air;
      if (wasAir && !air) landT = 0.2;
      wasAir = air;
      landT = Math.max(0, landT - dt);
      const k = Math.min(1, dt * 12);
      diveK += ((pose.dive ? 1 : 0) - diveK) * k;
      grabK += ((pose.grab ? 1 : 0) - grabK) * k;
      airK += ((air ? 1 : 0) - airK) * k;
      heldK += ((pose.grabbed ? 1 : 0) - heldK) * Math.min(1, dt * 16);
      if (sp > 0.04) phase += dt * (5 + 9 * sp);

      const swing = Math.sin(phase) * 0.95 * sp * (1 - airK) * (1 - heldK);
      const flail = heldK;                                    // held: panic

      // legs: run cycle, tucked in the air, trailing in a dive, kicking when held
      legs.forEach((L, i) => {
        const s = i === 0 ? 1 : -1;
        const normal = swing * s * (1 - diveK) + airK * (i === 0 ? -0.55 : -0.2) * (1 - diveK) + diveK * 0.3;
        L.hip.rotation.x = normal * (1 - flail) + flail * Math.sin(t * 26 + i * Math.PI) * 0.95;
      });
      // arms: swing, flail in the air, clamp forward to grab, stretch ahead in
      // a dive, and thrash straight up when held
      arms.forEach((A, i) => {
        const s = i === 0 ? -1 : 1;
        let x = -swing * s * 0.85;
        x += airK * (-2.3 + Math.sin(t * 16 + i * 1.7) * 0.35) * (1 - grabK);
        x = x * (1 - grabK) + grabK * -Math.PI / 2;
        x = x * (1 - diveK) + diveK * -Math.PI * 0.95;
        x = x * (1 - flail) + flail * (-2.85 + Math.sin(t * 28 + i * 2.4) * 0.55);
        A.pivot.rotation.x = x;
        let z = A.sx * (0.1 + airK * 0.45 * (1 - diveK));
        z = z * (1 - grabK) + grabK * -A.sx * 0.34;          // hands clamped together in front
        z = z * (1 - flail) + flail * A.sx * (0.55 + 0.3 * Math.sin(t * 21 + i * 1.3));
        A.pivot.rotation.z = z;
      });

      // body: bob, lean into the run, dive flat, wobble when knocked
      const stun = pose.stun || 0;
      let sy = 1;
      if (air) sy = Math.max(0.88, Math.min(1.14, 1 + (pose.vy || 0) * 0.016));
      if (landT > 0) sy = 1 - 0.24 * Math.sin((landT / 0.2) * Math.PI);
      sy = sy * (1 - flail) + flail * (0.84 + 0.07 * Math.sin(t * 23));   // squeezed in someone's grip
      const sxz = 1 / Math.sqrt(sy);
      root.scale.set(sxz, sy, sxz);
      root.position.set(
        flail * Math.sin(t * 31) * 0.05,
        Math.abs(Math.sin(phase)) * 0.06 * sp * (1 - airK) + diveK * 0.45 + flail * (0.26 + 0.1 * Math.abs(Math.sin(t * 17))),
        0
      );
      root.rotation.set(
        0.14 * sp * (1 - diveK) + diveK * (Math.PI / 2) + Math.sin(t * 11) * 0.28 * stun
          - 0.14 * grabK * (1 - diveK)                        // leaning back, hauling
          + flail * (-0.22 + Math.sin(t * 9) * 0.16),
        0,
        Math.sin(t * 15) * 0.42 * stun + flail * Math.sin(t * 13) * 0.3
      );

      // scorched by the Eye: char and glowing embers that fade
      const burn = Math.max(0, Math.min(1, pose.burn || 0));
      bodyMat.color.copy(color).lerp(CHAR, burn * 0.75);
      limbMat.color.copy(color).multiplyScalar(0.8).lerp(CHAR, burn * 0.75);
      const glow = burn * (0.8 + 0.4 * Math.sin(t * 25));
      bodyMat.emissive.setRGB(1.2 * glow, 0.32 * glow, 0.04 * glow);
      limbMat.emissive.copy(bodyMat.emissive);

      // blink now and then
      blinkT -= dt;
      const shut = blinkT < 0.12 && blinkT > 0;
      if (blinkT <= 0) blinkT = 2.5 + Math.random() * 3.5;
      for (const e of eyes) {                                // wide-eyed panic when held
        e.scale.x = 0.085 + 0.03 * flail;
        e.scale.y = shut && flail < 0.5 ? 0.015 : 0.11 + 0.05 * flail;
      }
    }

    function dispose() {
      bodyMat.dispose();
      limbMat.dispose();
    }

    update(0, {});
    return { group, update, dispose };
  }

  // ======================================================================
  //                               CROWN
  // ======================================================================
  function buildCrown(THREE) {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    group.add(inner);
    const gold = new THREE.MeshStandardMaterial({
      color: 0xffc23a, metalness: 0.85, roughness: 0.25,
      emissive: new THREE.Color(0.45, 0.2, 0.0), emissiveIntensity: 0.22,
    });
    const ruby = new THREE.MeshStandardMaterial({
      color: 0xff2a3c, metalness: 0.1, roughness: 0.15, emissive: new THREE.Color(0.6, 0.02, 0.05),
    });
    const geos = [];
    const mesh = (g, m) => { geos.push(g); return new THREE.Mesh(g, m); };

    // chunky band with a rolled lip top and bottom
    const band = mesh(new THREE.LatheGeometry([
      new THREE.Vector2(0.72, -0.34), new THREE.Vector2(0.9, -0.34), new THREE.Vector2(0.95, -0.26),
      new THREE.Vector2(0.9, -0.18), new THREE.Vector2(0.94, 0.22), new THREE.Vector2(0.99, 0.3),
      new THREE.Vector2(0.93, 0.36), new THREE.Vector2(0.78, 0.36),
    ], 40), gold);
    inner.add(band);
    // five points, each topped with a ball
    const cone = new THREE.ConeGeometry(0.24, 0.62, 8);
    const ball = new THREE.SphereGeometry(0.12, 12, 8);
    const gem = new THREE.OctahedronGeometry(0.12);
    geos.push(cone, ball, gem);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + Math.PI / 2;
      const c = new THREE.Mesh(cone, gold);
      c.position.set(Math.cos(a) * 0.84, 0.66, Math.sin(a) * 0.84);
      const b = new THREE.Mesh(ball, gold);
      b.position.set(Math.cos(a) * 0.84, 1.02, Math.sin(a) * 0.84);
      inner.add(c, b);
      if (i !== 0) {                                         // rubies round the back
        const j = new THREE.Mesh(gem, ruby);
        const ga = a;
        j.position.set(Math.cos(ga) * 0.97, 0.02, Math.sin(ga) * 0.97);
        j.scale.set(1, 1.3, 0.6);
        j.lookAt(0, 0.02, 0);
        inner.add(j);
      }
    }
    // the Ark logo as the front jewel, set in a gold bezel
    const bezel = mesh(new THREE.TorusGeometry(0.34, 0.06, 8, 32), gold);
    bezel.position.set(0, 0.02, 0.985);
    inner.add(bezel);
    const logoUniforms = { uMap: { value: arkTexture(THREE) }, uTime: { value: 0 }, uPower: { value: 0.9 } };
    const logo = mesh(new THREE.CircleGeometry(0.33, 48), new THREE.ShaderMaterial({
      uniforms: logoUniforms, vertexShader: FIRE_VERT, fragmentShader: LOGO_FRAG, transparent: true,
    }));
    logo.position.set(0, 0.02, 1.0);
    inner.add(logo);

    // wreathed in flame
    const flameUniforms = { uTime: { value: 0 }, uPower: { value: 0.42 } };
    const flameMat = new THREE.ShaderMaterial({
      uniforms: flameUniforms, vertexShader: FIRE_VERT, fragmentShader: FLAME_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const flameGeo = new THREE.PlaneGeometry(2.6, 2.6);
    flameGeo.translate(0, 1.3, 0);
    geos.push(flameGeo);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(flameGeo, flameMat);
      f.position.y = -0.1;
      f.rotation.y = (i / 3) * Math.PI;
      f.renderOrder = 12;
      group.add(f);
    }
    const glowTex = glowTexture(THREE);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(0.32, 0.16, 0.03), transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.scale.set(5, 5, 1);
    glow.renderOrder = 11;
    group.add(glow);
    const light = new THREE.PointLight(0xffa040, 9, 10, 1.8);
    light.position.y = -1.6;                                 // lights the pedestal and whoever reaches for it
    group.add(light);

    let t = 0;
    function update(dt) {
      t += dt;
      inner.rotation.y += dt * 0.9;
      inner.position.y = Math.sin(t * 1.8) * 0.15;
      inner.rotation.z = Math.sin(t * 1.3) * 0.06;
      flameUniforms.uTime.value = t;
      logoUniforms.uTime.value = t;
      const p = 0.9 + 0.1 * Math.sin(t * 9.0) * Math.sin(t * 4.3);
      light.intensity = 9 * p;
    }
    function dispose() {
      geos.forEach((g) => g.dispose());
      gold.dispose(); ruby.dispose(); flameMat.dispose(); glowTex.dispose(); glow.material.dispose();
      logo.material.dispose();
    }
    return { group, update, dispose };
  }

  // ======================================================================
  //                               HOSTAGES
  // ======================================================================
  // Two ARK cages on the summit deck, behind the crown as seen from the
  // bridge: three Bookis soldiers in one, three Norli soldiers in the other,
  // rattling the bars and yelling for help. free() blows the cages apart and
  // the hostages hop out and cheer for the rest of the round.
  function buildHostages(THREE, opts) {
    const course = opts.course;
    const S = course.SUMMIT;
    const group = new THREE.Group();
    const CAGE_R = 1.42, BAR_H = 2.5, BASE_H = 0.24, RING = 6.9;
    const BARS = 14;

    const ironM = new THREE.MeshStandardMaterial({ color: 0x1d1a1b, metalness: 0.75, roughness: 0.4, flatShading: true });
    const hotM = new THREE.MeshStandardMaterial({
      color: 0x3a1a0c, metalness: 0.4, roughness: 0.5,
      emissive: new THREE.Color(1.3, 0.38, 0.05), emissiveIntensity: 0.8,
    });
    const logoUniforms = { uMap: { value: arkTexture(THREE) }, uTime: { value: 0 }, uPower: { value: 1 } };
    const logoMat = new THREE.ShaderMaterial({
      uniforms: logoUniforms, vertexShader: FIRE_VERT, fragmentShader: LOGO_FRAG, transparent: true,
    });
    const glowTex = glowTexture(THREE);
    const flashMat = new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(2.2, 0.9, 0.3), transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });

    const baseGeo = new THREE.CylinderGeometry(CAGE_R + 0.1, CAGE_R + 0.22, BASE_H, 14);
    baseGeo.translate(0, BASE_H / 2, 0);
    const barGeo = new THREE.CylinderGeometry(0.055, 0.055, BAR_H, 6);
    const ringGeo = new THREE.TorusGeometry(CAGE_R, 0.065, 6, 30);
    ringGeo.rotateX(Math.PI / 2);
    const lidGeo = (() => {
      const cone = new THREE.ConeGeometry(CAGE_R + 0.2, 0.8, 14, 1);
      cone.translate(0, 0.4, 0);
      const tip = new THREE.ConeGeometry(0.12, 0.9, 6);
      tip.translate(0, 1.1, 0);
      const parts = [cone, tip];
      for (let i = 0; i < 6; i++) {                          // thorns round the rim
        const a = (i / 6) * TAU;
        const sp = new THREE.ConeGeometry(0.08, 0.5, 5);
        sp.translate(0, 0.25, 0);
        sp.rotateZ(-0.9);
        sp.rotateY(-a);
        sp.translate(Math.cos(a) * (CAGE_R + 0.1), 0.05, Math.sin(a) * (CAGE_R + 0.1));
        parts.push(sp);
      }
      const g = mergeParts(THREE, parts);
      g.computeVertexNormals();
      return g;
    })();
    const grateGeo = new THREE.CircleGeometry(CAGE_R - 0.04, 28);
    grateGeo.rotateX(-Math.PI / 2);
    const grateMat = new THREE.MeshBasicMaterial({ map: grateTexture(THREE), color: new THREE.Color(1.6, 0.8, 0.5) });
    const lockGeo = new THREE.BoxGeometry(0.46, 0.52, 0.2);
    const shackleGeo = new THREE.TorusGeometry(0.15, 0.045, 6, 16, Math.PI);
    const lockLogoGeo = new THREE.CircleGeometry(0.19, 32);
    const geos = [baseGeo, barGeo, ringGeo, lidGeo, lockGeo, shackleGeo, lockLogoGeo, grateGeo];

    const bubbles = {
      help: [bubbleTexture(THREE, "HELP!", "#e0182c"), bubbleTexture(THREE, "HELP!!", "#e0182c"), bubbleTexture(THREE, "SAVE US!", "#e0182c")],
      free: [bubbleTexture(THREE, "FREE!", "#1f9d4a"), bubbleTexture(THREE, "THANKS!", "#1f9d4a"), bubbleTexture(THREE, "HERO!", "#e8a100")],
    };

    const DEFS = [
      { rel: 150 * Math.PI / 180, team: "bookis", colors: ["#ff6f9f", "#ffd23f", "#f2f2f5"] },
      { rel: 210 * Math.PI / 180, team: "norli", colors: ["#6fa0ff", "#f2f2f5", "#57e0a0"] },
    ];
    const SEATS = [[-0.56, 0.26], [0.56, 0.26], [0, -0.5]];   // local x, z; +z faces the crown
    const cages = [];
    const solids = [];
    const beans = [];

    DEFS.forEach((d, ci) => {
      const phi = S.bridgePhi + d.rel;
      const cx = Math.cos(phi) * RING, cz = Math.sin(phi) * RING;
      const cage = new THREE.Group();
      cage.position.set(cx, S.y, cz);
      cage.rotation.y = Math.atan2(-cx, -cz);               // local +z towards the axis
      group.add(cage);
      solids.push({ pos: [cx, S.y + (BASE_H + BAR_H) / 2, cz], radius: CAGE_R + 0.22, height: BASE_H + BAR_H + 0.4 });

      cage.add(new THREE.Mesh(baseGeo, ironM));
      // a glowing ARK furnace grate under the prisoners lights them from below
      const grate = new THREE.Mesh(grateGeo, grateMat);
      grate.position.y = BASE_H + 0.012;
      cage.add(grate);
      const bars = new THREE.InstancedMesh(barGeo, ironM, BARS);
      bars.frustumCulled = false;                           // the bars fly far once freed
      const barState = [];
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < BARS; i++) {
        const a = (i / BARS) * TAU;
        const st = {
          p: new THREE.Vector3(Math.cos(a) * CAGE_R, BASE_H + BAR_H / 2, Math.sin(a) * CAGE_R),
          q: new THREE.Quaternion(), v: new THREE.Vector3(), w: new THREE.Vector3(), a,
        };
        barState.push(st);
        m4.compose(st.p, st.q, new THREE.Vector3(1, 1, 1));
        bars.setMatrixAt(i, m4);
      }
      cage.add(bars);
      const rings = new THREE.Group();
      for (const y of [BASE_H + 0.75, BASE_H + 1.85]) {
        const r = new THREE.Mesh(ringGeo, ironM);
        r.position.y = y;
        rings.add(r);
      }
      cage.add(rings);
      const lid = new THREE.Mesh(lidGeo, ironM);
      lid.position.y = BASE_H + BAR_H;
      cage.add(lid);

      // the ARK padlock on the front, glowing
      const lock = new THREE.Group();
      lock.position.set(0, BASE_H + 1.15, CAGE_R + 0.14);
      lock.add(new THREE.Mesh(lockGeo, hotM));
      const shackle = new THREE.Mesh(shackleGeo, ironM);
      shackle.position.y = 0.26;
      lock.add(shackle);
      const lockLogo = new THREE.Mesh(lockLogoGeo, logoMat);
      lockLogo.position.z = 0.11;
      lock.add(lockLogo);
      cage.add(lock);

      const flash = new THREE.Sprite(flashMat.clone());
      flash.position.copy(lock.position);
      flash.scale.setScalar(0.01);
      flash.visible = false;
      cage.add(flash);

      // sparks for the break-out
      const SPARKS = 48;
      const sparkPos = new Float32Array(SPARKS * 3);
      const sparkGeo = new THREE.BufferGeometry();
      sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
      const sparkMat = new THREE.PointsMaterial({
        color: new THREE.Color(3.0, 1.1, 0.25), size: 0.16, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const sparks = new THREE.Points(sparkGeo, sparkMat);
      sparks.visible = false;
      sparks.frustumCulled = false;
      cage.add(sparks);
      const sparkVel = [];
      for (let i = 0; i < SPARKS; i++) sparkVel.push(new THREE.Vector3());

      const hostages = SEATS.map((seat, i) => {
        const bean = buildBean(THREE, { color: d.colors[i], name: "hostage", team: d.team });
        bean.group.position.set(seat[0], BASE_H, seat[1]);
        cage.add(bean.group);
        const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbles.help[i], transparent: true, depthWrite: false }));
        bubble.scale.set(1.3, 0.65, 1);
        bubble.renderOrder = 30;
        cage.add(bubble);
        const h = {
          bean, bubble, seat: new THREE.Vector3(seat[0], BASE_H, seat[1]),
          out: new THREE.Vector3((i - 1) * 1.05, 0, CAGE_R + 1.1 + (i === 1 ? 0.5 : 0)),
          ph: i * 1.37 + ci * 0.8, delay: i * 0.14,
        };
        beans.push(h);
        return h;
      });

      cages.push({ cage, bars, barState, rings, lid, lock, flash, sparks, sparkPos, sparkVel, sparkGeo, hostages });
    });

    let t = 0;
    let freedAt = -1;
    const up = new THREE.Vector3(0, 1, 0);
    const tmpQ = new THREE.Quaternion();
    const tmpV = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const m4 = new THREE.Matrix4();
    const debris = [];                                        // Object3Ds flying with v, w

    function launch(obj, v, w) { debris.push({ obj, v, w }); }

    function free() {
      if (freedAt >= 0) return;
      freedAt = t;
      for (const c of cages) {
        c.lock.visible = false;
        c.flash.visible = true;
        c.sparks.visible = true;
        for (let i = 0; i < c.sparkVel.length; i++) {
          c.sparkPos[i * 3] = c.lock.position.x;
          c.sparkPos[i * 3 + 1] = c.lock.position.y;
          c.sparkPos[i * 3 + 2] = c.lock.position.z;
          c.sparkVel[i].set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.2).normalize()
            .multiplyScalar(4 + Math.random() * 7);
        }
        c.sparkGeo.attributes.position.needsUpdate = true;
        c.sparks.material.opacity = 1;
        for (const st of c.barState) {
          const outX = Math.cos(st.a), outZ = Math.sin(st.a);
          st.v.set(outX * (3 + Math.random() * 3.5), 5 + Math.random() * 5, outZ * (3 + Math.random() * 3.5));
          st.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
        }
        launch(c.lid, new THREE.Vector3((Math.random() - 0.5) * 3, 11, (Math.random() - 0.5) * 3),
          new THREE.Vector3(Math.random() * 4, Math.random() * 6, Math.random() * 4));
        c.rings.children.forEach((r) => launch(r, new THREE.Vector3((Math.random() - 0.5) * 6, 6 + Math.random() * 4, (Math.random() - 0.5) * 6),
          new THREE.Vector3(Math.random() * 8, 0, Math.random() * 8)));
        c.hostages.forEach((h, i) => { h.bubble.material.map = bubbles.free[i]; h.bubble.material.needsUpdate = true; });
      }
    }

    // debris bounces on the deck (local y 0 inside the deck radius) or falls
    // away down the tower, and is hidden once it is well gone
    function stepBody(p, v, parent, dt) {
      v.y -= 18 * dt;
      p.addScaledVector(v, dt);
      tmpV.copy(p).applyMatrix4(parent.matrix);
      const onDeck = Math.hypot(tmpV.x, tmpV.z) < S.radius - 0.2;
      if (onDeck && p.y < 0.08 && v.y < 0) {
        p.y = 0.08;
        v.y *= -0.35;
        v.x *= 0.6; v.z *= 0.6;
      }
      return p.y > -45;
    }

    function update(dt, tt) {
      t += dt;
      const time = tt !== undefined ? tt : t;
      logoUniforms.uTime.value = time;
      const since = freedAt >= 0 ? t - freedAt : -1;

      for (const c of cages) {
        c.cage.updateMatrix();
        if (since < 0) {
          // rattle: the bars shiver when someone grabs them
          const shake = Math.max(0, Math.sin(time * 1.7 + c.hostages[0].ph)) * 0.03;
          c.bars.position.x = Math.sin(time * 40) * shake;
          c.lock.rotation.z = Math.sin(time * 9) * 0.12;
        } else {
          c.bars.position.x = 0;
          let alive = false;
          c.barState.forEach((st, i) => {
            if (st.gone) return;
            if (!stepBody(st.p, st.v, c.cage, dt)) { st.gone = true; }
            tmpQ.setFromAxisAngle(tmpV.copy(st.w).normalize(), st.w.length() * dt);
            st.q.premultiply(tmpQ);
            m4.compose(st.p, st.q, st.gone ? tmpV.set(0, 0, 0) : one);
            c.bars.setMatrixAt(i, m4);
            alive = alive || !st.gone;
          });
          c.bars.instanceMatrix.needsUpdate = true;
          c.bars.visible = alive;
          const k = Math.min(1, since / 0.4);
          c.flash.scale.setScalar(0.5 + 6 * k);
          c.flash.material.opacity = 1 - k;
          c.flash.visible = k < 1;
          if (c.sparks.visible) {
            for (let i = 0; i < c.sparkVel.length; i++) {
              c.sparkVel[i].y -= 12 * dt;
              c.sparkPos[i * 3] += c.sparkVel[i].x * dt;
              c.sparkPos[i * 3 + 1] += c.sparkVel[i].y * dt;
              c.sparkPos[i * 3 + 2] += c.sparkVel[i].z * dt;
            }
            c.sparkGeo.attributes.position.needsUpdate = true;
            c.sparks.material.opacity = Math.max(0, 1 - since / 1.5);
            c.sparks.visible = since < 1.5;
          }
        }

        for (const h of c.hostages) {
          const g = h.bean.group;
          let pose;
          if (since < 0) {
            // caged: take turns waving for help and rattling the bars
            const wave = Math.sin(time * 0.9 + h.ph) > -0.2;
            const hop = wave ? Math.abs(Math.sin(time * 7 + h.ph)) * 0.18 : 0;
            g.position.set(h.seat.x + (wave ? 0 : Math.sin(time * 34 + h.ph) * 0.03), h.seat.y + hop, h.seat.z);
            g.rotation.set(0, Math.sin(time * 1.3 + h.ph) * 0.25, 0);
            pose = wave ? { air: true, vy: 0, t: time } : { grab: true, speed: 0, t: time };
            h.bubble.visible = Math.sin(time * 1.1 + h.ph * 2.1) > -0.35;
          } else {
            // freed: leap out over the wreck, then cheer and bounce
            const k = Math.max(0, Math.min(1, (since - 0.15 - h.delay) / 0.75));
            tmpV.copy(h.seat).lerp(h.out, k);
            const arc = Math.sin(k * Math.PI) * 1.7;
            const cheer = k >= 1 ? Math.abs(Math.sin((since - 1) * 5.6 + h.ph)) * 0.55 : 0;
            g.position.set(tmpV.x, h.seat.y * (1 - k) + arc + cheer, tmpV.z);
            g.rotation.set(0, k >= 1 ? Math.sin(time * 2 + h.ph) * 0.35 : 0, 0);
            pose = { air: k < 1 || cheer > 0.05, vy: k < 1 ? 6 * Math.cos(k * Math.PI) : 0, t: time };
            h.bubble.visible = since > 0.9 && Math.sin(time * 1.4 + h.ph * 2.1) > -0.5;
          }
          h.bean.update(dt, pose);
          // above the cage lid while caged, above their heads once free
          const lift = since < 0 ? BASE_H + BAR_H + 1.75 + (h.seat.z < 0 ? 0.55 : 0) : g.position.y + 2.35;
          h.bubble.position.set(g.position.x * 1.25, lift + Math.sin(time * 3 + h.ph) * 0.08, g.position.z + (since < 0 ? 0.4 : 0));
        }
      }

      for (let i = debris.length - 1; i >= 0; i--) {
        const d = debris[i];
        const parent = d.obj.parent;
        if (!parent) { debris.splice(i, 1); continue; }
        if (!stepBody(d.obj.position, d.v, parent === group ? group : cages.find((c) => c.cage === parent || c.rings === parent).cage, dt)) {
          d.obj.visible = false;
          debris.splice(i, 1);
          continue;
        }
        d.obj.rotation.x += d.w.x * dt;
        d.obj.rotation.y += d.w.y * dt;
        d.obj.rotation.z += d.w.z * dt;
      }
    }

    function dispose() {
      geos.forEach((g) => g.dispose());
      beans.forEach((h) => { h.bean.dispose(); h.bubble.material.dispose(); });
      bubbles.help.concat(bubbles.free).forEach((tx) => tx.dispose());
      cages.forEach((c) => { c.sparkGeo.dispose(); c.sparks.material.dispose(); c.flash.material.dispose(); c.bars.dispose(); });
      ironM.dispose(); hotM.dispose(); logoMat.dispose(); flashMat.dispose(); glowTex.dispose();
      grateMat.map.dispose(); grateMat.dispose();
    }

    update(0);
    return { group, solids, update, free, dispose };
  }

  // Iron grate over a furnace glow, for the cage floors.
  function grateTexture(THREE) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 256;
    const ctx = cv.getContext("2d");
    const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    g.addColorStop(0, "#ffd27a");
    g.addColorStop(0.55, "#ff7a1a");
    g.addColorStop(1, "#7a1c02");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#140c0a";
    for (let i = 0; i < 256; i += 32) { ctx.fillRect(i, 0, 10, 256); ctx.fillRect(0, i, 256, 10); }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // Merge small non-indexed parts that may or may not carry uvs.
  function mergeParts(THREE, parts) {
    const pos = [];
    for (const p of parts) {
      const g = p.index ? p.toNonIndexed() : p;
      const a = g.attributes.position;
      for (let i = 0; i < a.count; i++) pos.push(a.getX(i), a.getY(i), a.getZ(i));
      if (g !== p) g.dispose();
      p.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return out;
  }

  window.EYE_ART = { buildWorld, buildBean, buildCrown, buildHostages };
})();
