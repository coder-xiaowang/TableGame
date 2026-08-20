"use strict";

import * as THREE from "./vendor/three.module.min.js";
import RAPIER from "./vendor/rapier3d-compat.mjs";

const PHYSICS_HZ = 120;
const SAMPLE_HZ = 60;
const MAX_SECONDS = 4.6;
const DIE_SIZE = 0.58;
const HALF_DIE = DIE_SIZE / 2;
const FACE_VALUES = [2, 5, 3, 4, 1, 6];
const FACE_NORMALS = [
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)
];

let rapierReady = null;
const ensureRapier = () => rapierReady ||= RAPIER.init();

export function createSeededRandom(seed) {
  let value = Number(seed) >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function randomQuaternion(random) {
  let x = random() * 2 - 1, y = random() * 2 - 1, z = random() * 2 - 1, w = random() * 2 - 1;
  const length = Math.hypot(x, y, z, w) || 1;
  return { x:x / length, y:y / length, z:z / length, w:w / length };
}

export function topFaceValue(rotation) {
  const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  let bestIndex = 0;
  let bestHeight = -Infinity;
  FACE_NORMALS.forEach((normal, index) => {
    const height = normal.clone().applyQuaternion(quaternion).y;
    if (height > bestHeight) { bestHeight = height; bestIndex = index; }
  });
  return FACE_VALUES[bestIndex];
}

function rounded(value) { return Number(value.toFixed(6)); }

function createRoundedDieGeometry(size, radius = size * .14, segments = 5) {
  const geometry = new THREE.BoxGeometry(size, size, size, segments, segments, segments);
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const inner = size / 2 - radius;
  const point = new THREE.Vector3();
  const nearest = new THREE.Vector3();
  const direction = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    nearest.set(
      THREE.MathUtils.clamp(point.x, -inner, inner),
      THREE.MathUtils.clamp(point.y, -inner, inner),
      THREE.MathUtils.clamp(point.z, -inner, inner)
    );
    direction.copy(point).sub(nearest).normalize();
    point.copy(nearest).addScaledVector(direction, radius);
    position.setXYZ(index, point.x, point.y, point.z);
    normal.setXYZ(index, direction.x, direction.y, direction.z);
  }
  position.needsUpdate = normal.needsUpdate = true;
  geometry.computeBoundingSphere();
  return geometry;
}

function initialThrow(profile, index, random) {
  const jitter = () => (random() - .5) * .24;
  if (profile === 1) {
    const side = index < 2 ? 1 : -1;
    return {
      position:[side * (1.58 + random() * .28), 1.8 + random() * .65, (index % 2 ? .72 : -.72) + jitter()],
      velocity:[-side * (3.5 + random() * 1.15), .25 + random() * 1.45, (index % 2 ? -1 : 1) * (.45 + random() * 1.25)]
    };
  }
  if (profile === 2) {
    const positions = [[-1,-.65],[-.35,.65],[.35,-.55],[1,.58]];
    return {
      position:[positions[index][0] + jitter(), 2.65 + index * .18 + random() * .45, positions[index][1] + jitter()],
      velocity:[(random() - .5) * 2.1, -.35 - random() * .85, (random() - .5) * 2.1]
    };
  }
  if (profile === 3) {
    const positions = [[2,0],[0,2],[-2,0],[0,-2]];
    const inward = [[-1,0],[0,-1],[1,0],[0,1]][index];
    const tangent = [[0,1],[-1,0],[0,-1],[1,0]][index];
    return {
      position:[positions[index][0] + jitter(), 1.75 + random() * .75, positions[index][1] + jitter()],
      velocity:[inward[0] * (2.8 + random()) + tangent[0] * (1.4 + random()), .3 + random() * 1.3, inward[1] * (2.8 + random()) + tangent[1] * (1.4 + random())]
    };
  }
  return {
    position:[1.42 + index * .18, 1.75 + random() * .55, -.9 + index * .6 + jitter()],
    velocity:[-3.35 - random() * 1.1, .25 + random() * 1.25, (random() - .5) * 2.5]
  };
}

function addCircularBoundary(world, { radius = 3.18, segments = 24 } = {}) {
  const segmentHalfLength = radius * Math.tan(Math.PI / segments) * 1.35;
  for (let index = 0; index < segments; index += 1) {
    const angle = index * Math.PI * 2 / segments;
    const rotation = angle - Math.PI / 2;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(rounded(Math.cos(angle) * radius), 1.1, rounded(Math.sin(angle) * radius))
        .setRotation({ x:0, y:rounded(Math.sin(rotation / 2)), z:0, w:rounded(Math.cos(rotation / 2)) })
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(rounded(segmentHalfLength), 1.2, .18).setFriction(.7).setRestitution(.32),
      body
    );
  }
}

export async function simulateDiceRoll(seed, { diceCount = 3 } = {}) {
  await ensureRapier();
  diceCount = Math.max(1, Math.min(3, Number(diceCount) || 3));
  const random = createSeededRandom(seed);
  const throwProfile = Math.floor(random() * 4);
  const world = new RAPIER.World({ x:0, y:-9.81, z:0 });
  world.timestep = 1 / PHYSICS_HZ;
  const trayBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -.1, 0));
  world.createCollider(RAPIER.ColliderDesc.cylinder(.1, 3.25).setFriction(.74).setRestitution(.24), trayBody);
  addCircularBoundary(world);

  const bodies = [];
  for (let index = 0; index < diceCount; index += 1) {
    const rotation = randomQuaternion(random);
    const launch = initialThrow(throwProfile, index, random);
    const spinStrength = throwProfile === 2 ? 21 : throwProfile === 3 ? 19 : 17;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...launch.position)
        .setRotation(rotation)
        .setLinvel(...launch.velocity)
        .setAngvel({ x:(random() - .5) * spinStrength, y:(random() - .5) * (spinStrength + 3), z:(random() - .5) * spinStrength })
        .setLinearDamping(.12 + random() * .08)
        .setAngularDamping(.2 + random() * .14)
        .setCcdEnabled(true)
        .setCanSleep(true)
    );
    world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(HALF_DIE * .91, HALF_DIE * .91, HALF_DIE * .91, HALF_DIE * .09)
        .setDensity(.85)
        .setFriction(.6)
        .setRestitution(.37),
      body
    );
    bodies.push(body);
  }

  const frames = [];
  const maxSteps = Math.round(MAX_SECONDS * PHYSICS_HZ);
  let settledSteps = 0;
  for (let step = 0; step <= maxSteps; step += 1) {
    if (step % (PHYSICS_HZ / SAMPLE_HZ) === 0) {
      frames.push(bodies.map((body) => {
        const position = body.translation();
        const rotation = body.rotation();
        return { p:[position.x, position.y, position.z], q:[rotation.x, rotation.y, rotation.z, rotation.w] };
      }));
    }
    if (step > PHYSICS_HZ * 1.5 && bodies.every((body) => body.isSleeping())) settledSteps += 1;
    else settledSteps = 0;
    if (settledSteps >= 6) break;
    if (step === Math.round(PHYSICS_HZ * 3.7)) {
      bodies.forEach((body) => { body.setLinearDamping(.75); body.setAngularDamping(1.25); });
    }
    world.step();
  }

  const lastFrame = frames.at(-1);
  const results = lastFrame.map((pose) => topFaceValue({ x:pose.q[0], y:pose.q[1], z:pose.q[2], w:pose.q[3] }));
  world.free();
  return Object.freeze({ seed:Number(seed) >>> 0, diceCount, profile:throwProfile, fps:SAMPLE_HZ, frames, durationMs:Math.round((frames.length - 1) / SAMPLE_HZ * 1000), results });
}

function makeFaceTexture(value) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 192;
  const context = canvas.getContext("2d");
  context.fillStyle = "#f5f0df";
  context.fillRect(0, 0, 192, 192);
  const gradient = context.createRadialGradient(62, 54, 8, 96, 96, 130);
  gradient.addColorStop(0, "rgba(255,255,255,.8)");
  gradient.addColorStop(1, "rgba(93,77,53,.18)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 192, 192);
  const points = {
    1:[[1,1]], 2:[[0,0],[2,2]], 3:[[0,0],[1,1],[2,2]],
    4:[[0,0],[2,0],[0,2],[2,2]], 5:[[0,0],[2,0],[1,1],[0,2],[2,2]],
    6:[[0,0],[0,1],[0,2],[2,0],[2,1],[2,2]]
  }[value];
  context.fillStyle = "#24483d";
  for (const [x, y] of points) {
    context.beginPath();
    context.arc(48 + x * 48, 48 + y * 48, 13, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export async function createDicePhysics({ canvas } = {}) {
  if (!canvas || !globalThis.WebGLRenderingContext) throw new Error("WebGL unavailable");
  await ensureRapier();
  const renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:true, preserveDrawingBuffer:true, powerPreference:"high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .1, 40);
  camera.position.set(0, 8.1, 6.8);
  camera.lookAt(0, .25, 0);
  scene.add(new THREE.HemisphereLight(0xfff4d2, 0x29483d, 2.1));
  const sun = new THREE.DirectionalLight(0xfff1ce, 3.2);
  sun.position.set(-3.5, 8, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left:-6, right:6, top:5, bottom:-5, near:.1, far:20 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);

  // A single revolved profile makes the base, curved wall and lip one continuous
  // surface. This avoids the intersecting cylinder/torus seams of the old tray.
  const vesselProfile = [
    [0, -.2], [3.16, -.2], [3.37, -.14], [3.47, .04],
    [3.48, .62], [3.44, .78], [3.34, .9], [3.22, .95],
    [3.1, .91], [3.04, .82], [3.1, .68], [3.13, .22],
    [3.08, .08], [2.96, 0], [0, 0]
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const vesselGeometry = new THREE.LatheGeometry(vesselProfile, 128);
  vesselGeometry.computeVertexNormals();
  const vesselMaterial = new THREE.MeshPhysicalMaterial({
    color:0x9a7445, roughness:.54, metalness:0, clearcoat:.18,
    clearcoatRoughness:.72, side:THREE.DoubleSide
  });
  const vessel = new THREE.Mesh(vesselGeometry, vesselMaterial);
  vessel.castShadow = vessel.receiveShadow = true;
  scene.add(vessel);

  // A shallow inset visually separates the rolling surface without overlapping
  // the curved wall, so no coplanar faces can flicker through one another.
  const trayGeometry = new THREE.CylinderGeometry(2.96, 2.96, .035, 128);
  const trayMaterial = new THREE.MeshStandardMaterial({ color:0xd2ae72, roughness:.82, metalness:0 });
  const tray = new THREE.Mesh(trayGeometry, trayMaterial);
  tray.position.y = .018;
  tray.receiveShadow = true;
  scene.add(tray);

  const numberMaterials = Array.from({ length:6 }, (_, index) => new THREE.MeshStandardMaterial({ map:makeFaceTexture(index + 1), roughness:.7, metalness:0 }));
  const tintedMaterials = new Map();
  const faceMaterial = (value, color) => {
    if (!color) return numberMaterials[value - 1];
    const key = `${value}:${color}`;
    if (!tintedMaterials.has(key)) tintedMaterials.set(key, new THREE.MeshStandardMaterial({
      map:numberMaterials[value - 1].map,
      color:new THREE.Color(color).lerp(new THREE.Color(0xffffff), .58),
      roughness:.68, metalness:0
    }));
    return tintedMaterials.get(key);
  };
  const defaultMaterials = FACE_VALUES.map((value) => numberMaterials[value - 1]);
  const geometry = createRoundedDieGeometry(DIE_SIZE);
  const dice = Array.from({ length:4 }, () => {
    const mesh = new THREE.Mesh(geometry, defaultMaterials);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  });
  let animationFrame = 0;
  let activeSimulation = null;
  let startedAt = 0;
  let playbackOffset = 0;

  function resize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  function setPose(simulation, elapsedMs) {
    const frameValue = Math.min(simulation.frames.length - 1, elapsedMs / 1000 * simulation.fps);
    const lower = Math.floor(frameValue);
    const upper = Math.min(simulation.frames.length - 1, lower + 1);
    const alpha = frameValue - lower;
    dice.forEach((mesh, index) => {
      mesh.visible = index < simulation.diceCount;
      if (!mesh.visible) return;
      const a = simulation.frames[lower][index];
      const b = simulation.frames[upper][index];
      mesh.position.fromArray(a.p).lerp(new THREE.Vector3().fromArray(b.p), alpha);
      mesh.quaternion.fromArray(a.q).slerp(new THREE.Quaternion().fromArray(b.q), alpha);
    });
  }
  function draw(now) {
    if (!activeSimulation) return;
    const elapsed = Math.min(activeSimulation.durationMs, playbackOffset + now - startedAt);
    setPose(activeSimulation, elapsed);
    renderer.render(scene, camera);
    if (elapsed < activeSimulation.durationMs) animationFrame = requestAnimationFrame(draw);
    else animationFrame = 0;
  }
  function play(simulation, { elapsedMs = 0, faceSets = [], dieColors = [] } = {}) {
    cancelAnimationFrame(animationFrame);
    dice.forEach((mesh, index) => {
      const faces = faceSets[index];
      mesh.material = faces
        ? FACE_VALUES.map((canonical) => faceMaterial(faces[canonical - 1] ?? canonical, dieColors[index]))
        : defaultMaterials;
    });
    activeSimulation = simulation;
    playbackOffset = Math.max(0, Number(elapsedMs) || 0);
    startedAt = performance.now();
    canvas.classList.add("visible");
    animationFrame = requestAnimationFrame(draw);
  }
  function hide() {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    activeSimulation = null;
    canvas.classList.remove("visible");
  }
  function dispose() {
    hide(); observer.disconnect(); geometry.dispose(); vesselGeometry.dispose(); vesselMaterial.dispose();
    trayGeometry.dispose(); trayMaterial.dispose();
    tintedMaterials.forEach((material) => material.dispose());
    numberMaterials.forEach((material) => { material.map?.dispose(); material.dispose(); }); renderer.dispose();
  }
  return Object.freeze({ play, hide, dispose, renderFinal(simulation, options = {}) { play(simulation, { ...options, elapsedMs:simulation.durationMs }); } });
}
