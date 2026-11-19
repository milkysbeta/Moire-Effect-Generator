import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import {
    TAU, dimensions as DIM, base, stations, pinionRadius,
    lidHalfAngle, motor, belt, beltCentres, beltPitchRadius, beltLandRadius, beltTrack, pulleyWidth, motorDatums, polar, meshIndex, channelMotion, sizeFamilies, sharedBaseLayout,
    pinionPhase, rpmAtCycle, shortestCycle, driftFactor, loadingDiscX, liftIndexOffset, spurOutline
} from './model-drive.js';

const transferredLook = await MoireLook.read(location.hash);
const params = new URLSearchParams(location.hash.slice(1));
if (params.has('discs') || params.has('light')) {
    // Older links stored inspection settings. A load now opens the complete sculpture.
    params.delete('discs');
    params.delete('light');
    const hash = params.toString();
    history.replaceState(history.state, '', location.pathname + location.search + (hash ? `#${hash}` : ''));
}
const selectedSize = sizeFamilies.find(family => family.name === params.get('size')) ?? sizeFamilies[0];
const { centre: [discX, discY], spindlePositions, middleTravel } = sharedBaseLayout(selectedSize);
const { radius: rimRadius, outerRadius: cageRadius, windowRadius } = selectedSize;
const spindleRadius = DIM.shaftDiameter / 2;
const driveCogWidth = 2.4;
const pinionScrewAngle = Math.PI / DIM.pinionTeeth;
const pulleyBossDepth = 2.3;
const acrylicInsertWidth = 3.0;
const hybridWidth = 3.6;
let cartridgeWidth = DIM.discWidth;
const lanePitch = () => cartridgeWidth + DIM.discGap;
const frontOffset = () => cartridgeWidth / 2 + 4.5;
const rearShellEdge = -6.75;
const faceThickness = 1.4;
const faceOffset = 2.15;
const lidSeamAngle = .156 / cageRadius;
const discLift = 34;
const { width: baseWidth, bottom: baseBottom, front: baseFront, rear: baseRear } = base;
const fasciaCrown = -48.5;
const modelHeight = discY + cageRadius - baseBottom;
const viewScale = modelHeight / (sizeFamilies[0].outerRadius - baseBottom);
const overviewTarget = new THREE.Vector3(discX, -10 + (modelHeight - (sizeFamilies[0].outerRadius - baseBottom)) / 2, 0);
const wallZ = -30.5;
const footBoltPitch = 50;
const portY = -76.8;
const portZ = -12.95;
const usbSocket = Object.freeze({ width: 8.94, height: 3.26, depth: 7.35, recess: .6 });
const usbBoardEdge = 56.9;
const linkZ = -10.5;
const motorEarZ = -3.9;
const motorEarThickness = 1.5;
const motorDeckBack = -6.2;
const M3 = Object.freeze({ shank: 3, clearance: 3.4, head: 5.5, washer: 6, nut: 5.5 });
const activeDiscs = count => count === 3 ? ['A', 'B', 'C'] : ['A', 'B'];
const laneOf = (name, count) => count - 1 - activeDiscs(count).indexOf(name);
const laneZ = lane => -.45 + lane * lanePitch();
const skeletonVariants = ['2-printed', '3-printed', '2-hybrid', '3-hybrid'];
const skeletonLoader = new STLLoader();
const driveVariants = ['motor-pulley', 'spindle-pulley', 'drive-cog-printed', 'drive-cog-hybrid', 'idler-printed', 'idler-hybrid',
    'motor-section', 'spindle-section'];
const [skeletonMeshes, baseMesh, keeperMesh, driveMeshes, panelMeshes] = await Promise.all([
    Promise.all(skeletonVariants.map(async variant =>
        [variant, await skeletonLoader.loadAsync(`./cad/skeleton/${selectedSize.name}-${variant}.stl`)])).then(Object.fromEntries),
    skeletonLoader.loadAsync('./cad/skeleton/common-base.stl'),
    skeletonLoader.loadAsync('./cad/skeleton/bearing-keeper.stl'),
    Promise.all(driveVariants.map(async variant => {
        const geometry = await skeletonLoader.loadAsync(`./cad/drive-parts/${variant}.stl`);
        if (variant.endsWith('pulley') || variant.endsWith('section')) {
            geometry.translate(0, 0, -pulleyWidth / 2);
            if (variant.startsWith('spindle-')) geometry.rotateX(Math.PI);
        } else {
            const width = variant.endsWith('hybrid') ? hybridWidth : DIM.discWidth;
            geometry.translate(0, 0, -width / 2 - DIM.lipExtension);
        }
        return [variant, geometry];
    })).then(Object.fromEntries),
    Promise.all(Object.entries({front:'front',rear:'rear',side:'side',apron:`${selectedSize.name}-apron`})
        .map(async ([part,file]) => [part, await skeletonLoader.loadAsync(`./cad/case-panels/${file}.stl`)]))
        .then(Object.fromEntries)
]);

const viewport = document.getElementById('viewport');
const labelsLayer = document.getElementById('labels');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x07090b, 0.0015 / viewScale);

const camera = new THREE.PerspectiveCamera(23, 1, 0.1, 2600);
camera.position.copy(overviewTarget).add(new THREE.Vector3(0, 0, 475 * viewScale));

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.localClippingEnabled = true;
viewport.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.minDistance = 135;
controls.maxDistance = 710 * viewScale;
controls.target.copy(overviewTarget);

scene.add(new THREE.HemisphereLight(0xc9deff, 0x130e09, 1.55));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
keyLight.position.set(-65, 90, 120);
keyLight.castShadow = true;
scene.add(keyLight);
const cyanLight = new THREE.PointLight(0x3dcfff, 42, 240, 2);
cyanLight.position.set(80, 5, 55);
scene.add(cyanLight);
const amberLight = new THREE.PointLight(0xff982b, 34, 220, 2);
amberLight.position.set(-80, -30, 50);
scene.add(amberLight);
const rearLight = new THREE.DirectionalLight(0xbcd7fa, 1.15);
rearLight.position.set(-40, 30, -100);
scene.add(rearLight);

const mat = {
    chassis: new THREE.MeshStandardMaterial({ color: 0x516170, metalness: 0.22, roughness: 0.51 }),
    front: new THREE.MeshStandardMaterial({ color: 0x414d5b, metalness: 0.48, roughness: 0.34 }),
    pcb: new THREE.MeshStandardMaterial({ color: 0x215858, metalness: 0.05, roughness: 0.62 }),
    guide: new THREE.MeshStandardMaterial({ color: 0xdde4e3, metalness: 0.06, roughness: 0.58 }),
    chip: new THREE.MeshStandardMaterial({ color: 0x111820, metalness: 0.09, roughness: 0.59 }),
    motorCap: new THREE.MeshStandardMaterial({ color: 0x285499, metalness: 0, roughness: 0.78 }),
    motorCan: new THREE.MeshStandardMaterial({ color: 0xb9bebd, metalness: 0.70, roughness: 0.37 }),
    fascia: new THREE.MeshStandardMaterial({ color: 0x555d66, metalness: 0.14, roughness: 0.49 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x92714b, metalness: 0.58, roughness: 0.36 }),
    belt: new THREE.MeshStandardMaterial({ color: 0x293034, metalness: 0.02, roughness: 0.88 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xd99424, emissive: 0x3c1d00, emissiveIntensity: 0.44, metalness: 0.42, roughness: 0.31 }),
    cyan: new THREE.MeshStandardMaterial({ color: 0x52cbe8, emissive: 0x083d51, emissiveIntensity: 0.58, metalness: 0.34, roughness: 0.27 }),
    violet: new THREE.MeshStandardMaterial({ color: 0xc597fc, emissive: 0x291747, emissiveIntensity: 0.68, metalness: 0.32, roughness: 0.30 }),
    idler: new THREE.MeshStandardMaterial({ color: 0xa6b5c4, metalness: 0.44, roughness: 0.38 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xcbd3dc, metalness: 0.70, roughness: 0.30 }),
    paint: new THREE.MeshBasicMaterial({ color: 0x18212a }),
    isolator: new THREE.MeshStandardMaterial({ color: 0x171a1d, roughness: 0.88 }),
    led: new THREE.MeshStandardMaterial({ color: 0x74dfff, emissive: 0x25a9df, emissiveIntensity: 3.0, metalness: 0.05, roughness: 0.2 }),
    mark: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.24 })
};

function extrude(shape, depth) {
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 48 });
    geometry.translate(0, 0, -depth / 2);
    return geometry;
}

function circleHole(shape, x, y, radius) {
    const hole = new THREE.Path();
    hole.absarc(x, y, radius, 0, TAU, true);
    shape.holes.push(hole);
}

function drawD(path, radius, flat, rotation = 0) {
    const start = Math.acos(flat / radius);
    for (let i = 0; i <= 40; i++) {
        const p = polar(radius, rotation + start + (TAU - 2 * start) * i / 40);
        if (i === 0) path.moveTo(...p);
        else path.lineTo(...p);
    }
    path.closePath();
    return path;
}

function drawDoubleD(path, radius, flat) {
    const angle = Math.acos(flat / radius);
    const halfChord = Math.sqrt(radius * radius - flat * flat);
    path.moveTo(flat, -halfChord);
    path.lineTo(flat, halfChord);
    path.absarc(0, 0, radius, angle, Math.PI - angle, false);
    path.lineTo(-flat, -halfChord);
    path.absarc(0, 0, radius, Math.PI + angle, TAU - angle, false);
    path.closePath();
    return path;
}

function createGearMesh({ teeth, depth, material, bore = 0 }) {
    const points = spurOutline(teeth, DIM.ringModule, DIM.ringBacklash);
    const shape = new THREE.Shape();
    shape.moveTo(...points[0]);
    for (const point of points.slice(1)) shape.lineTo(...point);
    shape.closePath();
    if (bore) circleHole(shape, 0, 0, bore);
    const mesh = new THREE.Mesh(extrude(shape, depth), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

function addPattern(group, material, angle, pitch, radius) {
    const pattern = new THREE.Group();
    pattern.rotation.z = angle;
    const edge = radius + 0.6;
    const count = Math.floor((radius - 2) / pitch);
    for (let i = -count; i <= count; i++) {
        const y = i * pitch;
        const halfChord = Math.sqrt(edge * edge - y * y);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(2 * halfChord, 1.2, DIM.discWidth), material);
        bar.position.y = y;
        bar.castShadow = true;
        bar.receiveShadow = true;
        pattern.add(bar);
    }
    group.add(pattern);
    return pattern;
}

function acrylicInsert(group, color, angle, pitch, radius) {
    const material = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: .63,
        roughness: .19, metalness: .06 });
    const pattern = new THREE.Group();
    pattern.rotation.z = angle;
    const seatRadius = radius + 1.2;
    const insert = new THREE.Shape();
    insert.absarc(0, 0, seatRadius, 0, TAU, false);
    const cutLimit = radius - .25;
    for (let offset = -Math.floor(cutLimit / pitch); offset < Math.floor(cutLimit / pitch); offset++) {
        const lo = (offset + .5) * pitch - (pitch - 1.2) / 2;
        const hi = (offset + .5) * pitch + (pitch - 1.2) / 2;
        const arcLo = Math.asin(lo / cutLimit);
        const arcHi = Math.asin(hi / cutLimit);
        const cut = new THREE.Path();
        cut.moveTo(...polar(cutLimit, arcLo));
        cut.absarc(0, 0, cutLimit, arcLo, arcHi, false);
        cut.lineTo(...polar(cutLimit, Math.PI - arcHi));
        cut.absarc(0, 0, cutLimit, Math.PI - arcHi, Math.PI - arcLo, false);
        cut.closePath();
        insert.holes.push(cut);
    }
    pattern.add(new THREE.Mesh(extrude(insert, acrylicInsertWidth), material));
    group.add(pattern);
    return pattern;
}

function addPhaseMark(group, radius, z) {
    const front = new THREE.Mesh(new THREE.CircleGeometry(0.65, 20), mat.mark);
    front.position.set(0, radius, z);
    group.add(front);
}

const cartridgeCanvas = document.createElement('canvas');
cartridgeCanvas.width = 384;
cartridgeCanvas.height = 70;
const inscription = cartridgeCanvas.getContext('2d');
inscription.font = 'bold 44px sans-serif';
inscription.fillStyle = '#eee6d5';
inscription.textAlign = 'center';
inscription.textBaseline = 'middle';
inscription.fillText(`${selectedSize.name} · Ø${(2 * rimRadius).toFixed(1)}`, 192, 36);
const cartridgeInk = new THREE.CanvasTexture(cartridgeCanvas);
cartridgeInk.colorSpace = THREE.SRGBColorSpace;
const inkMaterial = new THREE.MeshBasicMaterial({ map: cartridgeInk, transparent: true, depthWrite: false });

function createCartridge(material, patternAngle = 0, patternPitch = 5.2) {
    const group = new THREE.Group();
    const printed = new THREE.Group();
    const hybrid = new THREE.Group();
    const radius = windowRadius;
    const pitch = patternPitch * Math.sqrt(rimRadius / sizeFamilies[0].radius);
    printed.add(createGearMesh({
        teeth: selectedSize.teeth,
        depth: DIM.discWidth,
        material,
        bore: radius
    }));
    const printedPattern = addPattern(printed, material, patternAngle, pitch, radius);
    hybrid.add(createGearMesh({ teeth: selectedSize.teeth, depth: hybridWidth, material, bore: radius + 1.4 }));
    const acrylicPattern = acrylicInsert(hybrid, material.color, patternAngle, pitch, radius);
    for (const face of [-1, 1]) {
        const lip = washer(radius + 1.52, .28, material, radius + .6);
        lip.position.z = face * (hybridWidth - .28) / 2;
        hybrid.add(lip);
    }
    hybrid.visible = false;
    group.add(printed, hybrid);
    addPhaseMark(group, radius + 1.4, DIM.discWidth / 2 + 0.015);
    const sizeStamp = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 2.1), inkMaterial);
    sizeStamp.rotation.y = Math.PI;
    sizeStamp.position.set(0, windowRadius + 1.55, -DIM.discWidth / 2 - 0.018);
    group.add(sizeStamp);
    const phaseDot = group.children.at(-2);
    return { group, printed, hybrid, printedPattern, acrylicPattern, phaseDot, sizeStamp };
}

const gearDot = new THREE.CircleGeometry(0.5, 16);
function markGear(gear, x, depth) {
    const mark = new THREE.Mesh(gearDot, mat.paint);
    mark.position.set(x, 0, depth / 2 + 0.015);
    gear.add(mark);
    return mark;
}

function cylinder(radius, length, material, segments = 36) {
    const geometry = new THREE.CylinderGeometry(radius, radius, length, segments);
    geometry.rotateX(Math.PI / 2);
    if (segments === 6) geometry.rotateZ(Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
}

function box(width, height, depth, material, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    return mesh;
}

function washer(radius, depth, material, holeRadius = spindleRadius) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, radius, 0, TAU, false);
    circleHole(shape, 0, 0, holeRadius);
    return new THREE.Mesh(extrude(shape, depth), material);
}

function radialSetScrew(angle, flatRadius, entryRadius, diameter, z = 0) {
    const length = entryRadius - flatRadius;
    const screw = cylinder(diameter / 2, length, mat.steel, 16);
    const socket = cylinder(diameter * .28, .045, mat.chip, 6);
    socket.position.z = length / 2 + .025;
    screw.add(socket);
    const axis = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
    screw.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
    screw.position.copy(axis.multiplyScalar((flatRadius + entryRadius) / 2));
    screw.position.z = z;
    return screw;
}

function screwHead(x, y, z, material = mat.steel) {
    const head = washer(M3.head / 2, 1.9, material, 1.18);
    head.position.set(x, y, z);
    const socketBottom = cylinder(1.15, 0.3, mat.chip, 6);
    socketBottom.position.z = 0.45;
    head.add(socketBottom);
    return head;
}

function m3Nut(x, y, z) {
    const shape = new THREE.Shape();
    const radius = M3.nut / (2 * Math.cos(Math.PI / 6));
    for (let i = 0; i < 6; i++) {
        const vertex = polar(radius, i * TAU / 6);
        if (i === 0) shape.moveTo(...vertex);
        else shape.lineTo(...vertex);
    }
    shape.closePath();
    circleHole(shape, 0, 0, M3.shank / 2);
    const nut = new THREE.Mesh(extrude(shape, 2.4), mat.steel);
    nut.position.set(x, y, z);
    return nut;
}

function rearM3Screw(x, y, seatZ) {
    const stack = new THREE.Group();
    const washerThickness = .55;
    const shoulderZ = seatZ - washerThickness;
    const head = screwHead(x, y, shoulderZ - .95);
    head.rotation.y = Math.PI;
    const backWasher = washer(M3.washer / 2, washerThickness, mat.steel, M3.clearance / 2);
    backWasher.position.set(x, y, (seatZ + shoulderZ) / 2);
    const shank = cylinder(M3.shank / 2, 8, mat.steel);
    shank.position.set(x, y, shoulderZ + 4);
    stack.add(head, backWasher, shank);
    return stack;
}

function ringSector(outerRadius, innerRadius, start, end) {
    const shape = new THREE.Shape();
    shape.moveTo(...polar(outerRadius, start));
    shape.absarc(0, 0, outerRadius, start, end, false);
    shape.lineTo(...polar(innerRadius, end));
    shape.absarc(0, 0, innerRadius, end, start, true);
    shape.closePath();
    return shape;
}

function makeCaseSection(parent, start, end) {
    const plate = ringSector(cageRadius, windowRadius, start, end);
    const front = new THREE.Mesh(extrude(plate, faceThickness), mat.fascia);
    const wall = new THREE.Mesh(extrude(ringSector(cageRadius, cageRadius - DIM.shellWall, start, end), 1), mat.fascia);
    front.castShadow = wall.castShadow = true;
    parent.add(front, wall);
    return { front, wall };
}

const sculpture = new THREE.Group();
sculpture.position.y = 5;
scene.add(sculpture);

const baseCase = new THREE.Group();
const baseDepth = baseFront - baseRear;
const baseMidZ = (baseFront + baseRear) / 2;
function roundedPort(path, width, height, radius, cx = 0, cy = 0) {
    const x = cx - width / 2;
    const y = cy - height / 2;
    path.moveTo(x + radius, y);
    path.lineTo(x + width - radius, y);
    path.quadraticCurveTo(x + width, y, x + width, y + radius);
    path.lineTo(x + width, y + height - radius);
    path.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    path.lineTo(x + radius, y + height);
    path.quadraticCurveTo(x, y + height, x, y + height - radius);
    path.lineTo(x, y + radius);
    path.quadraticCurveTo(x, y, x + radius, y);
    path.closePath();
    return path;
}

const skeleton = new THREE.Mesh(skeletonMeshes['3-printed'], mat.chassis);
skeleton.name = 'One-piece motor deck and disc-guide frame';
skeleton.castShadow = skeleton.receiveShadow = true;
const commonBase = new THREE.Mesh(baseMesh, mat.chassis);
commonBase.name = 'Common electronics foot';
commonBase.castShadow = commonBase.receiveShadow = true;
sculpture.add(skeleton, commonBase);
const cradleFasteners = new THREE.Group();
for (const side of [-1, 1]) {
    const x = side * base.frameMountX;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(1.11, 1.98, .95, 32), mat.steel);
    head.position.set(x, baseBottom + .475, base.frameMountZ);
    const shank = cylinder(1, 4.05, mat.steel);
    shank.rotation.x = Math.PI / 2;
    shank.position.set(x, baseBottom + 2.975, base.frameMountZ);
    cradleFasteners.add(head, shank);
}
sculpture.add(cradleFasteners);
const shelfFeet = new THREE.Group();
for (const side of [-1, 1]) shelfFeet.add(box(22, 1.6, 29, mat.isolator, side * 39, baseBottom - 0.8, baseMidZ));
sculpture.add(shelfFeet);
const fascia = new THREE.Mesh(panelMeshes.front, mat.fascia);
fascia.scale.z = -1;
fascia.position.z = baseFront;
const rearPanel = new THREE.Mesh(panelMeshes.rear, mat.chassis);
rearPanel.position.z = baseRear;
fascia.castShadow = rearPanel.castShadow = true;
baseCase.add(fascia, rearPanel);
for (const side of [-1, 1]) {
    const sideAssembly = new THREE.Group();
    sideAssembly.scale.x = side;
    const panel = new THREE.Mesh(panelMeshes.side, mat.fascia);
    panel.rotation.y = -Math.PI / 2;
    panel.position.x = baseWidth / 2;
    panel.castShadow = true;
    sideAssembly.add(panel);
    baseCase.add(sideAssembly);
}
sculpture.add(baseCase);
const lid = new THREE.Group();
const caseBody = new THREE.Group();
const lidBody = new THREE.Group();
lid.add(lidBody);
const ringAssembly = new THREE.Group();
ringAssembly.position.set(discX, discY, 0);
ringAssembly.add(caseBody, lid);
sculpture.add(ringAssembly);
const seamLeft = Math.PI / 2 - lidHalfAngle;
const seamRight = Math.PI / 2 + lidHalfAngle;
const caseMain = makeCaseSection(caseBody, seamRight + lidSeamAngle, seamLeft + TAU - lidSeamAngle);
const caseLid = makeCaseSection(lidBody, seamLeft + lidSeamAngle, seamRight - lidSeamAngle);
const caseSections = [caseMain, caseLid];

const neckPanel = new THREE.Mesh(panelMeshes.apron, mat.fascia);
neckPanel.position.set(-discX, -discY, baseFront - 2.68);
caseBody.add(neckPanel);

const datumMark = new THREE.Mesh(new THREE.BoxGeometry(0.8, .65, .65), mat.guide);
datumMark.position.set(0, windowRadius + .15, -faceThickness / 2);
caseLid.front.add(datumMark);

// Seat the cap on two broad, non-flexing locating tongues outside the disc path.
for (const side of [-1, 1]) {
    const [edgeX, edgeY] = polar(cageRadius - 1.8, seamLeft);
    const x = side * edgeX;
    const tongue = box(2.0, 6.8, 2.0, mat.front, x, edgeY - 1.4, 0);
    lidBody.add(tongue);
    const pocket = new THREE.Group();
    pocket.position.set(x, edgeY - 3.7, 0);
    pocket.add(box(3.4, 5.4, 0.85, mat.chassis, 0, 0, -1.6),
        box(3.4, 5.4, 0.85, mat.chassis, 0, 0, 1.6),
        box(3.4, .9, 4, mat.chassis, 0, -2.45, 0));
    caseBody.add(pocket);
}

const lidStops = [82, 98].flatMap(degrees => {
    const angle = THREE.MathUtils.degToRad(degrees);
    const halfSpan = Math.atan(3.4 / cageRadius);
    const profile = ringSector(cageRadius - .4, rimRadius + DIM.lidClearance, angle - halfSpan, angle + halfSpan);
    const geometry = extrude(profile, 1.6);
    return Array.from({length:3}, (_, lane) => {
        const stop = new THREE.Mesh(geometry, mat.guide);
        lidBody.add(stop);
        return { stop, lane };
    });
});

const cartridges = {
    A: createCartridge(mat.amber),
    B: createCartridge(mat.cyan),
    C: createCartridge(mat.violet, THREE.MathUtils.degToRad(32), 5.7)
};
if (transferredLook) {
    const loader = new THREE.TextureLoader();
    await Promise.all(Object.values(cartridges).map(async ({ group, printedPattern, acrylicPattern }, index) => {
        const layer = transferredLook.layers[index];
        try {
            const map = await loader.loadAsync(layer.mask);
            map.colorSpace = THREE.SRGBColorSpace;
            const material = new THREE.MeshBasicMaterial({ map, color: layer.colour, side: THREE.DoubleSide,
                alphaTest: .35, toneMapped: false });
            const field = new THREE.Mesh(new THREE.PlaneGeometry(2 * windowRadius, 2 * windowRadius), material);
            field.rotation.z = -THREE.MathUtils.degToRad(transferredLook.layerAngle[index]);
            field.visible = layer.enabled || (index === 2 && transferredLook.count === 2);
            printedPattern.visible = acrylicPattern.visible = false;
            group.add(field);
        } catch (error) { console.warn('The transferred disc pattern could not be loaded.', error); }
    }));
}
for (const cartridge of Object.values(cartridges)) {
    cartridge.group.position.set(discX, discY, 0);
    sculpture.add(cartridge.group);
}

const colors = { A: mat.amber, B: mat.cyan, C: mat.violet };
const stationPacks = stations.map((station, stationIndex) => {
    const { id, drive, discs } = station;
    const [x, y] = spindlePositions[stationIndex];
    const { angle: beltAngle } = motorDatums(station, [x, y], selectedSize);
    const angle = Math.atan2(y - discY, x - discX);
    const group = new THREE.Group();
    group.position.set(x, y, 0);
    sculpture.add(group);
    const index = meshIndex(angle, selectedSize.teeth, DIM.pinionTeeth);
    const shaft = new THREE.Group();
    const journals = Array.from({ length: 3 }, () => cylinder(spindleRadius, 1, mat.steel));
    const shaftKeys = [
        [pulleyWidth + pulleyBossDepth, beltAngle], [driveCogWidth, index + pinionScrewAngle]
    ].map(([width, angle]) => new THREE.Mesh(
        extrude(drawD(new THREE.Shape(), spindleRadius, 1.01, angle), width), mat.steel));
    shaft.add(...journals, ...shaftKeys);
    const frontJournal = washer(3, 2.5, mat.steel, spindleRadius);
    const rearJournal = washer(3, 2.5, mat.steel, spindleRadius);
    rearJournal.position.z = -5.15;
    const frontKeeper = new THREE.Mesh(keeperMesh, mat.trim);
    const rearKeeper = new THREE.Mesh(frontKeeper.geometry, mat.trim);
    rearKeeper.position.z = -7.45;
    const frontGroove = cylinder(1.22, .5, mat.steel);
    const frontTip = cylinder(spindleRadius, .45, mat.steel);
    const frontClip = new THREE.Mesh(extrude(ringSector(2.65, 1.22, .20 * Math.PI, 1.80 * Math.PI), .5), mat.steel);
    const frontShim = washer(1.8, .25, mat.steel);
    const rearSpacer = washer(1.8, 1.85, mat.steel);
    rearSpacer.position.z = -7.475;
    shaft.add(frontGroove, frontTip, frontClip, frontShim, rearSpacer);
    group.add(shaft, frontJournal, rearJournal, frontKeeper, rearKeeper);

    const gears = [...discs].map(name => {
        const powered = name === drive;
        const type = powered ? 'drive-cog' : 'idler';
        const gear = new THREE.Mesh(driveMeshes[`${type}-printed`], powered ? colors[drive] : mat.idler);
        gear.castShadow = gear.receiveShadow = true;
        const mark = markGear(gear, 3.6, DIM.discWidth + 2 * DIM.lipExtension);
        if (powered) gear.add(radialSetScrew(pinionScrewAngle, 1.01, 3.51, 1.6));
        group.add(gear);
        return { name, powered, gear, type, mark };
    });
    const shims = Array.from({ length: 2 }, () => washer(1.8, DIM.gearShimWidth, mat.steel, 1.53));
    const sleeves = Array.from({ length: 2 }, () => washer(1.8, 1, mat.steel, 1.53));
    shaft.add(...shims, ...sleeves);
    return { id, drive, angle, group, shaft, journals, shaftKeys, frontJournal, rearJournal,
        frontKeeper, frontGroove, frontTip, frontClip, frontShim, index, gears, shims, sleeves };
});

function motorEnvelope(x, shaftY, turn) {
    const group = new THREE.Group();
    group.position.set(x, shaftY, motorEarZ);
    group.rotation.set(0, Math.PI, turn, 'ZYX');
    const body = cylinder(motor.diameter / 2, motor.depth, mat.motorCan, 64);
    body.position.set(0, -motor.shaftOffset, -motor.depth / 2);
    const boss = cylinder(4.5, 2, mat.steel);
    boss.position.z = 0.9;
    const shaft = new THREE.Mesh(extrude(drawDoubleD(new THREE.Shape(), motor.shaftDiameter / 2, motor.shaftFlats / 2), motor.shaftTip), mat.steel);
    shaft.position.z = motor.shaftTip / 2;
    const shaftDot = new THREE.Mesh(gearDot, mat.paint);
    shaftDot.position.set(1.2, 0, motor.shaftTip / 2 + 0.02);
    shaft.add(shaftDot);
    group.add(body, boss, shaft);
    for (const z of [-motor.depth + .35, -1.25]) {
        const seam = washer(motor.diameter / 2 + .18, .3, mat.steel, motor.diameter / 2 - .25);
        seam.position.set(0, -motor.shaftOffset, z);
        group.add(seam);
    }
    const plugZ = -motor.depth + 5.5;
    const cap = new THREE.Mesh(extrude(roundedPort(new THREE.Shape(), 13, 8, 1.25), 11.7), mat.motorCap);
    // The plastic end face projects beyond the metal can so their faces cannot flicker.
    cap.position.set(0, -18.6, plugZ - .35);
    group.add(cap, box(8.8, 1.1, 5, mat.chip, 0, -22.65, plugZ));
    group.updateMatrix();
    const cableExit = new THREE.Vector3(0, -22.9, plugZ).applyMatrix4(group.matrix);
    for (const side of [-1, 1]) {
        const x = side * motor.earSpacing / 2;
        const ear = washer(3.4, motorEarThickness, mat.steel, motor.earHole / 2);
        ear.position.set(x, -motor.shaftOffset, -motorEarThickness / 2);
        group.add(ear, box(5, 5.5, motorEarThickness, mat.steel, x - side * 4, -motor.shaftOffset, ear.position.z));
    }
    return { group, shaft, cableExit };
}

function pulley(material, motorEnd) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(driveMeshes[motorEnd ? 'motor-pulley' : 'spindle-pulley'], material);
    mesh.castShadow = mesh.receiveShadow = true;
    const bossCentre = (motorEnd ? 1 : -1) * (pulleyWidth + pulleyBossDepth) / 2;
    group.add(mesh, radialSetScrew(0, motorEnd ? motor.shaftFlats / 2 : 1.01, 3.82, 2, bossCentre));
    markGear(group, 4.05, pulleyWidth);
    return group;
}

function capsule(path, x, yTop, yBottom, radius) {
    path.moveTo(x + radius, yTop);
    path.absarc(x, yTop, radius, 0, Math.PI, false);
    path.lineTo(x - radius, yBottom);
    path.absarc(x, yBottom, radius, Math.PI, TAU, false);
    path.closePath();
    return path;
}

const beltBody = capsule(new THREE.Shape(), 0, beltCentres, 0, beltLandRadius + belt.backing);
beltBody.holes.push(capsule(new THREE.Path(), 0, beltCentres, 0, beltLandRadius));
const beltBodyGeometry = extrude(beltBody, belt.width);
const beltToothShape = new THREE.Shape();
const { toothHalfWidth: toothW, toothDepth: toothH } = belt;
beltToothShape.moveTo(-toothW, -.16);
for (const [x, y] of [[toothW, -.16], [toothW, 0], [toothW * .84, toothH * .27],
    [toothW * .66, toothH * .57], [toothW * .38, toothH * .87], [0, toothH],
    [-toothW * .38, toothH * .87], [-toothW * .66, toothH * .57], [-toothW * .84, toothH * .27], [-toothW, 0]]) {
    beltToothShape.lineTo(x, y);
}
beltToothShape.closePath();
// Recess the preview teeth's end faces slightly so they do not fight the backing.
const beltToothGeometry = extrude(beltToothShape, belt.width - .02);
const beltToothPose = new THREE.Object3D();

function drawBelt([x, y], angle, material = mat.belt) {
    const loop = new THREE.Group();
    loop.position.set(x, y, linkZ);
    loop.rotation.z = angle;
    loop.add(new THREE.Mesh(beltBodyGeometry, material));
    const teeth = new THREE.InstancedMesh(beltToothGeometry, material, belt.length / belt.pitch);
    teeth.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    teeth.frustumCulled = false;
    loop.add(teeth);
    placeBeltTeeth(teeth, 0);
    return { loop, teeth };
}

function placeBeltTeeth(teeth, advance) {
    const offset = THREE.MathUtils.euclideanModulo(advance, belt.pitch);
    for (let index = 0; index < teeth.count; index++) {
        const [x, y, angle] = beltTrack(index * belt.pitch + offset);
        beltToothPose.position.set(x, y, 0);
        beltToothPose.rotation.z = angle + Math.PI / 2;
        beltToothPose.updateMatrix();
        teeth.setMatrixAt(index, beltToothPose.matrix);
    }
    teeth.instanceMatrix.needsUpdate = true;
}

function updateBelt(drive, rotation) {
    const advance = rotation * beltPitchRadius;
    placeBeltTeeth(drive.beltTeeth, advance);
    const [x, y] = beltTrack(advance, beltPitchRadius);
    drive.marker.position.set(x, y, -belt.width / 2 - 0.055);
}

const driverTray = new THREE.Group();
const wiring = new THREE.Group();
wiring.visible = false;
sculpture.add(driverTray, wiring);
const harnessMaterials = [0xd55645, 0xeaa94a, 0xe0ce57, 0xb85d9c, 0x5f90cd, 0x77818b, 0x43aa91]
    .map(color => new THREE.MeshStandardMaterial({ color, roughness: .68 }));
const phasePins = { A: [1, 2, 3, 4], B: [5, 6, 7, 8], C: [9, 10, 11, 12] };
const wiringSelect = document.getElementById('wireSelect');
const wireLabelsToggle = document.getElementById('wireLabelsToggle');
const wireMeshes = [];
const wireEnds = new Map();
for (const [channel, pins] of Object.entries(phasePins)) {
    document.getElementById(`pins${channel}`).textContent = `GPIO ${pins.join(' · ')}`;
    pins.forEach((pin, i) => {
        const option = new Option(`GPIO ${pin} → ${channel} IN${i + 1}`, `gpio-${pin}`);
        option.dataset.channel = channel;
        document.getElementById('signalTraceOptions').appendChild(option);
    });
}
const espHeaderRows = [['TX', 'RX', 1, 2, 3, 4, 5, 6, 7], ['5V', 'GND', '3V3', 13, 12, 11, 10, 9, 8]];
const espPins = Object.fromEntries(espHeaderRows.flatMap((row, rail) =>
    row.map((pin, i) => [pin, [usbBoardEdge - 1.6 - i * 2.54, portY + [7.62, -7.62][rail], portZ + .43]])));
const inletPins = [[-51.5, portY - 2.1, portZ + .2], [-51.5, portY + 2.1, portZ + .2]];
const disconnect = [29.6, base.floor + 1.7, 16.1];
const loomY = base.floor + .58;

function edgeLoom(side, lane = 0) {
    // The run dips below the PCB and passes inboard of the side post.
    const inner = side * (52.9 - lane * .23);
    return [[side * 53.7, -87.5, portZ + 1.5], [inner, loomY, -8.6], [inner, loomY, .3],
        [side * 53.6, loomY, 12.8], [side * 51.8, loomY, 16.35]];
}

function wirePath(id, points, color, radius = .17) {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 42, radius, 5, false), harnessMaterials[color]);
    wireMeshes.push({ id, mesh });
    return mesh;
}

function pcbSilkscreen(width, height, rows) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f7f1d6';
    for (const [label, x, y, size = 22] of rows) {
        ctx.font = `bold ${size}px monospace`;
        ctx.fillText(label, x, y);
    }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
}

function driverBoard(channel) {
    const seatX = { A: base.driverPitch, B: -base.driverPitch, C: 0 }[channel];
    const seatY = base.driverY;
    const seatZ = channel === 'C' ? base.centreDriverZ : base.driverZ;
    const boardX = 0;
    const card = new THREE.Group();
    const rotation = new THREE.Matrix4().makeRotationX(Math.PI / 2)
        .premultiply(new THREE.Matrix4().makeRotationY(channel === 'C' ? -Math.PI / 2 : Math.PI));
    const reference = new THREE.Vector3(0, -79, -16);
    const seat = new THREE.Vector3(seatX, seatY, seatZ);
    const pose = (x, y, z) => new THREE.Vector3(x, y, z).sub(reference).applyMatrix4(rotation).add(seat).toArray();
    const boardSize = { width: 35, height: 32, thickness: 1.6 };
    const w = boardSize.width / 2;
    const h = boardSize.height / 2;
    const profile = roundedPort(new THREE.Shape(), w * 2, h * 2, 1.1);
    for (const x of [-w + 2.35, w - 2.35]) {
        for (const y of [-h + 2.35, h - 2.35]) circleHole(profile, x, y, 1.13);
    }
    const pcb = new THREE.Mesh(extrude(profile, boardSize.thickness), mat.pcb);
    pcb.position.set(boardX, -79, -16);
    card.add(pcb, box(7.1, 18.7, 2.7, mat.chip, boardX - 2.5, -79.15, -18.1));
    for (const side of [-1, 1]) {
        for (let i = 0; i < 8; i++) {
            card.add(box(1.75, .62, .68, mat.steel, boardX - 2.5 + side * 4.05, -87.6 + 2.4 * i, -17.35));
        }
    }
    for (let i = 0; i < 4; i++) {
        const x = boardX - 12 + i * 2.55;
        const led = new THREE.Mesh(new THREE.SphereGeometry(.78, 14, 10), mat.amber);
        led.position.set(x, -67.2, -17.65);
        card.add(led, box(1.6, 2.1, .75, mat.chip, x, -71.1, -17.2));
    }
    for (const side of [-1, 1]) {
        card.add(box(1, 5.8, 5.6, mat.guide, boardX + 7 + side * 7.1, -72.3, -18.9));
    }
    card.add(box(15.2, 1.25, 5.6, mat.guide, boardX + 7, -69.65, -18.9),
        box(15.2, 5.8, .85, mat.guide, boardX + 7, -72.3, -21.45),
        box(14.8, 7.5, 5.7, mat.guide, boardX + 7, -74.3, -18.9));
    const motorPins = Array.from({ length: 5 }, (_, i) => [boardX + 7 + (i - 2) * 2.5, -78.05, -18.9]);
    const inputPins = Array.from({ length: 4 }, (_, i) => [boardX - 7.0 - (i - 1.5) * 2.54, -93.25, -18.6]);
    const powerPins = [boardX + 8.24, boardX + 5.7].map(x => [x, -93.25, -18.6]);
    for (const [x, y, z] of [...inputPins, ...powerPins]) {
        card.add(box(2.26, 2.44, 2.1, mat.chip, x, y + .9, z),
            box(.64, 2.1, .64, mat.steel, x, y - .85, z),
            box(1.94, 1.95, 1.9, mat.chip, x, y - 1.4, z));
    }
    const markings = pcbSilkscreen(35, 32, [
        ['A B C D', 294, 56], ['ULN2003A', 315, 292], [channel, 440, 329],
        ...inputPins.map(([x], i) => [`IN${i+1}`, (w - x + boardX) / boardSize.width * 512 - 14, 444, 15]),
        ...powerPins.map(([x], i) => [['+', '−'][i], (w - x + boardX) / boardSize.width * 512 - 6, 444, 18])
    ]);
    markings.rotation.y = Math.PI;
    markings.position.set(boardX, -79, -16.81);
    card.add(markings);
    card.quaternion.setFromRotationMatrix(rotation);
    card.position.copy(seat).sub(reference.clone().applyMatrix4(rotation));
    const board = new THREE.Group();
    board.add(card);
    const keepers = new THREE.Group();
    for (const side of [-1, 1]) {
        const [x, , z] = pose(side * (w - 2.35), -79 + side * (h - 2.35), -16);
        const head = cylinder(1.7, .55, mat.steel, 24);
        head.rotation.x = -Math.PI / 2;
        head.position.set(x, seatY + 1.08, z);
        const socket = cylinder(.64, .07, mat.chip, 6);
        socket.rotation.x = -Math.PI / 2;
        socket.position.set(x, seatY + 1.38, z);
        keepers.add(head, socket);
    }
    return { board, boardX: seatX, keepers,
        motorPins: motorPins.map(point => pose(...point)),
        inputPins: inputPins.map(([x, y, z]) => pose(x, y - 2.4, z)),
        powerPins: powerPins.map(([x, y, z]) => pose(x, y - 2.4, z)) };
}

const drives = stationPacks.map((pack, index) => {
    const root = new THREE.Group();
    const spindle = spindlePositions[index];
    const { axis, angle: beltAngle, yaw, ears } = motorDatums(stations[index], spindle, selectedSize);
    const realMotor = motorEnvelope(...axis, yaw);
    const pulleys = [spindle, axis].map(([x, y], i) => {
        const wheel = pulley(colors[pack.drive], i === 1);
        wheel.position.set(x, y, linkZ);
        root.add(wheel);
        return wheel;
    });
    const marker = new THREE.Mesh(new THREE.SphereGeometry(.39, 12, 8), mat.mark);
    const { loop: timingBelt, teeth: beltTeeth } = drawBelt(axis, beltAngle);
    timingBelt.add(marker);
    root.add(realMotor.group, timingBelt);
    const motorScrews = new THREE.Group();
    for (const [sx, sy] of ears) {
        const earFace = motorEarZ + motorEarThickness;
        const frontWasher = washer(M3.washer / 2, .5, mat.steel, M3.clearance / 2);
        frontWasher.position.set(sx, sy, earFace + .25);
        motorScrews.add(rearM3Screw(sx, sy, motorDeckBack), frontWasher, m3Nut(sx, sy, earFace + .5 + 1.2));
    }
    root.add(motorScrews);
    const { board, boardX, keepers, motorPins, inputPins, powerPins } = driverBoard(pack.drive);
    driverTray.add(board, keepers);
    const [cx, cy, cz] = realMotor.cableExit.toArray();
    const harness = new THREE.Group();
    const motorWireId = `motor-${pack.drive}`;
    wireEnds.set(motorWireId, [
        [`Motor ${pack.drive} lead`, [cx, cy, cz]],
        [`ULN2003 ${pack.drive} · 5-pin motor socket`, motorPins[2]]
    ]);
    motorPins.forEach((pin, i) => {
        const spread = (i - 2) * .43;
        const x = cx + spread * Math.cos(yaw);
        const y = cy + spread * Math.sin(yaw);
        const reliefX = x + 1.4 * Math.sin(yaw);
        const crossY = Math.min(y - 2.1, -84.15);
        const route = pack.drive === 'C'
            ? [[reliefX, y - 1.4 * Math.cos(yaw), cz], [reliefX, crossY, cz], [pin[0] + 2, -84.9, pin[2]]]
            : [[reliefX, y - 1.4 * Math.cos(yaw), cz], [reliefX, crossY, 7],
                [reliefX, crossY, -5.9], [pin[0], -83.85, -5.9]];
        harness.add(wirePath(motorWireId, [[x, y, cz], ...route, pin], i));
    });
    inputPins.forEach((pin, i) => {
        const gpio = phasePins[pack.drive][i];
        const espPin = espPins[gpio];
        const destination = pin;
        const id = `gpio-${gpio}`;
        wireEnds.set(id, [[`ESP32-S3 · GPIO ${gpio}`, espPin], [`ULN2003 ${pack.drive} · IN${i + 1}`, destination]]);
        const entry = pack.drive === 'C'
            ? [[pin[0] + .55, loomY, 16.35], [pin[0] + .55, pin[1], pin[2]]]
            : [[pin[0], loomY, 16.35], [pin[0], pin[1] - .7, 16.45]];
        harness.add(wirePath(id, [espPin, [espPin[0], Math.min(espPin[1] - 1, -80.1), portZ+.16],
            ...edgeLoom(1, i),
            ...entry, destination], [1, 2, 6, 4][i]));
    });
    powerPins.forEach((pin, i) => {
        const id = i === 0 ? 'power' : 'ground';
        const destination = pin;
        if (!wireEnds.has(id)) wireEnds.set(id, []);
        wireEnds.get(id).push([`ULN2003 ${pack.drive} · ${i === 0 ? 'V+' : 'GND'}`, destination, pack.drive]);
        const entry = pack.drive === 'C'
            ? [[pin[0] + .55, loomY, 16.35], [pin[0] + .55, pin[1], pin[2]]]
            : [[pin[0], loomY + i * .5, 16.35]];
        harness.add(wirePath(id, [inletPins[i], ...edgeLoom(-1, i), ...entry, destination], [0,5][i], .24));
    });
    wiring.add(harness);
    sculpture.add(root);
    return { name: pack.drive, root, tags: realMotor.group, shaft: realMotor.shaft,
        pulleys, marker, beltTeeth, axis, spindle, beltAngle, yaw, motorScrews, boardX, board, keepers, harness };
});

const controller = new THREE.Group();
sculpture.add(controller);
function sideUsbBoard(side, length, width) {
    const board = new THREE.Group();
    const pcbX = side * (usbBoardEdge - length / 2);
    const pcbZ = portZ - usbSocket.height / 2 - .8;
    const faceX = baseWidth / 2 - usbSocket.recess;
    const shell = roundedPort(new THREE.Shape(), usbSocket.width, usbSocket.height, 1.28);
    shell.holes.push(roundedPort(new THREE.Path(), 8.28, 2.62, 1.10));
    const connector = new THREE.Mesh(extrude(shell, usbSocket.depth), mat.steel);
    connector.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    connector.position.set(side * (faceX - usbSocket.depth / 2), portY, portZ);
    board.add(connector, box(length, width, 1.6, mat.pcb, pcbX, portY, pcbZ),
        box(.42, 8.2, 2.61, mat.chip, side * (faceX - usbSocket.depth + .22), portY, portZ),
        box(usbSocket.depth - 1.15, 6.55, .58, mat.chip, side * (faceX - (usbSocket.depth + 1.15) / 2), portY, portZ));
    for (const edge of [-1, 1]) {
        const boardEdge = portY + edge * width / 2;
        controller.add(box(length - 1.4, 2.1, .9, mat.chassis, pcbX, boardEdge + edge * .36, pcbZ - 1.28),
            box(length - 1.4, .85, 2.65, mat.chassis, pcbX, boardEdge + edge * .65, pcbZ),
            box(length - 1.4, 1.55, .75, mat.front, pcbX, boardEdge + edge * .43, pcbZ + 1.22));
    }
    const braceH = portY + width / 2 - base.floor;
    controller.add(box(2.5, braceH, 1.5, mat.chassis, side * (usbBoardEdge - length + 1.4),
        base.floor + braceH / 2, pcbZ - 1.65), board);
    return board;
}
const esp32 = sideUsbBoard(1, 23.5, 18);
esp32.add(box(9, 12, 2.4, mat.steel, usbBoardEdge - 12.5, portY, portZ - .4),
    box(2.5, 9, .55, mat.trim, usbBoardEdge - 21.6, portY, portZ - 1.4));
for (const [x, y, z] of Object.values(espPins)) {
    esp32.add(box(1.87, 1.8, 1.82, mat.chip, x, y, z - .86),
        box(.60, .62, .28, mat.steel, x, y, z));
}
const inlet = sideUsbBoard(-1, 16, 13);
inlet.add(box(5, 6.5, 2.4, mat.chip, -usbBoardEdge + 11, portY, portZ -.4));
const serviceJumper = box(4.8, 2.2, 1.24, mat.chip, ...disconnect);
controller.add(serviceJumper);
const espStop = new THREE.Group();
for (const y of [portY - 9.55, portY + 9.55]) {
    espStop.add(box(1.05, 2.45, 2.10, mat.trim, usbBoardEdge + .12, y, portZ - 2.1),
        box(3.25, 2.55, .8, mat.trim, usbBoardEdge - 1.2, y, portZ -.4));
    const screw = cylinder(1.25, .65, mat.steel, 18);
    screw.position.set(usbBoardEdge - 1.5, y, portZ + .28);
    espStop.add(screw);
}
controller.add(espStop);
wiring.add(
    wirePath('power', [inletPins[0], ...edgeLoom(-1),
        [24, loomY, 16.36], [disconnect[0] - 2.4, disconnect[1], disconnect[2]]], 0, .24),
    wirePath('power', [[disconnect[0] + 2.4, disconnect[1], disconnect[2]],
        ...edgeLoom(1).reverse(), espPins['5V']], 0, .24),
    wirePath('ground', [inletPins[1], ...edgeLoom(-1, 1), ...edgeLoom(1, 1).reverse(), espPins.GND], 5, .24)
);
wireEnds.get('power').push(['Left USB-C · +5 V', inletPins[0]], ['5 V disconnect', disconnect], ['ESP32-S3 · 5V', espPins['5V']]);
wireEnds.get('ground').push(['Left USB-C · GND', inletPins[1]], ['ESP32-S3 · GND', espPins.GND]);

const lightingChannel = new THREE.Mesh(new THREE.TorusGeometry(windowRadius + .65, 0.18, 8, 144, TAU - 2 * lidHalfAngle), mat.led);
lightingChannel.rotation.z = seamRight;
lightingChannel.position.z = -faceThickness / 2 - 0.27;
caseMain.front.add(lightingChannel);

const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(430 * viewScale, 320 * viewScale),
    new THREE.MeshStandardMaterial({ color: 0x070809, metalness: 0.04, roughness: 0.96, transparent: true, opacity: 0.78 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = baseBottom + sculpture.position.y - 1.65;
floor.receiveShadow = true;
scene.add(floor);

const wallHardware = new THREE.Group();
const cradleShelfRear = -25.0;
const shelfDepth = 39.5;
const adapterShelf = roundedPort(new THREE.Shape(), base.footWidth - 2, shelfDepth, 2);
for (const x of [-footBoltPitch / 2, footBoltPitch / 2]) circleHole(adapterShelf, x, -cradleShelfRear - shelfDepth / 2, 2.25);
const foldedShelf = new THREE.Mesh(extrude(adapterShelf, 2.4), mat.steel);
foldedShelf.rotation.x = Math.PI / 2;
foldedShelf.position.set(0, baseBottom - 1.2, cradleShelfRear + shelfDepth / 2);
function cleatRail(points, material) {
    const mesh = new THREE.Mesh(extrude(new THREE.Shape(points.map(point => new THREE.Vector2(...point))), 110), material);
    mesh.rotation.y = -Math.PI / 2;
    return mesh;
}
wallHardware.add(foldedShelf,
    // Two uprights leave the electronics bay accessible from the rear.
    ...[-47, 47].map(x => box(14, -58.2 - baseBottom, 2.4, mat.steel, x, (baseBottom - 58.2) / 2, -23.8)),
    cleatRail([[-28.35,-63.25],[-26.4,-63.25],[-24.8,-61],[-22.9,-61],[-22.9,-56.1],
        [-25.25,-56.1],[-25.25,-59],[-26.05,-59.9]], mat.steel),
    cleatRail([[wallZ,-68],[-28.75,-68],[-28.75,-63],[-26.55,-59.9],[-28.6,-59.9],[wallZ,-62.6]], mat.trim),
    box(18, 4, 2, mat.steel, 0, baseBottom + 2, -26.7),
    box(21, 5.6, 2, mat.trim, 0, baseBottom + 2, -29.3));
for (const side of [-1, 1]) {
    const backing = washer(5, 1.6, mat.steel, 2.25);
    backing.rotation.x = Math.PI / 2;
    backing.position.set(side * footBoltPitch / 2, base.floor + .8, 0);
    const bolt = cylinder(2, 8, mat.steel, 20);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(side * footBoltPitch / 2, baseBottom + .9, 0);
    wallHardware.add(backing, bolt,
        box(10, 8, 5.3, mat.isolator, side * 48, baseBottom + 7, -27.85),
        screwHead(side * 37, -64.6, -28.35, mat.steel));
}
const liftStop = screwHead(0, baseBottom + 2, -27.35, mat.steel);
wallHardware.add(liftStop);
sculpture.add(wallHardware);

const wallSurface = new THREE.Mesh(new THREE.PlaneGeometry(1100, 900),
    new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: .92 }));
wallSurface.position.copy(overviewTarget).setZ(wallZ);
wallSurface.receiveShadow = true;
scene.add(wallSurface);

const backlight = new THREE.Group();
backlight.position.set(discX, discY, 0);
const cassetteOuter = rimRadius - 4.60;
const diffuserRadius = cassetteOuter - 1.85;
const cassetteFront = -10;
const cassetteFolder = `cad/diffuser/${selectedSize.name.toLowerCase()}`;
const [cassetteSectors, retainerGeometry] = await Promise.all([
    Promise.all([1, 2, 3, 4].map(quarter => skeletonLoader.loadAsync(`./${cassetteFolder}/frame-${quarter}.stl`))),
    skeletonLoader.loadAsync('./cad/diffuser/retainer.stl')
]);
for (const sector of cassetteSectors) {
    const frame = new THREE.Mesh(sector, mat.chassis);
    frame.position.z = cassetteFront;
    frame.scale.z = -1;
    backlight.add(frame);
}
const diffuserMaterial = new THREE.MeshBasicMaterial({ color: 0xe7e7e4, fog: false, toneMapped: false });
const diffuser = cylinder(diffuserRadius, 2, diffuserMaterial, 128);
diffuser.position.z = -11.9;
diffuser.castShadow = false;
const lightGuide = cylinder(diffuserRadius - 1.1, 3, new THREE.MeshStandardMaterial({ color: 0x9fb5bf,
    roughness: .38, metalness: .12 }), 128);
lightGuide.position.z = -14.45;
const reflector = cylinder(diffuserRadius - .65, .35, mat.guide, 128);
reflector.position.z = -16.225;
backlight.add(diffuser, lightGuide, reflector);
const ledModules = new THREE.Group();
for (let i = 0; i < 12; i++) {
    const angle = TAU * (i + .5) / 12;
    const [x, y] = polar(diffuserRadius - .46, angle);
    const led = box(.85, Math.min(9, windowRadius * .18), 2.35, mat.led, x, y, lightGuide.position.z);
    led.rotation.z = angle;
    ledModules.add(led);
}
backlight.add(ledModules);
for (const degrees of [48, 132, 210, 330]) {
    const angle = THREE.MathUtils.degToRad(degrees);
    const [x, y] = polar(cassetteOuter, angle);
    const tangent = new THREE.Vector3(Math.sin(angle), -Math.cos(angle), 0);
    const clip = new THREE.Mesh(retainerGeometry, mat.trim);
    clip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
        new THREE.Vector3(-Math.cos(angle), -Math.sin(angle), 0), new THREE.Vector3(0, 0, -1), tangent));
    clip.position.set(x, y, cassetteFront - 2.35).addScaledVector(tangent, -4);
    backlight.add(clip);
}
const cassetteStuds = new THREE.Group();
cassetteStuds.position.copy(backlight.position);
for (const angle of [200, 340].map(THREE.MathUtils.degToRad)) {
    const [x, y] = polar(rimRadius + 5, angle);
    const post = cylinder(1.48, 10, mat.steel, 24);
    post.position.set(x, y, -10.75);
    const seatNut = cylinder(3.15, 2, mat.steel, 6);
    seatNut.position.set(x, y, -9);
    const thumbNut = cylinder(3.4, 2.5, mat.trim, 24);
    thumbNut.position.set(x, y, -14.45);
    cassetteStuds.add(post, seatNut, screwHead(x, y, -5.30, mat.steel));
    backlight.add(thumbNut);
}
sculpture.add(backlight, cassetteStuds);

const anchors = [];
function addLabel(name, parent, position) {
    const anchor = new THREE.Object3D();
    anchor.position.copy(position);
    parent.add(anchor);
    const element = document.createElement('div');
    element.className = 'part-label';
    element.textContent = name;
    labelsLayer.appendChild(element);
    const item = { anchor, element };
    anchors.push(item);
    return item;
}

const wallLabels = [
    addLabel('Metal cleat pair', wallHardware, new THREE.Vector3(-26, -60, -27)),
    addLabel('Anti-lift fastener', wallHardware, new THREE.Vector3(0, -98, -28)),
    addLabel('Metal shelf · two M4 through-bolts', wallHardware, new THREE.Vector3(27, baseBottom - 1.5, -3))
];
const controllerFitLabels = drives.map(({ name, board, boardX }) => {
    const label = addLabel(`ULN2003 ${name} · low deck`, board, new THREE.Vector3(boardX, base.driverY, base.driverZ - 8));
    label.element.dataset.disc = name;
    label.shift = { x: 0, y: name === 'C' ? -22 : 8 };
    return label;
});
wallLabels[0].shift = { x: -30, y: 20 };
wallLabels[1].shift = { x: -30, y: -25 };
wallLabels[2].shift = { x: 42, y: -9 };
const backlightLabels = [
    addLabel('Removable diffuser cassette', backlight, new THREE.Vector3(0, diffuserRadius * .62, -17.3)),
    addLabel('Rear rim clip', backlight, new THREE.Vector3(...polar(cassetteOuter, 132 * Math.PI / 180), -18)),
    addLabel('M3 studs on the cradle', cassetteStuds, new THREE.Vector3(...polar(rimRadius + 5, 200 * Math.PI / 180), -12))
];
backlightLabels[0].shift = { x: -66, y: 8 };
backlightLabels[1].shift = { x: 20, y: -22 };
backlightLabels[2].shift = { x: 0, y: 15 };

for (const [id, endpoints] of wireEnds) {
    endpoints.forEach(([name, point, channel], i) => {
        const label = addLabel(name, sculpture, new THREE.Vector3(...point));
        label.wiringOnly = true;
        label.traceId = id;
        label.traceChannel = channel;
        label.shift = { x: 0, y: endpoints.length === 2 ? (i === 0 ? 18 : -22) : 20 + (i % 2) * 30 };
    });
}

const stationLabels = {};
const bearingLabels = [];
for (const pack of stationPacks) {
    const label = addLabel(`${pack.drive} grooved rim cog`, pack.group, new THREE.Vector3());
    label.shift = { x: pack.drive === 'A' ? 21 : pack.drive === 'B' ? -21 : 0, y: 19 };
    if (pack.drive) label.element.dataset.disc = pack.drive;
    stationLabels[pack.id] = label;
    const bearingLabel = addLabel('MR63ZZ · outer-race keeper', pack.frontKeeper, new THREE.Vector3(0, 0, 0));
    bearingLabel.shift = { x: 4, y: 19 };
    bearingLabel.element.hidden = true;
    bearingLabels.push(bearingLabel);
    const clipLabel = addLabel('Retaining clip · inner-race shim', pack.frontClip, new THREE.Vector3());
    clipLabel.shift = { x: 2, y: -29 };
    clipLabel.element.hidden = true;
    bearingLabels.push(clipLabel);
}
for (const side of [-1, 1]) {
    const guideLabel = addLabel('Integral slot guides', skeleton, new THREE.Vector3(discX + side * (rimRadius + 6.55), discY + 3, -5.6));
    guideLabel.shift = { x: side * -30, y: 16 };
    guideLabel.hideInWiring = true;
}
const detailedLabels = [];
for (const drive of drives) {
    const label = addLabel(`Motor ${drive.name} · 28BYJ-48 · 5 V`, drive.tags, new THREE.Vector3(0, -8, -10));
    label.shift = { x: drive.name === 'A' ? 32 : drive.name === 'B' ? -32 : 0, y: -19 };
    label.element.dataset.disc = drive.name;
    detailedLabels.push(label);
    const pins = phasePins[drive.name];
    const gpio = `${pins[0]}–${pins.at(-1)}`;
    const driverLabel = addLabel(`ULN2003 ${drive.name} · GPIO ${gpio}`, drive.board, new THREE.Vector3(drive.boardX, base.driverY + 3, -14));
    driverLabel.element.dataset.disc = drive.name;
    driverLabel.shift = { x: 0, y: 3 };
    driverLabel.wiringOnly = true;
}
const bridgeLabel = addLabel(`${selectedSize.name} drive frame`, skeleton, new THREE.Vector3(discX + 14, discY - rimRadius - 4, rearShellEdge));
bridgeLabel.shift = { x: 96, y: 2 };
detailedLabels.push(bridgeLabel, ...Object.values(stationLabels));
const espLabel = addLabel('ESP32-S3 · USB-C data', esp32, new THREE.Vector3(56, portY, portZ));
espLabel.shift = { x: -15, y: -30 };
const powerLabel = addLabel('USB-C · 5 V in', inlet, new THREE.Vector3(-55, portY, portZ));
powerLabel.shift = { x: 0, y: -30 };
const jumperLabel = addLabel('ESP32 5 V disconnect', serviceJumper, new THREE.Vector3(0, 0, 0));
jumperLabel.shift = { x: 15, y: -49 };
for (const item of [espLabel, powerLabel, jumperLabel]) item.wiringOnly = true;
for (const item of detailedLabels) {
    item.hideInWiring = true;
}
const espTrayLabels = [
    addLabel('Remove the two edge retainers', espStop, new THREE.Vector3(56, portY - 9.55, portZ)),
    addLabel('ESP32-S3 · upright slide rails', esp32, new THREE.Vector3(49, portY, portZ))
];
espTrayLabels[0].shift = { x: -25, y: 23 };
espTrayLabels[1].shift = { x: 22, y: 22 };

const playBtn = document.getElementById('playBtn');
const loadBtn = document.getElementById('loadBtn');
const loadControls = document.getElementById('loadControls');
const loadStatus = document.getElementById('loadStatus');
const slotSelect = document.getElementById('slotSelect');
const modeSelect = document.getElementById('motionMode');
const speedB = document.getElementById('speedB');
const speedC = document.getElementById('speedC');
const discCountButtons = [...document.querySelectorAll('#discCount button')];
const inspectionButtons = [...document.querySelectorAll('[data-inspection] button')];
const sizeSelect = document.getElementById('discSize');
const mountMode = document.getElementById('mountMode');
const backlightMode = document.getElementById('backlightMode');
const installNote = document.getElementById('installNote');
mountMode.value = params.get('mount') === 'wall' ? 'wall' : 'shelf';
backlightMode.value = 'off';
let installationInspection = '';
const cutawayBtn = document.getElementById('cutawayBtn');
const cutawayControls = document.getElementById('cutawayControls');
const cutawayDrive = document.getElementById('cutawayDrive');
let cutaway;
let printLayout;
for (const family of sizeFamilies) {
    sizeSelect.add(new Option(`${family.name} · Ø ${(2 * family.radius).toFixed(1)} mm`, family.name));
}
sizeSelect.value = selectedSize.name;
const cartridgeSelect = document.getElementById('cartridgeBuild');
cartridgeSelect.value = params.get('build') === 'hybrid' ? 'hybrid' : 'printed';
cartridgeWidth = cartridgeSelect.value === 'hybrid' ? hybridWidth : DIM.discWidth;
const cycleInput = document.getElementById('cycle');
const cycleValue = document.getElementById('cycleValue');
const crankInput = document.getElementById('crank');
const crankValue = document.getElementById('crankValue');
const explodeInput = document.getElementById('explode');
const explodeValue = document.getElementById('explodeValue');
const labelsToggle = document.getElementById('labelsToggle');
const lightsToggle = document.getElementById('lightsToggle');
const platesToggle = document.getElementById('platesToggle');
const assemblySelect = document.getElementById('assemblyStep');
const wiringDiagram = document.getElementById('wiringDiagram');
const espTrayBtn = document.getElementById('espTrayBtn');
const espTrayStatus = document.getElementById('espTrayStatus');
const assemblyStatus = document.getElementById('assemblyStatus');
const alignmentStatus = document.getElementById('alignmentStatus');
const phaseStatus = alignmentStatus.querySelector('span');
const angleOutputs = Object.fromEntries(['A', 'B', 'C'].map(name => [name, document.getElementById(`angle${name}`)]));

let discCount = 3;
const speeds = { A: 1, B: Number(speedB.value), C: Number(speedC.value) };
let running = true;
let basePhase = 0;
const discPhases = { A: 0, B: 0, C: 0 };
const currentRpm = { A: 0, B: 0, C: 0 };
const driftAmount = 0.25;
let liveSeconds = 0;
let cycleSeconds = Number(cycleInput.value);
let lastTime = performance.now();
let serviceTarget = 0;
let serviceProgress = 0;

function selectSize() {
    const next = new URLSearchParams({ size: sizeSelect.value, build: cartridgeSelect.value, mount: mountMode.value });
    if (transferredLook && params.has('look')) next.set('look', params.get('look'));
    location.hash = next;
}
window.addEventListener('hashchange', () => location.reload());

function orbitDiscLook() {
    const layerAngle = Object.values(cartridges).map(({ group }, index) =>
        (transferredLook?.layerAngle[index] ?? 0) - THREE.MathUtils.radToDeg(group.rotation.z));
    const count = discCount;
    const diameter = rimRadius * 2;
    if (transferredLook) return { ...transferredLook, layerAngle, count, diameter };
    const patternParams = { shape: 'lines', warpType: 'none', cellCount: 5.2 * Math.sqrt(rimRadius / sizeFamilies[0].radius), stroke: 1.2 };
    const list = Object.values(cartridges);
    return MoireLook.capture({ params: patternParams, span: 2 * windowRadius, diameter, count, layerAngle,
        colours: Object.values(colors).map(material => `#${material.color.getHexString()}`),
        draw(ctx, index) {
            const { printedPattern } = list[index];
            const scale = 256 / windowRadius;
            ctx.translate(256, 256);
            ctx.scale(scale, -scale);
            ctx.rotate(printedPattern.rotation.z);
            ctx.fillStyle = '#ffffff';
            for (const bar of printedPattern.children) {
                const { width, height } = bar.geometry.parameters;
                ctx.fillRect(-width / 2, bar.position.y - height / 2, width, height);
            }
        }
    });
}

for (const id of ['orbitDesignLink', 'orbitSpindleLink']) MoireLook.bind(document.getElementById(id), orbitDiscLook);

function updatePinions(motion) {
    for (const pack of stationPacks) {
        pack.shaft.rotation.z = pack.drive ? motion[pack.drive].spindle : 0;
        for (const { name, powered, gear } of pack.gears) {
            const lift = cartridges[name].group.position.y - discY;
            const offset = lift > 0 ? liftIndexOffset(pack.angle, lift, driveAngles[name], selectedSize) : 0;
            gear.rotation.z = pack.index + (powered ? motion[name].spindle : pinionPhase(motion[name].disc, offset, selectedSize.teeth));
        }
    }
    for (const drive of drives) {
        const channel = motion[drive.name];
        drive.pulleys[0].rotation.z = drive.beltAngle + channel.spindle;
        drive.pulleys[1].rotation.z = drive.beltAngle + channel.input;
        drive.shaft.rotation.z = drive.yaw - drive.beltAngle - channel.input;
        updateBelt(drive, channel.input);
    }
}

const driveAngles = Object.fromEntries(stationPacks.map(({ drive, angle }) => [drive, angle]));

const channelStates = () => Object.fromEntries(Object.entries(speeds).map(([name, speed]) => [name, channelMotion(discPhases[name], speed, selectedSize.teeth)]));
const rpmOutputs = Object.fromEntries(['A', 'B', 'C'].map(name => [name, document.getElementById(`rpm${name}`)]));

function writeRpm(name, discRpm, motorRpm) {
    const format = rpm => `${rpm < 0 ? '−' : '+'}${Math.abs(rpm).toFixed(2)}`;
    const display = `${format(discRpm)} / ${format(motorRpm)}`;
    if (rpmOutputs[name].textContent !== display) rpmOutputs[name].textContent = display;
}

function syncPhases(phase) {
    basePhase = phase;
    for (const name of Object.keys(discPhases)) discPhases[name] = phase;
}

function updateRpmReadout() {
    const allowance = modeSelect.value === 'drift' ? 1 + driftAmount : 1;
    const limit = shortestCycle(Math.max(...activeDiscs(discCount).map(name => Math.abs(speeds[name]))) * allowance, selectedSize.ratio);
    cycleInput.max = String(Math.max(540, limit + 240, cycleSeconds));
    cycleInput.min = String(limit);
    cycleSeconds = Math.max(limit, cycleSeconds);
    cycleInput.value = String(cycleSeconds);
    cycleValue.textContent = `${cycleSeconds} s`;
    for (const name of ['A', 'B', 'C']) {
        const { discRpm, motorRpm } = rpmAtCycle(speeds[name], cycleSeconds, selectedSize.ratio);
        writeRpm(name, discRpm, motorRpm);
    }
}

function updateDriveReadout() {
    for (const button of discCountButtons) button.setAttribute('aria-pressed', String(Number(button.dataset.count) === discCount));
    for (const [select, name, other] of [[speedB, 'B', 'C'], [speedC, 'C', 'B']]) {
        for (const option of select.options) option.disabled = Math.abs(Number(option.value)) === Math.abs(speeds[other]);
        select.value = String(speeds[name]);
    }
    const signed = speed => `${speed < 0 ? '−' : '+'}${Math.abs(speed)}×`;
    document.getElementById('ratioReadout').textContent = `A +1× · B ${signed(speeds.B)}${discCount === 3 ? ` · C ${signed(speeds.C)}` : ''}`;
    document.getElementById('thirdDrive').hidden = discCount !== 3;
    document.getElementById('supportSummary').textContent = discCount === 3
        ? 'A and B each ride on two outer cogs. C rides on both outer idlers and its own centre drive cog.'
        : 'Two supports per disc. One locked drive cog and one free-running idler.';
    document.getElementById('speedControlC').hidden = discCount !== 3;
    document.getElementById('angleCardC').hidden = discCount !== 3;
    slotSelect.querySelector('option[value="C"]').disabled = discCount !== 3;
    if (discCount === 2 && slotSelect.value === 'C') slotSelect.value = 'A';
    cutawayDrive.querySelector('option[value="C"]').disabled = discCount !== 3;
    if (discCount === 2 && cutawayDrive.value === 'C') cutawayDrive.value = 'A';
    document.getElementById('rpmCLabel').hidden = document.getElementById('rpmC').hidden = discCount !== 3;
    document.getElementById('pinsCLabel').hidden = document.getElementById('pinsC').hidden = discCount !== 3;
    for (const option of wiringSelect.querySelectorAll('[data-channel="C"]')) {
        option.disabled = option.hidden = discCount !== 3;
    }
    if (wiringSelect.selectedOptions[0]?.disabled) wiringSelect.value = '';
    updateWireTrace();
    document.getElementById('discWidth').textContent = `${cartridgeWidth.toFixed(1)} mm`;
    document.getElementById('windowDiameter').textContent = `Ø ${(2 * selectedSize.windowRadius).toFixed(1)} mm`;
    document.getElementById('caseDiameter').textContent = `Ø ${(2 * selectedSize.outerRadius).toFixed(1)} mm`;
    document.getElementById('cartridgeSize').textContent = `${selectedSize.name} · Ø ${(2 * selectedSize.radius).toFixed(1)} mm`;
    document.getElementById('teethReadout').textContent = `${selectedSize.teeth}T / ${DIM.pinionTeeth}T`;
    document.getElementById('motorRatio').textContent = `${selectedSize.ratio.toFixed(3)}:1`;
    document.getElementById('baseDepth').textContent = `${base.footWidth} × ${baseDepth.toFixed(1)} mm`;
    document.getElementById('baseHeight').textContent = `${(fasciaCrown - baseBottom).toFixed(1)} mm`;
    document.getElementById('stackDepth').textContent = `${(cartridgeWidth * discCount + DIM.discGap * (discCount - 1)).toFixed(1)} mm`;
    const faceZ = laneZ(discCount - 1) + frontOffset() + faceOffset;
    document.getElementById('ringDepth').textContent = `${(faceZ + faceThickness / 2 - rearShellEdge).toFixed(1)} mm`;
    document.getElementById('middleLift').textContent = `${Math.max(0, middleTravel).toFixed(2)} mm`;
    document.getElementById('cradleDownload').href = `cad/skeleton/${selectedSize.name}-${discCount}-${cartridgeSelect.value}.stl`;
    const designCurrent = discCount * 2 * 5 / (50 * .93) + .6;
    document.getElementById('powerEstimate').textContent = `≈ ${designCurrent.toFixed(2)} A · ${(designCurrent * 5).toFixed(1)} W`;
    updateInstallation();
    updateRpmReadout();
}

function updateMotion() {
    // Keep unwrapped angles for the pinions so their witness dots don't jump
    // when the ring marks complete a full turn and the dial wraps to zero.
    const shownPhase = running ? basePhase % TAU : basePhase <= TAU ? basePhase : basePhase % TAU;
    const motion = channelStates();
    const cycleLaps = Math.floor((basePhase - shownPhase) / TAU + 0.001);
    for (const [name, cartridge] of Object.entries(cartridges)) {
        cartridge.group.rotation.z = motion[name].disc;
        const relativePhase = discPhases[name] - cycleLaps * TAU;
        const angle = Math.round(THREE.MathUtils.radToDeg(relativePhase * speeds[name]));
        angleOutputs[name].textContent = `${angle < 0 ? '−' : ''}${Math.abs(angle)}°`;
    }
    updatePinions(motion);

    const degrees = THREE.MathUtils.radToDeg(shownPhase);
    crankInput.value = Math.round(degrees);
    crankValue.textContent = `${Math.round(degrees)}°`;
    const home = activeDiscs(discCount).every(name => Math.abs(Math.sin(motion[name].disc / 2)) < 0.0044);
    alignmentStatus.classList.toggle('away', !home);
    phaseStatus.textContent = home
        ? 'Home alignment · all rim marks align'
        : modeSelect.value === 'drift' ? 'Soft drift · each motor changes pace'
            : `Cycle ${Math.round(degrees / 3.6)}% · all discs turn independently`;
}

function stretch(mesh, bottom, top) {
    mesh.position.z = (bottom + top) / 2;
    mesh.scale.z = top - bottom;
}

function updateExplodedView() {
    const amount = Number(explodeInput.value);
    explodeValue.textContent = `${amount.toFixed(amount % 1 ? 1 : 0)} mm`;
    const expandedLane = lane => laneZ(lane) + amount * lane;
    const front = expandedLane(discCount - 1) + frontOffset() + amount * 0.7;
    const faceZ = front + faceOffset;
    skeleton.geometry = skeletonMeshes[`${discCount}-${cartridgeSelect.value}`];
    skeleton.visible = amount === 0;
    cradleFasteners.visible = amount === 0;
    for (const section of caseSections) {
        section.front.position.z = faceZ;
        stretch(section.wall, rearShellEdge, faceZ - faceThickness / 2 + .02);
        section.wall.visible = amount === 0;
    }
    const enabled = activeDiscs(discCount);
    for (const [name, cartridge] of Object.entries(cartridges)) {
        cartridge.group.visible = enabled.includes(name);
        cartridge.group.position.z = expandedLane(laneOf(name, discCount));
        cartridge.hybrid.visible = cartridgeSelect.value === 'hybrid';
        cartridge.printed.visible = !cartridge.hybrid.visible;
        cartridge.phaseDot.position.z = cartridgeWidth / 2 + .015;
        cartridge.sizeStamp.position.z = -cartridgeWidth / 2 - .018;
        cartridge.sizeStamp.position.y = windowRadius + (cartridge.hybrid.visible ? 2.4 : 1.55);
    }
    for (const { stop, lane } of lidStops) {
        stop.visible = lane < discCount;
        stop.position.z = expandedLane(lane);
    }
    for (const pack of stationPacks) {
        const pulleyBack = linkZ - pulleyWidth / 2 - pulleyBossDepth;
        const low = pulleyBack - .12;
        const high = front - .10;
        const gearZ = expandedLane(laneOf(pack.drive, discCount));
        pack.shaftKeys[0].position.z = linkZ - pulleyBossDepth / 2;
        pack.shaftKeys[1].position.z = gearZ;
        stretch(pack.journals[0], low, pulleyBack);
        stretch(pack.journals[1], linkZ + pulleyWidth / 2, gearZ - driveCogWidth / 2);
        stretch(pack.journals[2], gearZ + driveCogWidth / 2, high);
        pack.frontJournal.position.z = front - 1.60;
        pack.frontKeeper.position.z = front - .20;
        pack.frontShim.position.z = front - .225;
        pack.frontGroove.position.z = pack.frontClip.position.z = front + .15;
        pack.frontTip.position.z = front + .625;
        pack.group.visible = pack.drive !== 'C' || discCount === 3;
        stationLabels[pack.id].anchor.position.z = expandedLane(pack.drive ? laneOf(pack.drive, discCount) : discCount - 1);
        const halfCog = cartridgeWidth / 2 + DIM.lipExtension;
        for (const { gear, name, type, mark } of pack.gears) {
            const lane = laneOf(name, discCount);
            gear.visible = enabled.includes(name);
            gear.position.z = expandedLane(lane);
            gear.geometry = driveMeshes[`${type}-${cartridgeSelect.value}`];
            mark.position.z = halfCog + .015;
        }
        pack.shims.forEach((shim, i) => {
            shim.visible = pack.drive !== 'C' && !amount && i < discCount - 1;
            shim.position.z = (expandedLane(i) + expandedLane(i + 1)) / 2;
        });
        for (const sleeve of pack.sleeves) sleeve.visible = !amount;
        stretch(pack.sleeves[0], -3.90, expandedLane(0) - halfCog - .10);
        stretch(pack.sleeves[1], expandedLane(pack.drive === 'C' ? 0 : discCount - 1) + halfCog + .10, front - 2.85);
    }
    for (const drive of drives) {
        drive.motorScrews.visible = amount === 0;
        drive.root.visible = drive.board.visible = drive.keepers.visible = drive.harness.visible = enabled.includes(drive.name);
    }
    if (assemblySelect.value) showAssemblyStep();
}

function setRunning(active) {
    running = active;
    playBtn.textContent = running ? '⏸' : '▶';
    playBtn.title = running ? 'Pause motion' : 'Play motion';
    playBtn.setAttribute('aria-label', playBtn.title);
    playBtn.classList.toggle('primary', running);
    lastTime = performance.now();
}
playBtn.addEventListener('click', () => setRunning(!running));

function pauseAtHome() {
    setRunning(false);
    syncPhases(0);
    for (const name of Object.keys(currentRpm)) currentRpm[name] = 0;
    updateMotion();
}
sizeSelect.addEventListener('change', selectSize);
for (const [select, name] of [[speedB, 'B'], [speedC, 'C']]) {
    select.addEventListener('change', () => {
        speeds[name] = Number(select.value);
        updateDriveReadout();
        pauseAtHome();
    });
}

for (const button of discCountButtons) button.addEventListener('click', () => {
    const count = Number(button.dataset.count);
    if (count === discCount) return;
    discCount = count;
    updateExplodedView();
    updateDriveReadout();
    pauseAtHome();
    if (cutaway) openCutaway();
    if (printLayout) void openPrintLayout();
});
cartridgeSelect.addEventListener('change', () => {
    cartridgeWidth = cartridgeSelect.value === 'hybrid' ? hybridWidth : DIM.discWidth;
    updateExplodedView();
    updateDriveReadout();
    if (cutaway) openCutaway();
    if (printLayout) void openPrintLayout();
});

cycleInput.addEventListener('input', () => {
    cycleSeconds = Number(cycleInput.value);
    updateRpmReadout();
});
modeSelect.addEventListener('change', () => {
    updateRpmReadout();
    updateMotion();
});

crankInput.addEventListener('input', () => {
    setRunning(false);
    syncPhases(THREE.MathUtils.degToRad(Number(crankInput.value)));
    updateMotion();
});

explodeInput.addEventListener('input', updateExplodedView);
let labelsOverride;
let labelsRequested = false;
function refreshLabels() {
    const visible = labelsOverride ?? (labelsRequested || Boolean(cutaway));
    labelsToggle.setAttribute('aria-pressed', String(visible));
    labelsToggle.textContent = visible ? 'Labels on' : 'Labels off';
    labelsLayer.style.display = visible ? 'block' : 'none';
}
function setLabels(visible) {
    labelsRequested = visible;
    refreshLabels();
}
labelsToggle.addEventListener('click', () => {
    labelsOverride = labelsToggle.getAttribute('aria-pressed') !== 'true';
    refreshLabels();
});
lightsToggle.addEventListener('change', () => {
    lightingChannel.visible = lightsToggle.checked;
    cyanLight.visible = lightsToggle.checked;
    amberLight.intensity = lightsToggle.checked ? 34 : 16;
});
function setPlateVisibility(visible) {
    closePrintLayout();
    closeCutaway();
    installationInspection = '';
    assemblySelect.value = '';
    assemblyStatus.textContent = 'Choose a step to see the parts that go in at that stage.';
    const enabled = activeDiscs(discCount);
    for (const [name, cartridge] of Object.entries(cartridges)) cartridge.group.visible = enabled.includes(name);
    for (const [i, pack] of stationPacks.entries()) {
        const active = enabled.includes(pack.drive);
        pack.group.visible = drives[i].root.visible = active;
        drives[i].board.visible = drives[i].keepers.visible = active;
    }
    platesToggle.checked = visible;
    caseBody.visible = lidBody.visible = baseCase.visible = visible;
    rearPanel.visible = true;
    driverTray.visible = controller.visible = true;
    wiring.visible = false;
    setEspTrayPose(false);
    for (const { element } of bearingLabels) element.hidden = true;
    updateInstallation();
}
platesToggle.addEventListener('change', () => setPlateVisibility(platesToggle.checked));

function moveCamera(position, target = overviewTarget) {
    camera.position.copy(position);
    controls.target.copy(target);
    controls.update();
}

function selectInspection(id) {
    for (const button of inspectionButtons) {
        if (button.id === id) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
    }
}

function updateInstallation() {
    const onWall = mountMode.value === 'wall';
    const step = Number(assemblySelect.value);
    wallHardware.visible = onWall && (!step || step >= 4);
    wallSurface.visible = wallHardware.visible && caseBody.visible && !installationInspection && !cutaway;
    shelfFeet.visible = !onWall;
    floor.visible = !onWall && !cutaway;
    backlight.visible = backlightMode.value !== 'off' && (!step || step >= 5);
    const inspectLight = installationInspection === 'backlight';
    const lit = backlightMode.value === 'lit';
    diffuserMaterial.color.setHex(lit ? 0xefefec : 0xd4d5d5);
    ledModules.visible = inspectLight;
    for (const { printedPattern } of Object.values(cartridges)) {
        for (const bar of printedPattern.children) bar.castShadow = bar.receiveShadow = !backlight.visible;
    }
    backlight.position.set(discX - (inspectLight ? windowRadius * .40 : 0), discY + (inspectLight ? 6 : 0), inspectLight ? -24 : 0);
    cassetteStuds.visible = backlight.visible;
    for (const { element } of [...wallLabels, ...controllerFitLabels]) element.hidden = installationInspection !== 'wall';
    for (const { element } of backlightLabels) element.hidden = !inspectLight;
    const front = Math.max(baseFront, laneZ(discCount - 1) + frontOffset() + faceOffset + faceThickness / 2);
    const wallDepth = document.getElementById('wallDepth');
    document.getElementById('wallDepthLabel').hidden = wallDepth.hidden = !onWall;
    wallDepth.textContent = `${(front - wallZ).toFixed(1)} mm`;
    const notes = [];
    if (onWall) notes.push('Metal shelf and cleat support the chassis. An underside keeper prevents lift-off.');
    if (backlight.visible) notes.push(`Ø ${(2 * diffuserRadius).toFixed(1)} mm face. The cassette lifts off two M3 studs.`);
    installNote.textContent = notes.join(' ');
}

for (const select of [mountMode, backlightMode]) select.addEventListener('change', () => {
    if (installationInspection) document.getElementById('frontBtn').click();
    else updateInstallation();
});
document.getElementById('wallFitBtn').addEventListener('click', () => {
    finishService();
    setPlateVisibility(true);
    mountMode.value = 'wall';
    installationInspection = 'wall';
    rearPanel.visible = false;
    setLabels(true);
    updateInstallation();
    moveCamera(new THREE.Vector3(-122, -41, -305), new THREE.Vector3(0, -75, -18));
});
document.getElementById('backlightFitBtn').addEventListener('click', () => {
    finishService();
    setPlateVisibility(true);
    setRunning(false);
    if (backlightMode.value === 'off') backlightMode.value = 'unlit';
    installationInspection = 'backlight';
    setLabels(true);
    updateInstallation();
    moveCamera(overviewPosition(-110, 32, -440));
});

function closeCutaway() {
    if (!cutaway) return;
    scene.remove(cutaway.root);
    for (const material of cutaway.materials) material.dispose();
    cutaway.beltTeeth.dispose();
    for (const screw of cutaway.screws) screw.traverse(part => part.geometry?.dispose());
    for (const label of cutaway.labels) {
        label.element.remove();
        anchors.splice(anchors.indexOf(label), 1);
    }
    cutaway = undefined;
    sculpture.visible = floor.visible = true;
    controls.minDistance = 135;
    refreshLabels();
    cutawayBtn.setAttribute('aria-pressed', 'false');
    cutawayControls.hidden = true;
    playBtn.disabled = false;
    updateInstallation();
}

const printLayoutBtn = document.getElementById('printLayoutBtn');
const printLayoutStatus = document.getElementById('printLayoutStatus');
let printableShell;
function closePrintLayout() {
    if (!printLayout) return;
    scene.remove(printLayout.root);
    printLayout.ground?.geometry.dispose();
    printLayout.ground?.material.dispose();
    for (const item of printLayout.labels) {
        anchors.splice(anchors.indexOf(item), 1);
        item.element.remove();
    }
    scene.fog.density = printLayout.fogDensity;
    camera.near = printLayout.cameraNear;
    camera.far = printLayout.cameraFar;
    camera.updateProjectionMatrix();
    controls.maxDistance = 710 * viewScale;
    moveCamera(printLayout.cameraPosition, printLayout.cameraTarget);
    sculpture.visible = floor.visible = true;
    printLayoutBtn.setAttribute('aria-pressed', 'false');
    printLayoutStatus.hidden = true;
    printLayout = undefined;
}

async function openPrintLayout() {
    finishService();
    setPlateVisibility(false);
    setRunning(false);
    setLabels(true);
    const view = { root: new THREE.Group(), labels: [], fogDensity: scene.fog.density,
        cameraNear: camera.near, cameraFar: camera.far,
        cameraPosition: camera.position.clone(), cameraTarget: controls.target.clone() };
    printLayout = view;
    printLayoutBtn.setAttribute('aria-pressed', 'true');
    printLayoutStatus.textContent = 'Arranging printable parts…';
    printLayoutStatus.hidden = false;
    const parts = [];
    const addPart = (name, mesh, upright = false) => {
        const part = new THREE.Group();
        if (!upright) mesh.rotateX(-Math.PI / 2);
        part.add(mesh);
        const bounds = new THREE.Box3().setFromObject(mesh);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        mesh.position.add(new THREE.Vector3(-center.x, -bounds.min.y, -center.z));
        parts.push({ name, part, size });
    };
    const stack = cartridgeSelect.value;
    const channels = activeDiscs(discCount);
    addPart('Drive frame', new THREE.Mesh(skeletonMeshes[`${discCount}-${stack}`], mat.chassis));
    addPart('Electronics foot', new THREE.Mesh(baseMesh, mat.chassis), true);
    addPart('Front fascia', new THREE.Mesh(panelMeshes.front, mat.fascia));
    addPart('Lift-off back', new THREE.Mesh(panelMeshes.rear, mat.fascia));
    addPart('Frame transition', new THREE.Mesh(panelMeshes.apron, mat.fascia));
    const sides = new THREE.Group();
    for (const side of [-1, 1]) {
        const panel = new THREE.Mesh(panelMeshes.side, mat.fascia);
        panel.scale.x = side;
        panel.position.x = side * 23;
        sides.add(panel);
    }
    addPart('Side panels ×2', sides);
    for (const name of channels) {
        const disc = cartridges[name][stack].clone();
        disc.visible = true;
        if (stack === 'hybrid') disc.remove(disc.children[1]);
        else for (const child of disc.children) child.visible = true;
        addPart(stack === 'hybrid' ? `Carrier ${name}` : `Disc ${name}`, disc);
    }
    const addCopies = (name, geometry, material, count, pitch) => {
        const group = new THREE.Group();
        for (let i = 0; i < count; i++) {
            const part = new THREE.Mesh(geometry, material);
            part.position.set((i % 3) * pitch, Math.floor(i / 3) * pitch, 0);
            group.add(part);
        }
        addPart(`${name} ×${count}`, group);
    };
    addCopies('Motor pulley', driveMeshes['motor-pulley'], mat.amber, discCount, 15);
    addCopies('Spindle pulley', driveMeshes['spindle-pulley'], mat.cyan, discCount, 15);
    addCopies('Drive cog', driveMeshes[`drive-cog-${stack}`], mat.violet, discCount, 15);
    addCopies('Free idler', driveMeshes[`idler-${stack}`], mat.idler, discCount === 3 ? 4 : 2, 15);
    addCopies('Bearing keeper', keeperMesh, mat.trim, discCount * 2, 9);
    const exactSectors = discCount === 3 && stack === 'printed';
    let sectors;
    if (exactSectors) {
        const prefix = `./cad/modular-shell/${selectedSize.name.toLowerCase()}/`;
        const files = ['fixed-1', 'fixed-2', 'fixed-3', 'fixed-4', 'lid-1', 'lid-2'];
        try {
            printableShell ??= Promise.all([
                ...files.map(file => skeletonLoader.loadAsync(`${prefix}${file}.stl`)),
                skeletonLoader.loadAsync('./cad/modular-shell/s250/key.stl')
            ]);
            sectors = await printableShell;
        } catch {
            printableShell = undefined;
        }
    }
    if (printLayout !== view) return;
    if (sectors) {
        sectors.slice(0, 6).forEach((geometry, i) => addPart(i < 4 ? `Fixed shell ${i + 1}` : `Lid ${i - 3}`,
            new THREE.Mesh(geometry, mat.fascia)));
        addCopies('Shell key', sectors[6], mat.trim, 4, 13);
    } else {
        const fixed = new THREE.Group();
        for (const part of caseBody.children) if (part !== neckPanel) fixed.add(part.clone());
        addPart('Fixed shell preview', fixed);
        addPart('Lid preview', lidBody.clone());
    }
    const gap = 17;
    const maxWidth = Math.max(250, 4.6 * cageRadius);
    let x = gap, z = gap, rowDepth = 0;
    parts.sort((a, b) => b.size.z - a.size.z);
    for (const { name, part, size } of parts) {
        const slotWidth = Math.max(size.x, 20 + name.length * .063 * rimRadius);
        if (x + slotWidth + gap > maxWidth) {
            x = gap;
            z += rowDepth + gap;
            rowDepth = 0;
        }
        part.position.set(x + slotWidth / 2, 0, z + size.z / 2);
        view.root.add(part);
        view.labels.push(addLabel(name, part, new THREE.Vector3(0, 1, size.z / 2 + 4)));
        x += slotWidth + gap;
        rowDepth = Math.max(rowDepth, size.z);
    }
    const depth = z + rowDepth + gap;
    const target = new THREE.Vector3(maxWidth / 2, 0, depth / 2);
    view.ground = new THREE.Mesh(new THREE.PlaneGeometry(maxWidth, depth),
        new THREE.MeshBasicMaterial({ color: 0x171d25, side: THREE.DoubleSide }));
    view.ground.rotation.x = -Math.PI / 2;
    view.ground.position.copy(target).setY(-.05);
    view.root.add(view.ground);
    scene.add(view.root);
    sculpture.visible = floor.visible = wallSurface.visible = false;
    scene.fog.density = .00008;
    const fit = Math.max(depth, maxWidth / camera.aspect);
    controls.maxDistance = Math.max(1750, fit * 4);
    camera.near = fit * .30;
    camera.far = Math.max(view.cameraFar, fit * 4.1);
    camera.updateProjectionMatrix();
    moveCamera(target.clone().add(new THREE.Vector3(0, 2.85 * fit, .19 * fit)), target);
    printLayoutStatus.textContent = sectors
        ? 'Current print set laid out for inspection.'
        : 'Shell shown assembled for this stack. Export its sections from the shell CAD.';
}

printLayoutBtn.addEventListener('click', () => {
    if (printLayout) document.getElementById('rearBtn').click();
    else void openPrintLayout();
});

function openCutaway() {
    closePrintLayout();
    closeCutaway();
    finishService();
    setRunning(false);
    const drive = drives.find(({ name }) => name === cutawayDrive.value);
    const pack = stationPacks.find(({ drive: channel }) => channel === drive.name);
    const root = new THREE.Group();
    root.position.y = sculpture.position.y;
    const sectionNormal = new THREE.Vector3(Math.cos(drive.beltAngle), Math.sin(drive.beltAngle), 0);
    const sectionPoint = new THREE.Vector3(...drive.spindle, linkZ).add(root.position);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(sectionNormal.clone().negate(), sectionPoint);
    const beltMaterial = mat.belt.clone();
    beltMaterial.clippingPlanes = [plane];
    beltMaterial.side = THREE.DoubleSide;
    const materials = [beltMaterial];
    const cutBelt = drawBelt(drive.axis, drive.beltAngle, beltMaterial);
    root.add(cutBelt.loop);
    const stationarySpindle = pack.shaft.clone();
    stationarySpindle.position.copy(pack.group.position);
    stationarySpindle.rotation.z = -Math.PI / 2;
    const cogMaterial = colors[drive.name].clone();
    cogMaterial.clippingPlanes = [plane];
    cogMaterial.side = THREE.DoubleSide;
    materials.push(cogMaterial);
    const driveCog = pack.gears.find(({ powered }) => powered).gear.clone();
    driveCog.position.add(pack.group.position);
    driveCog.material = cogMaterial;
    root.add(driveCog);
    for (const seat of [pack.frontJournal, pack.rearJournal]) {
        const bearing = seat.clone();
        bearing.position.add(pack.group.position);
        const bearingMaterial = mat.steel.clone();
        bearingMaterial.clippingPlanes = [plane];
        materials.push(bearingMaterial);
        bearing.material = bearingMaterial;
        root.add(bearing);
    }
    const driveMotor = drive.tags.clone();
    driveMotor.children.find(child => child.geometry === drive.shaft.geometry).rotation.z =
        drive.tags.rotation.z - drive.beltAngle - Math.PI / 2;
    root.add(stationarySpindle, driveMotor);
    const screws = [];
    for (const [i, position] of [drive.spindle, drive.axis].entries()) {
        const motorEnd = i === 1;
        const wheel = new THREE.Mesh(driveMeshes[motorEnd ? 'motor-section' : 'spindle-section'], colors[drive.name]);
        wheel.position.set(...position, linkZ);
        wheel.rotation.z = drive.beltAngle + (motorEnd ? 1 : -1) * Math.PI / 2;
        const screwDepth = (motorEnd ? 1 : -1) * (pulleyWidth + pulleyBossDepth) / 2;
        const screw = radialSetScrew(0, motorEnd ? motor.shaftFlats / 2 : 1.01, 3.82, 2, screwDepth);
        wheel.add(screw);
        screws.push(screw);
        root.add(wheel);
    }
    const midpoint = drive.spindle.map((value, i) => (value + drive.axis[i]) / 2);
    const labels = [
        ['D-bore spindle pulley', drive.spindle, linkZ - 2.2, 24, 10],
        ['Double-D motor pulley', drive.axis, linkZ + 2.2, 26, -12],
        ['72-2GT-3 timing belt', midpoint, linkZ, 52, 0],
        ['Ø3 mm round journal', drive.spindle, pack.rearJournal.position.z, -55, -12],
        ['12T cog · screw on local flat', drive.spindle, driveCog.position.z, 65, 25],
        ['End clip and shim', drive.spindle, pack.frontClip.position.z, -40, 34]
    ].map(([name, position, z, dx, dy]) => {
        const label = addLabel(name, root, new THREE.Vector3(...position, z));
        label.shift = { x: dx, y: dy };
        return label;
    });
    cutaway = { root, materials, labels, screws, beltTeeth: cutBelt.teeth };
    scene.add(root);
    sculpture.visible = floor.visible = false;
    updateInstallation();
    controls.minDistance = 45;
    const target = new THREE.Vector3(...midpoint, 0).add(root.position);
    moveCamera(target.clone().addScaledVector(sectionNormal, 129).add(new THREE.Vector3(0, 13, -26)), target);
    refreshLabels();
    cutawayBtn.setAttribute('aria-pressed', 'true');
    cutawayControls.hidden = false;
    playBtn.disabled = true;
}

cutawayBtn.addEventListener('click', () => {
    if (cutaway) document.getElementById('frontBtn').click();
    else openCutaway();
});
cutawayDrive.addEventListener('change', openCutaway);

function overviewPosition(x = 0, y = 0, z = 475) {
    return overviewTarget.clone().add(new THREE.Vector3(x * viewScale, y * viewScale, z * viewScale));
}

const assemblyDescriptions = [
    'Seat the one-piece frame on the common electronics foot. Fit two recessed M2 × 5 screws from underneath.',
    'Seat the bearings and geared spindles. Swing A and B on their inner pivots to tension their belts. C’s slots are already indexed to this frame. Slide C just enough to tension its belt.',
    'Seat the three driver boards on the low standoffs, install the M2 screws and connect the headers. Fit the upright ESP32 and route the harnesses before closing the shell.',
    'Seat the single-colour fascia on its internal clips. Lower the discs into the combs and align their phase dots.',
    'Lower the lid into its two pockets. The two smooth stops above each disc limit lift above the lower cogs.'
];

function showAssemblyStep() {
    const step = Number(assemblySelect.value);
    const enabled = activeDiscs(discCount);
    for (const [name, cartridge] of Object.entries(cartridges)) {
        cartridge.group.visible = step >= 4 && enabled.includes(name);
    }
    for (const [i, pack] of stationPacks.entries()) {
        const active = enabled.includes(pack.drive);
        pack.group.visible = drives[i].root.visible = active && step >= 2;
        drives[i].board.visible = drives[i].keepers.visible = active;
    }
    wiring.visible = step === 3;
    caseBody.visible = baseCase.visible = step >= 4;
    lidBody.visible = step === 5;
    driverTray.visible = controller.visible = step >= 3;
    platesToggle.checked = step >= 4;
    assemblyStatus.textContent = assemblyDescriptions[step - 1];
    updateInstallation();
}

function changeAssemblyStep() {
    selectInspection();
    if (!assemblySelect.value) {
        document.getElementById('frontBtn').click();
        return;
    }
    finishService();
    closePrintLayout();
    closeCutaway();
    installationInspection = '';
    rearPanel.visible = true;
    setEspTrayPose(false);
    pauseAtHome();
    explodeInput.value = '0';
    updateExplodedView();
    for (const { element } of bearingLabels) element.hidden = true;
    const step = Number(assemblySelect.value);
    setLabels(step < 4);
    const cradleTarget = new THREE.Vector3(discX, (discY + 7.5 + baseBottom) / 2 + sculpture.position.y, -5);
    if (step === 3) moveCamera(new THREE.Vector3(116, -35, -305), new THREE.Vector3(0, -63, -9));
    else if (step <= 2) {
        const offset = step === 1 ? new THREE.Vector3(-78, 112, -410) : new THREE.Vector3(-125, 38, -395);
        moveCamera(cradleTarget.clone().add(offset.multiplyScalar(viewScale)), cradleTarget);
    } else moveCamera(overviewPosition(step === 4 ? 112 : 48, 39));
}
assemblySelect.addEventListener('change', changeAssemblyStep);
document.getElementById('nextAssemblyStep').addEventListener('click', () => {
    assemblySelect.value = String(Number(assemblySelect.value) % assemblyDescriptions.length + 1);
    changeAssemblyStep();
});
document.getElementById('frontBtn').addEventListener('click', () => {
    finishService();
    setPlateVisibility(true);
    setLabels(false);
    explodeInput.value = '0';
    updateExplodedView();
    moveCamera(overviewPosition());
});
document.getElementById('driveBtn').addEventListener('click', () => {
    finishService();
    setPlateVisibility(false);
    setLabels(true);
    explodeInput.value = '2';
    updateExplodedView();
    moveCamera(overviewPosition(145, 4, 440));
});
document.getElementById('rearBtn').addEventListener('click', () => {
    finishService();
    setPlateVisibility(false);
    setLabels(true);
    explodeInput.value = '0';
    updateExplodedView();
    moveCamera(overviewPosition(-144, 32, -465));
});
function showWiringView() {
    finishService();
    setPlateVisibility(false);
    setLabels(true);
    wiring.visible = true;
    for (let panel = wiringDiagram; panel; panel = panel.parentElement) {
        if (panel.tagName === 'DETAILS') panel.open = true;
    }
    explodeInput.value = '0';
    updateExplodedView();
    updateWireTrace();
    moveCamera(new THREE.Vector3(125, 20, -274), new THREE.Vector3(0, -66, -9));
}
function updateWireTrace() {
    const selected = wiringSelect.value;
    for (const { id, mesh } of wireMeshes) mesh.visible = !selected || selected === id;
}
document.getElementById('wiringBtn').addEventListener('click', () => {
    showWiringView();
    wiringDiagram.scrollIntoView({ block: 'nearest' });
});
wiringSelect.addEventListener('change', () => {
    if (!wiring.visible) showWiringView();
    updateWireTrace();
});
function setEspTrayPose(extracted) {
    esp32.position.x = extracted ? 27 : 0;
    espStop.position.set(0, 0, extracted ? 9 : 0);
    espTrayBtn.setAttribute('aria-pressed', String(extracted));
    espTrayBtn.textContent = extracted ? 'Seat ESP32' : 'Slide out ESP32';
    espTrayStatus.hidden = !extracted;
    for (const { element } of espTrayLabels) element.hidden = !extracted;
}
espTrayBtn.addEventListener('click', () => {
    const extracted = espTrayBtn.getAttribute('aria-pressed') !== 'true';
    finishService();
    setPlateVisibility(false);
    setLabels(extracted);
    explodeInput.value = '0';
    updateExplodedView();
    setEspTrayPose(extracted);
    moveCamera(new THREE.Vector3(178, -1, -154), new THREE.Vector3(51, -86, -2));
});
document.getElementById('bearingBtn').addEventListener('click', () => {
    finishService();
    setPlateVisibility(false);
    setLabels(true);
    explodeInput.value = '0';
    updateExplodedView();
    for (const { element } of bearingLabels) element.hidden = false;
    moveCamera(new THREE.Vector3(71, -30, 224), new THREE.Vector3(0, -45, 7));
});

function updateServicePose() {
    const progress = serviceProgress;
    const stage = (start, end) => THREE.MathUtils.smoothstep(progress, start, end);
    // Lift clear of the vertical tongues before setting the lid beside the opening.
    const clear = stage(0, 0.24);
    const parked = stage(0.24, 0.55);
    lid.position.set(-38 * viewScale * parked, 9 * clear + 15 * parked, 24 * parked);
    const name = slotSelect.value;
    const lift = discLift * stage(0.55, 1);
    cartridges[name].group.position.setX(discX + loadingDiscX(lift, driveAngles[name]));
    cartridges[name].group.position.setY(discY + lift);
    updatePinions(channelStates());
    const message = progress === 0 ? 'Lid seated on its locating tabs.' : progress === 1
        ? `Disc ${name} lifted in its guide slot.`
        : serviceTarget ? 'Lift the lid clear, then lift the disc.' : 'Seat the disc, then lower the lid.';
    if (loadStatus.textContent !== message) loadStatus.textContent = message;
}

function setServiceControls(open) {
    for (const input of [playBtn, sizeSelect, ...discCountButtons, cartridgeSelect, speedB, speedC, modeSelect, slotSelect, crankInput, explodeInput, platesToggle]) input.disabled = open;
    loadControls.hidden = !open;
    loadBtn.textContent = open ? 'Seat disc and lid' : 'Load from top';
    loadBtn.setAttribute('aria-pressed', String(open));
}

function finishService() {
    serviceTarget = serviceProgress = 0;
    updateServicePose();
    setServiceControls(false);
}

loadBtn.addEventListener('click', () => {
    serviceTarget = serviceTarget ? 0 : 1;
    if (!serviceTarget) return;
    pauseAtHome();
    setPlateVisibility(true);
    setLabels(false);
    explodeInput.value = '0';
    updateExplodedView();
    setServiceControls(true);
    moveCamera(overviewPosition(110, 35, 515));
});

function resize() {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

const projected = new THREE.Vector3();
function updateLabels() {
    const rect = renderer.domElement.getBoundingClientRect();
    const installationLabels = installationInspection === 'wall' ? [...wallLabels, ...controllerFitLabels] : backlightLabels;
    for (const label of anchors) {
        const { anchor, element, shift, wiringOnly, hideInWiring, traceId, traceChannel } = label;
        anchor.getWorldPosition(projected);
        projected.project(camera);
        let visible = !element.hidden && projected.z > -1 && projected.z < 1;
        if (installationInspection && !cutaway && !installationLabels.includes(label)
            || wiringOnly && (!wiring.visible || !wireLabelsToggle.checked || wiringSelect.value !== (traceId ?? ''))
            || hideInWiring && wiring.visible
            || traceChannel === 'C' && discCount !== 3) visible = false;
        for (let part = anchor.parent; part; part = part.parent) visible = visible && part.visible;
        element.style.display = visible ? 'block' : 'none';
        element.style.left = `${(projected.x * 0.5 + 0.5) * rect.width + (shift?.x ?? 0)}px`;
        element.style.top = `${(-projected.y * 0.5 + 0.5) * rect.height - (shift?.y ?? 0)}px`;
        element.style.opacity = `${THREE.MathUtils.clamp(1 - Math.abs(projected.z) * 0.12, 0.35, 1)}`;
    }
}

function animate(now) {
    requestAnimationFrame(animate);
    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    if (running) {
        liveSeconds += delta;
        const drift = modeSelect.value === 'drift';
        for (const [index, name] of ['A', 'B', 'C'].entries()) {
            const factor = drift ? driftFactor(index, liveSeconds, driftAmount) : 1;
            const target = rpmAtCycle(speeds[name], cycleSeconds).discRpm * factor;
            currentRpm[name] += THREE.MathUtils.clamp(target - currentRpm[name], -0.3 * delta, 0.3 * delta);
            discPhases[name] += currentRpm[name] / speeds[name] * delta * TAU / 60;
            if (drift) writeRpm(name, currentRpm[name], -currentRpm[name] * selectedSize.ratio);
        }
        basePhase = discPhases.A;
        updateMotion();
    }
    if (serviceProgress !== serviceTarget) {
        const step = Math.min(Math.abs(serviceTarget - serviceProgress), delta / 1.35);
        serviceProgress += Math.sign(serviceTarget - serviceProgress) * step;
        updateServicePose();
        if (serviceProgress === 0) setServiceControls(false);
    }
    controls.update();
    updateLabels();
    renderer.render(scene, camera);
}

document.getElementById('pinionDiameter').textContent = `Ø ${(2 * pinionRadius).toFixed(1)} mm`;
document.getElementById('discGap').textContent = `${DIM.discGap.toFixed(1)} mm`;
document.getElementById('apronDownload').href = `cad/case-panels/${selectedSize.name}-apron.stl`;
for (const button of inspectionButtons) {
    button.addEventListener('click', () => {
        const showRear = button.id === 'printLayoutBtn' && !printLayout;
        selectInspection(showRear ? 'rearBtn' : button.id === 'cutawayBtn' && !cutaway ? 'frontBtn' : button.id);
    });
}
explodeInput.value = '0';
resize();
document.getElementById('rearBtn').click();
updateExplodedView();
updateDriveReadout();
updateMotion();
requestAnimationFrame(animate);

