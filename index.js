/// npx http-server .
/// http://127.0.0.1:8080


import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

let scene, camera, renderer, controls;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();

let spheres = [];
let diamonds = [];
let fleeDiamonds = [];

// modes: "sleep", "wake", "interact", "melt"
let MODE = "sleep";
let wakeStartTime = 0;
let meltStartTime = 0;
let lastInteractionTime = 0;

const SPACING = 10;
const RADIUS = 2;
const FLEE_DIAMOND_COUNT = 50;
const FLEE_SPHERE_RADIUS = 1500;
const FLEE_SPEED = 820;
const FLEE_MOUSE_RADIUS = 180;

// breathing settings (more visible)
const BREATH_INTERACT_SPEED = 0.3;
const BREATH_INTERACT_AMP = 0.075;

const BREATH_SLEEP_SPEED = 0.15;
const BREATH_SLEEP_AMP = 0.035;

// explosion state (array for multiple concurrent explosions)
let activeExplosions = [];
const EXPLODE_DISTANCE = 200;

// Sunset base colors (warm)
const SUNSET_BASE = [
  "#FF5733",
  "#FF7F50",
  "#FFA64D",
  "#FFCC66",
  "#FFE6A8"
];

// Highlight colors (cool contrast)
const SUNSET_HIGHLIGHT = [
  "#4DB6FF",
  "#66FFDA",
  "#5CE1FF",
  "#7DFFB2",
  "#A8F0FF"
];

// Sleep colors (dim, muted)
const SLEEP_COLORS = [
  "#1E1E1E",
  "#2A2A2A",
  "#3A3A3A",
  "#4A4A4A",
  "#5A5A5A"
];

// 5 nested cubes
const CUBE_LAYERS = [
  { size: 260, base: 0, highlight: 0, sleep: 0 },
  { size: 220, base: 1, highlight: 1, sleep: 1 },
  { size: 180, base: 2, highlight: 2, sleep: 2 },
  { size: 140, base: 3, highlight: 3, sleep: 3 },
  { size: 100, base: 4, highlight: 4, sleep: 4 }
];

function init() {
  scene = new THREE.Scene();

  new HDRLoader().load("cedar_bridge_sunset_1_1k.hdr", (envMap) => {
    envMap.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = envMap;
  });

  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    5000
  );
  camera.position.set(500, 500, 500);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.maxDistance = 2000;

  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(1, 1, 1);
  scene.add(light);

  CUBE_LAYERS.forEach((layer, layerIndex) => {
    createSphereCube(layer.size, layer.base, layer.highlight, layer.sleep, layerIndex);
  });

  createFleeingDiamonds();

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("dblclick", onDoubleClick);
  document.addEventListener("click", onSingleClick);

  lastInteractionTime = performance.now() / 1000;

  enterSleepMode();

  animate();
}

function createSphereCube(size, baseIndex, highlightIndex, sleepIndex, layerIndex) {
  const half = size / 2;

  const baseColor = new THREE.Color(SUNSET_BASE[baseIndex]);
  const highlightColor = new THREE.Color(SUNSET_HIGHLIGHT[highlightIndex]);
  const sleepColor = new THREE.Color(SLEEP_COLORS[sleepIndex]);

  for (let x = -half; x <= half; x += SPACING) {
    for (let y = -half; y <= half; y += SPACING) {
      for (let z = -half; z <= half; z += SPACING) {

        const isSurface =
          Math.abs(x) === half ||
          Math.abs(y) === half ||
          Math.abs(z) === half;

        if (!isSurface) continue;

        const geo = new THREE.SphereGeometry(RADIUS, 10, 10);
        const mat = new THREE.MeshStandardMaterial({
          color: sleepColor.clone()
        });

        const sphere = new THREE.Mesh(geo, mat);
        sphere.position.set(x, y, z);

        // home position (perfect cube)
        sphere.userData.homePosition = sphere.position.clone();

        // scatter offset for sleep/melt (±50% style)
        const offsetRange = SPACING * 5;
        sphere.userData.sleepOffset = new THREE.Vector3(
          (Math.random() * 2 - 1) * offsetRange,
          (Math.random() * 2 - 1) * offsetRange,
          (Math.random() * 2 - 1) * offsetRange
        );
        sphere.userData.sleepPosition = sphere.userData.homePosition.clone().add(sphere.userData.sleepOffset);

        sphere.userData.originalY = sphere.position.y;

        // breathing + drift phases
        sphere.userData.phaseBreath = Math.random() * Math.PI * 2;
        sphere.userData.phaseDriftX = Math.random() * Math.PI * 2;
        sphere.userData.phaseDriftZ = Math.random() * Math.PI * 2;

        // ripple timer
        sphere.userData.rippleTime = -9999;

        // grid coords for neighbor ripple
        sphere.userData.grid = {
          x: x / SPACING,
          y: y / SPACING,
          z: z / SPACING
        };

        // colors
        sphere.userData.baseColor = baseColor.clone();
        sphere.userData.highlightColor = highlightColor.clone();
        sphere.userData.sleepColor = sleepColor.clone();
        sphere.userData.layerIndex = layerIndex;

        scene.add(sphere);
        spheres.push(sphere);
      }
    }
  }
}

function createFleeingDiamonds() {
  const geometry = new THREE.OctahedronGeometry(8, 0);
  const material = new THREE.MeshStandardMaterial({
    color: 0x8f8f8f,
    emissive: 0x111111,
    emissiveIntensity: 0.04,
    metalness: 0.7,
    roughness: 0.15,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide
  });

  const cubeHalf = 130; // cube max half-size from largest layer / 2

  for (let i = 0; i < FLEE_DIAMOND_COUNT; i++) {
    const diamond = new THREE.Mesh(geometry, material.clone());

    let position;
    do {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const radius = Math.random() * FLEE_SPHERE_RADIUS * 0.8;

      position = new THREE.Vector3(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi)
      );
    } while (
      Math.abs(position.x) < cubeHalf &&
      Math.abs(position.y) < cubeHalf &&
      Math.abs(position.z) < cubeHalf
    );

    diamond.position.copy(position);
    const baseScale = 0.6 + Math.random() * 0.8;
    diamond.scale.setScalar(baseScale);

    diamond.userData = {
      velocity: new THREE.Vector3(
        (Math.random() * 2 - 1) * 22,
        (Math.random() * 2 - 1) * 22,
        (Math.random() * 2 - 1) * 22
      ),
      fear: 0,
      centerPos: diamond.position.clone(),
      baseScale,
      spin: Math.random() * 0.05,
      phaseDriftX: Math.random() * Math.PI * 2,
      phaseDriftY: Math.random() * Math.PI * 2,
      phaseDriftZ: Math.random() * Math.PI * 2
    };

    fleeDiamonds.push(diamond);
    scene.add(diamond);
  }
}

function enterSleepMode() {
  MODE = "sleep";

  spheres.forEach((s) => {
    const sleepPos = s.userData.sleepPosition.clone();
    s.position.copy(sleepPos);
    s.userData.originalY = sleepPos.y;
    s.material.color.copy(s.userData.sleepColor);
    s.userData.rippleTime = -9999;
    s.scale.set(1, 1, 1);
  });
}

function startWakeMode() {
  MODE = "wake";
  wakeStartTime = performance.now() / 1000;

  spheres.forEach((s) => {
    s.userData.wakeStartPos = s.position.clone();

    const scrambleRange = SPACING * 6;
    s.userData.scrambleOffset = new THREE.Vector3(
      (Math.random() * 2 - 1) * scrambleRange,
      (Math.random() * 2 - 1) * scrambleRange,
      (Math.random() * 2 - 1) * scrambleRange
    );
  });
}

function startMeltMode() {
  MODE = "melt";
  meltStartTime = performance.now() / 1000;
}

function startExplosion(explosionSpheres, type = "single") {
  if (explosionSpheres.length === 0) return;

  const t = performance.now() / 1000;

  explosionSpheres.forEach(s => {
    s.userData.explodeDir = s.userData.homePosition.clone().normalize();
    s.userData.explosionType = type;
  });

  activeExplosions.push({
    startTime: t,
    spheres: explosionSpheres,
    type
  });
}

function onDoubleClick(event) {
  if (MODE === "sleep" || MODE === "melt") {
    startWakeMode();
    return;
  }

  if (MODE !== "interact") return;

  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(spheres);
  if (hits.length === 0) return;

  const explosionSpheres = spheres.filter(s =>
    !activeExplosions.some(exp => exp.spheres.includes(s))
  );

  if (explosionSpheres.length === 0) return;

  // double-click explosion: everything on the cube, more dramatic
  startExplosion(explosionSpheres, "double");
}

function onSingleClick(event) {
  if (MODE !== "interact") return;

  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(spheres);

  if (hits.length === 0) return;

  const t = performance.now() / 1000;

  // find all spheres with active ripple/wave effect (more sensitive window)
  // exclude spheres already in active explosions
  const explosionSpheres = spheres.filter(s =>
    (t - s.userData.rippleTime) < 6 &&
    !activeExplosions.some(exp => exp.spheres.includes(s))
  );

  if (explosionSpheres.length === 0) return;

  startExplosion(explosionSpheres, "single");
}


function onMouseMove(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  if (MODE !== "interact") return;

  raycaster.setFromCamera(mouse, camera);

  const hits = raycaster.intersectObjects(spheres);

  spheres.forEach((s) => s.material.color.copy(s.userData.baseColor));

  if (hits.length > 0) {
    const hitSphere = hits[0].object;
    const now = performance.now() / 1000;
    lastInteractionTime = now;

    hitSphere.userData.rippleTime = now;

    const hitGrid = hitSphere.userData.grid;

    const neighbors = spheres.filter((s) => {
      const g = s.userData.grid;
      return (
        Math.abs(g.x - hitGrid.x) <= 1 &&
        Math.abs(g.y - hitGrid.y) <= 1 &&
        Math.abs(g.z - hitGrid.z) <= 1 &&
        s !== hitSphere
      );
    });

    if (neighbors.length > 0) {
      const n1 = neighbors[Math.floor(Math.random() * neighbors.length)];
      n1.userData.rippleTime = now;

      if (neighbors.length > 1) {
        const n2 = neighbors[Math.floor(Math.random() * neighbors.length)];
        n2.userData.rippleTime = now;
      }
    }
  }
}

function runExplosionSystem(t) {
  // process all active explosions
  activeExplosions = activeExplosions.filter(explosion => {
    const dt = t - explosion.startTime;
    
    const isDouble = explosion.type === "double";
    const distance = EXPLODE_DISTANCE * (isDouble ? 1.8 : 1.0);
    const holdTime = isDouble ? 3.2 : 2.0;
    const returnTime = isDouble ? 0.8 : 0.4;
    const settleTime = isDouble ? 5.0 : 3.0;
    const totalDuration = 0.35 + holdTime + returnTime + settleTime;
    const shakeAmp = isDouble ? 6.0 : 3.0;
    const shakeFreq = isDouble ? 38 : 25;
    const burstScale = isDouble ? 0.85 : 0.4;
    const flashColor = new THREE.Color(isDouble ? 1.0 : 1.0, isDouble ? 0.6 : 1.0, 0.25);

    explosion.spheres.forEach(s => {
      const home = s.userData.homePosition.clone();
      const dir = s.userData.explodeDir.clone();

      let pos;

      const shake = Math.sin(t * shakeFreq + s.userData.phaseBreath) * shakeAmp;

      // 1. EXPLOSIVE LAUNCH (faster & further)
      if (dt < 0.35) {
        const p = dt / 0.35;
        const easeP = 1 - Math.pow(1 - p, 3);
        pos = home.clone().add(dir.multiplyScalar(distance * easeP));
        pos.addScalar(shake * 2);
        
        s.scale.set(1 + easeP * burstScale, 1 + easeP * burstScale, 1 + easeP * burstScale);
        
        const bright = 1 - easeP;
        s.material.color.copy(flashColor.clone().lerp(s.userData.baseColor, bright));
        
        s.position.copy(pos);
        s.material.opacity = 1.0;
        return;
      }

      // 2. HOLD at distance
      if (dt < 0.35 + holdTime) {
        pos = home.clone().add(dir.multiplyScalar(distance));
        pos.addScalar(shake * 2.5);
        if (isDouble) pos.y += 12;
        s.position.copy(pos);
        s.scale.set(isDouble ? 1.35 : 1.25, isDouble ? 1.35 : 1.25, isDouble ? 1.35 : 1.25);
        s.material.color.copy(s.userData.baseColor);
        s.material.opacity = 1.0;
        return;
      }

      // 3. RAPID RETURN
      if (dt < 0.35 + holdTime + returnTime) {
        const p = (dt - 0.35 - holdTime) / returnTime;
        const easeP = p * p;
        const explodedPos = home.clone().add(dir.clone().multiplyScalar(distance));

        pos = explodedPos.clone().lerp(home, easeP);
        pos.addScalar(shake * (1 - easeP) * 3);
        if (isDouble) pos.y += Math.sin(p * Math.PI) * 20;

        s.position.copy(pos);
        s.scale.set(1.25 - easeP * (isDouble ? 0.35 : 0.25), 1.25 - easeP * (isDouble ? 0.35 : 0.25), 1.25 - easeP * (isDouble ? 0.35 : 0.25));
        s.material.opacity = 1.0;
        return;
      }

      // 4. SETTLE + fade out
      if (dt < totalDuration) {
        const p = (dt - 0.35 - holdTime - returnTime) / settleTime;
        pos = home.clone();
        pos.addScalar(shake * (1 - p * 0.6));
        if (isDouble) pos.y += Math.sin(p * Math.PI) * 10;

        s.position.copy(pos);
        s.scale.lerp(new THREE.Vector3(1.0, 1.0, 1.0), p);
        s.material.color.copy(s.userData.baseColor);
        s.material.opacity = 1.0 - p * 0.35;
        return;
      }

      // 5. prepare recovery
      if (s.userData.recoveryStartTime === undefined) {
        s.userData.recoveryFromPosition = s.position.clone();
        s.userData.recoveryFromScale = s.scale.clone();
        s.userData.recoveryStartTime = t;
      }
    });
    
    return dt < totalDuration;
  });
}

function runFleeingDiamonds(t) {
  const deltaTime = 1 / 60; // approximate frame time
  raycaster.setFromCamera(mouse, camera);
  const rayDirection = raycaster.ray.direction.clone();
  const rayOrigin = raycaster.ray.origin.clone();

  fleeDiamonds.forEach(diamond => {
    // natural drift force
    const drift = new THREE.Vector3(
      Math.sin(t + diamond.userData.phaseDriftX),
      Math.cos(t + diamond.userData.phaseDriftY),
      Math.sin(t * 0.9 + diamond.userData.phaseDriftZ)
    ).multiplyScalar(10);
    diamond.userData.velocity.add(drift.multiplyScalar(deltaTime * 0.8));

    // gentle random wander even when not chased
    const wander = new THREE.Vector3(
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 8
    ).multiplyScalar(deltaTime * 1.2);
    diamond.userData.velocity.add(wander);

    // 1. Raycasting - get repulsion direction from mouse ray
    const diamondToRay = diamond.position.clone().sub(rayOrigin);
    const distanceToRay = diamondToRay.clone().cross(rayDirection).length();

    let repulsionForce = new THREE.Vector3(0, 0, 0);

    if (distanceToRay < FLEE_MOUSE_RADIUS) {
      const perpToRay = diamondToRay.clone()
        .sub(rayDirection.clone().multiplyScalar(diamondToRay.dot(rayDirection)))
        .normalize();

      const repulsionStrength = (FLEE_MOUSE_RADIUS - distanceToRay) / FLEE_MOUSE_RADIUS * FLEE_SPEED * 2.2;
      repulsionForce = perpToRay.multiplyScalar(repulsionStrength);
    }

    diamond.userData.velocity.add(repulsionForce.multiplyScalar(deltaTime * 2.2));

    // 2. Gentle pull back toward original drift center
    const towardCenter = diamond.userData.centerPos.clone().sub(diamond.position);
    if (towardCenter.length() > 1) {
      const centerPull = towardCenter.normalize().multiplyScalar(16);
      diamond.userData.velocity.lerp(centerPull, 0.01);
    }

    diamond.userData.velocity.multiplyScalar(0.9);

    const isChased = distanceToRay < FLEE_MOUSE_RADIUS;
    const targetColor = new THREE.Color();
    const targetEmissive = new THREE.Color();
    let targetIntensity = 0.0;

    if (MODE === "interact") {
      targetColor.setHex(0xfff2b0);
      if (isChased) {
        targetEmissive.setHex(0xffffcc);
        targetIntensity = 0.95;
      } else {
        targetEmissive.setHex(0x222222);
        targetIntensity = 0.08;
      }
    } else {
      targetColor.setHex(0x8f8f8f);
      targetEmissive.setHex(0x111111);
      targetIntensity = 0.04;
    }

    diamond.material.color.lerp(targetColor, 0.1);
    diamond.material.emissive.lerp(targetEmissive, 0.1);
    diamond.material.emissiveIntensity += (targetIntensity - diamond.material.emissiveIntensity) * 0.12;

    // subtle size pulse for natural motion
    const scalePulse = 1 + Math.sin(t * 1.6 + diamond.userData.phaseDriftZ) * 0.08;
    diamond.scale.setScalar(diamond.userData.baseScale * scalePulse);

    // 3. Update position
    diamond.position.add(diamond.userData.velocity.clone().multiplyScalar(deltaTime));

    // 4. Sphere boundary collision (r=1000)
    const distFromOrigin = diamond.position.length();
    if (distFromOrigin > FLEE_SPHERE_RADIUS) {
      const normal = diamond.position.clone().normalize();
      const reflected = diamond.userData.velocity.clone().reflect(normal);
      diamond.userData.velocity.copy(reflected.multiplyScalar(0.78));
      diamond.position.copy(normal.multiplyScalar(FLEE_SPHERE_RADIUS * 0.99));
    }

    // 5. Cube particle collision - check distance to all spheres
    spheres.forEach(sphere => {
      const dist = diamond.position.distanceTo(sphere.position);
      const minDist = 8 + RADIUS;

      if (dist < minDist) {
        const normal = diamond.position.clone().sub(sphere.position).normalize();
        diamond.userData.velocity.copy(diamond.userData.velocity.clone().reflect(normal).multiplyScalar(0.7));
        diamond.position.copy(sphere.position.clone().add(normal.multiplyScalar(minDist * 1.05)));
      }
    });

    // 6. Rotation
    diamond.rotation.x += diamond.userData.spin * 0.5;
    diamond.rotation.y += diamond.userData.spin * 0.7;
    diamond.rotation.z += diamond.userData.spin * 0.3;
  });
}


function animate() {
  const t = performance.now() / 1000;
  runExplosionSystem(t);
  runFleeingDiamonds(t);

  if (MODE === "interact" && t - lastInteractionTime > 15) {
    startMeltMode();
  }

  spheres.forEach((s) => {
    // skip if sphere is in any active explosion
    if (activeExplosions.some(exp => exp.spheres.includes(s))) return;
    const home = s.userData.homePosition;
    const sleepPos = s.userData.sleepPosition;

// SLEEP MODE
if (MODE === "sleep") {
  const driftAmp = 2.0;
  const dx = Math.sin(t * 0.12 + s.userData.phaseDriftX) * driftAmp;
  const dz = Math.cos(t * 0.1 + s.userData.phaseDriftZ) * driftAmp;

  // organic cube breathing (Option B)
  const cubeBreath = 1 + Math.sin(t * BREATH_SLEEP_SPEED + s.userData.phaseBreath) * BREATH_SLEEP_AMP;

  const basePos = sleepPos.clone()
    .multiplyScalar(cubeBreath)
    .add(new THREE.Vector3(dx, 0, dz));

  s.position.copy(basePos);
  s.userData.originalY = basePos.y;

  // sphere breathing
  s.scale.set(cubeBreath, cubeBreath, cubeBreath);

  // alpha breathing
  const alpha = 0.6 + (cubeBreath - 1) * 1.5;
  s.material.opacity = THREE.MathUtils.clamp(alpha, 0.25, 1.0);

  // sleep color
  s.material.color.copy(s.userData.sleepColor);

  // dreamy slow cube rotation
  scene.rotation.y += 0.000000002;
  scene.rotation.x += 0.000000001;
    scene.rotation.z += 0.000000003;

  return;
}



    // WAKE MODE
    if (MODE === "wake") {
      const dt = t - wakeStartTime;
      const duration = 0.8;
      const p = Math.min(dt / duration, 1);

      let pos = new THREE.Vector3();
      const scrambleTarget = home.clone().add(s.userData.scrambleOffset);

      if (p < 0.5) {
        const k = p / 0.5;
        const easeOut = 1 - Math.pow(1 - k, 2);
        pos.lerpVectors(s.userData.wakeStartPos, scrambleTarget, easeOut);
      } else {
        const k = (p - 0.5) / 0.5;
        const easeInOut = k * k * (3 - 2 * k);
        pos.lerpVectors(scrambleTarget, home, easeInOut);
      }

      s.position.copy(pos);
      s.userData.originalY = pos.y;

      const colorT = p;
      const c = s.userData.sleepColor.clone().lerp(s.userData.baseColor, colorT);
      s.material.color.copy(c);

      // breathing transition
      const slowP = Math.pow(p, 0.4); // slows the transition
    const breathSpeed = BREATH_SLEEP_SPEED + (BREATH_INTERACT_SPEED - BREATH_SLEEP_SPEED) * slowP;
      const breathAmp = BREATH_SLEEP_AMP + (BREATH_INTERACT_AMP - BREATH_SLEEP_AMP) * p;
      const cubeBreath = 1 + Math.sin(t * breathSpeed + s.userData.phaseBreath) * breathAmp;

      s.scale.set(cubeBreath, cubeBreath, cubeBreath);

      if (p >= 1) {
        MODE = "interact";
        lastInteractionTime = t;
        spheres.forEach((s2) => {
          s2.position.copy(s2.userData.homePosition);
          s2.userData.originalY = s2.userData.homePosition.y;
        });
      }
      return;
    }

    // MELT MODE
    if (MODE === "melt") {
      const dt = t - meltStartTime;
      const duration = 4.0;
      const p = Math.min(dt / duration, 1);

      // scatter grows from 0 → full sleepOffset (center fixed)
      const scatter = s.userData.sleepOffset.clone().multiplyScalar(p);

      // dream-like drifting
      const driftAmp = 3.0;
      const dx = Math.sin(t * 0.18 + s.userData.phaseDriftX) * driftAmp;
      const dz = Math.cos(t * 0.16 + s.userData.phaseDriftZ) * driftAmp;

      // breathing transition
      const breathSpeed = BREATH_INTERACT_SPEED + (BREATH_SLEEP_SPEED - BREATH_INTERACT_SPEED) * p;
      const breathAmp = BREATH_INTERACT_AMP + (BREATH_SLEEP_AMP - BREATH_INTERACT_AMP) * p;
      const cubeBreath = 1 + Math.sin(t * breathSpeed + s.userData.phaseBreath) * breathAmp;

      const basePos = home.clone()
        .add(scatter)
        .multiplyScalar(cubeBreath)
        .add(new THREE.Vector3(dx, 0, dz));

      s.position.copy(basePos);
      s.userData.originalY = basePos.y;

      const c = s.userData.baseColor.clone().lerp(s.userData.sleepColor, p);
      s.material.color.copy(c);

      s.scale.set(cubeBreath, cubeBreath, cubeBreath);

      if (p >= 1) {
        const finalPos = s.userData.sleepPosition.clone()
          .multiplyScalar(cubeBreath)
          .add(new THREE.Vector3(dx, 0, dz));

        s.position.copy(finalPos);
        s.userData.originalY = finalPos.y;
        MODE = "sleep";
      }
      return;
    }

    // INTERACT MODE
    if (MODE === "interact") {
      // organic cube breathing (Option B)
      const cubeBreath = 1 + Math.sin(t * BREATH_INTERACT_SPEED + s.userData.phaseBreath) * BREATH_INTERACT_AMP;

      const targetPos = home.clone()
        .add(s.userData.sleepOffset.clone().multiplyScalar(0)) // no scatter in interact
        .multiplyScalar(cubeBreath);

      const targetScale = new THREE.Vector3(cubeBreath, cubeBreath, cubeBreath);

      let recoveryDampen = 1.0;
      if (s.userData.recoveryStartTime !== undefined) {
        const recoveryDt = t - s.userData.recoveryStartTime;
        const recoveryDuration = 2.0;
        if (recoveryDt < recoveryDuration) {
          recoveryDampen = recoveryDt / recoveryDuration;

          const fromPos = s.userData.recoveryFromPosition || s.position.clone();
          const fromScale = s.userData.recoveryFromScale || s.scale.clone();

          s.position.copy(fromPos.lerp(targetPos, recoveryDampen));
          s.scale.copy(fromScale.lerp(targetScale, recoveryDampen));
        } else {
          s.userData.recoveryStartTime = undefined; // recovery complete
          delete s.userData.recoveryFromPosition;
          delete s.userData.recoveryFromScale;
          s.position.copy(targetPos);
          s.scale.copy(targetScale);
        }
      } else {
        s.position.copy(targetPos);
        s.scale.copy(targetScale);
      }

      s.userData.originalY = s.position.y;

      const dt = t - s.userData.rippleTime;

      if (dt >= 0 && dt < 4.0) {
        const ease = Math.sin(dt * Math.PI * 0.5);
        const fall = Math.cos(dt * Math.PI * 0.25);
        const wave = ease * fall * 2.0 * recoveryDampen;

        s.position.y = s.userData.originalY + wave;

        const fade = 1 - dt / 4.0;
        s.material.color.copy(
          s.userData.baseColor.clone().lerp(s.userData.highlightColor, fade)
        );
      } else {
        s.position.y = s.userData.originalY;
        s.material.color.copy(s.userData.baseColor);
      }
    }
  });

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

init();
