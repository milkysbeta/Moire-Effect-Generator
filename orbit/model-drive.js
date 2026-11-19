export const TAU = Math.PI * 2;

export const dimensions = Object.freeze({
    ringTeeth: 124,
    pinionTeeth: 12,
    ringModule: 0.8,
    pressureAngle: 25 * Math.PI / 180,
    ringBacklash: 0.10,
    shaftDiameter: 3,
    freeBoreDiameter: 3.3,
    lidClearance: 0.5,
    discWidth: 2.4,
    discGap: 1.5,
    windowDiameter: 92,
    flangeRadius: 6.45,
    lipExtension: 0.60,
    lipClearance: 0.15,
    gearShimWidth: 0.20,
    shellClearance: 1.6,
    shellWall: 1.2
});

// The outer stations carry all active layers. The centre station carries C only.
// Each station powers its keyed pinion. The idlers spin on round journals.
export const stations = Object.freeze([
    Object.freeze({ id: 'left', drive: 'B', angle: 228 * Math.PI / 180, beltAngle: -30, motorClock: 49, discs: 'ABC' }),
    Object.freeze({ id: 'right', drive: 'A', angle: 314 * Math.PI / 180, beltAngle: 30, motorClock: -51, discs: 'ABC' }),
    Object.freeze({ id: 'middle', drive: 'C', angle: 264 * Math.PI / 180, beltAngle: 67, motorClock: -19, discs: 'C' })
]);

// Match the compact deck and the electronics standoffs in cad/s100-skeleton.scad.
export const base = Object.freeze({ width: 117.2, footWidth: 113, bottom: -93, floor: -90.6, front: 18.6, rear: -19.75,
    driverPitch: 35.4, driverZ: -0.25, centreDriverZ: -0.95, driverY: -88.25,
    frameMountX: 48.5, frameMountZ: -17.43 });

// Hardware data used by Moire-Effect-Generator-Smooth (5 V unipolar build).
export const motor = Object.freeze({ diameter: 28.6, depth: 19.5, shaftOffset: 8,
    shaftDiameter: 5, shaftTip: 9.5, shaftFlats: 3, earSpacing: 35, earHole: 4.2, maxRpm: 12 });
export const motorRatio = dimensions.ringTeeth / dimensions.pinionTeeth;
export const belt = Object.freeze({ pitch: 2, teeth: 16, length: 72, width: 3,
    flangeRadius: 6.05, flangeWidth: 0.45, faceWidth: 3.3, motorTravel: 0.55,
    landOffset: 0.254, landClearance: 0.035, backing: 0.80, toothHalfWidth: 0.64, toothDepth: 0.60 });
export const beltCentres = (belt.length - belt.pitch * belt.teeth) / 2;
export const beltPitchRadius = belt.pitch * belt.teeth / TAU;
export const beltLandRadius = beltPitchRadius - belt.landOffset + belt.landClearance;
export const pulleyWidth = belt.faceWidth + 2 * belt.flangeWidth;

// Start at the upper right tangent and follow the open belt counterclockwise.
export function beltTrack(distance, radius = beltLandRadius) {
    const wrap = Math.PI * beltPitchRadius;
    const travel = ((distance % belt.length) + belt.length) % belt.length;
    if (travel < wrap) {
        const angle = travel / beltPitchRadius;
        return [radius * Math.cos(angle), beltCentres + radius * Math.sin(angle), angle];
    }
    if (travel < wrap + beltCentres) return [-radius, beltCentres - (travel - wrap), Math.PI];
    if (travel < 2 * wrap + beltCentres) {
        const angle = Math.PI + (travel - wrap - beltCentres) / beltPitchRadius;
        return [radius * Math.cos(angle), radius * Math.sin(angle), angle];
    }
    return [radius, travel - 2 * wrap - beltCentres, 0];
}

// A single set of datums supplies the motor, ear slots and fasteners.
export function motorDatums(station, [x, y] = polar(ringCentreDistance, station.angle), family) {
    const pose = station.drive === 'C' && family ? family.middleMotor : station;
    const angle = pose.beltAngle * Math.PI / 180;
    const alongBelt = [Math.sin(angle), -Math.cos(angle)];
    const axis = [x + beltCentres * alongBelt[0], y + beltCentres * alongBelt[1]];
    const yaw = pose.motorClock * Math.PI / 180;
    const can = [axis[0] + motor.shaftOffset * Math.sin(yaw), axis[1] - motor.shaftOffset * Math.cos(yaw)];
    const ears = [-1, 1].map(side => [can[0] + side * motor.earSpacing / 2 * Math.cos(yaw),
        can[1] + side * motor.earSpacing / 2 * Math.sin(yaw)]);
    return { axis, angle, alongBelt, yaw, can, ears };
}

export function centreDistance(moduleSize, teethA, teethB) {
    return moduleSize * (teethA + teethB) / 2;
}

export const ringCentreDistance = centreDistance(dimensions.ringModule, dimensions.ringTeeth, dimensions.pinionTeeth);
export const rimRadius = dimensions.ringModule * (dimensions.ringTeeth + 2) / 2;
export const pinionRadius = dimensions.ringModule * (dimensions.pinionTeeth + 2) / 2;
// Use the largest lower-cog envelope all the way around the concentric shell.
export const cageRadius = ringCentreDistance + dimensions.flangeRadius + dimensions.shellClearance;
export const lidHalfAngle = 70 * Math.PI / 180;

function sizeFamily(name, teeth, beltAngle, motorClock) {
    const radius = dimensions.ringModule * (teeth + 2) / 2;
    const spindleRadius = centreDistance(dimensions.ringModule, teeth, dimensions.pinionTeeth);
    return Object.freeze({ name, teeth, radius, windowRadius: radius - 4.4, spindleRadius,
        middleMotor: Object.freeze({ beltAngle, motorClock }),
        outerRadius: spindleRadius + dimensions.flangeRadius + dimensions.shellClearance,
        ratio: teeth / dimensions.pinionTeeth });
}

export const sizeFamilies = Object.freeze([
    sizeFamily('S100', dimensions.ringTeeth, 67, -19), sizeFamily('S150', 186, 58, -24),
    sizeFamily('S250', 310, 51, -26), sizeFamily('S300', 373, 50, -27)
]);

// The outer spindle centres are fixed. A larger disc raises the disc centre
// along their perpendicular bisector. Each frame indexes the height of C.
export function sharedBaseLayout(family) {
    const left = polar(ringCentreDistance, stations[0].angle);
    const right = polar(ringCentreDistance, stations[1].angle);
    const middle = polar(ringCentreDistance, stations[2].angle);
    const dx = right[0] - left[0];
    const dy = right[1] - left[1];
    const chord = Math.hypot(dx, dy);
    const rise = Math.sqrt(family.spindleRadius ** 2 - (chord / 2) ** 2);
    const centre = [(left[0] + right[0]) / 2 - dy * rise / chord,
        (left[1] + right[1]) / 2 + dx * rise / chord];
    const centreSupport = [middle[0], centre[1] - Math.sqrt(family.spindleRadius ** 2 - (middle[0] - centre[0]) ** 2)];
    return { centre, spindlePositions: [left, right, centreSupport], middleTravel: centreSupport[1] - middle[1] };
}

export function polar(radius, angle) {
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

// The two angles to the contact line differ by π. The tooth phases there must
// add to half a tooth pitch to put a tooth on one side opposite the other's gap.
export function meshIndex(contactAngle, drivingTeeth, drivenTeeth) {
    const pitch = TAU / drivenTeeth;
    const index = contactAngle + Math.PI + (contactAngle * drivingTeeth - Math.PI) / drivenTeeth;
    return ((index % pitch) + pitch) % pitch;
}

export function transferMotion(driverRotation, drivingTeeth, drivenTeeth) {
    return -driverRotation * drivingTeeth / drivenTeeth;
}

export function discPhase(referencePhase, speed) {
    // Firmware and panel use positive clockwise as seen from the front.
    return -referencePhase * speed;
}

export function pinionPhase(ringPhase, index, teeth = dimensions.ringTeeth) {
    return index + transferMotion(ringPhase, teeth, dimensions.pinionTeeth);
}

export function channelMotion(referencePhase, speed, ringTeeth = dimensions.ringTeeth) {
    const { pinionTeeth } = dimensions;
    const input = -discPhase(referencePhase, speed) * ringTeeth / pinionTeeth;
    const spindle = input; // Equal pulleys on an open timing belt, same direction.
    const disc = transferMotion(spindle, pinionTeeth, ringTeeth);
    return { input, spindle, disc };
}

export function rpmAtCycle(speed, seconds, ratio = motorRatio) {
    const discRpm = speed * 60 / seconds;
    return { discRpm, motorRpm: -discRpm * ratio };
}

export function shortestCycle(maxSpeed, ratio = motorRatio) {
    return Math.ceil((60 * maxSpeed * ratio / motor.maxRpm) / 5) * 5;
}

// Same continuous variation as the Smooth firmware's Drift mode.
export function driftFactor(index, seconds, amount) {
    const seed = 1.7 + index * 3.6;
    const noise = (Math.sin(seconds * 0.0731 + seed)
        + 0.6 * Math.sin(seconds * 0.1913 + seed * 2.3)
        + 0.35 * Math.sin(seconds * 0.4127 + seed * 4.1)) / 1.95;
    return 1 + amount * noise;
}

// Guide the disc away from its powered pinion during the last part of seating.
// The short lead keeps the rim clear of the side guide on the smallest cradle.
export function loadingDiscX(lift, angle) {
    const lead = 3.4;
    const lateralHeight = lift <= lead ? lift : Math.max(0, lead * (10 - lift) / (10 - lead));
    return lateralHeight * Math.cos(angle) / Math.sin(angle);
}

export function liftIndexOffset(angle, lift, driverAngle, family) {
    const [x, y] = polar(family.spindleRadius, angle);
    const contact = Math.atan2(y - lift, x - loadingDiscX(lift, driverAngle));
    const change = Math.atan2(Math.sin(contact - angle), Math.cos(contact - angle));
    return change * (1 + family.ratio);
}

function involuteAngle(baseRadius, radius) {
    const t = Math.sqrt(Math.max(0, (radius / baseRadius) ** 2 - 1));
    return t - Math.atan(t);
}

export function spurOutline(teeth, moduleSize, backlash) {
    const pitchRadius = moduleSize * teeth / 2;
    const baseRadius = pitchRadius * Math.cos(dimensions.pressureAngle);
    const outerRadius = pitchRadius + moduleSize;
    const rootRadius = pitchRadius - 1.25 * moduleSize;
    const pitch = TAU / teeth;
    const halfAtPitch = (Math.PI * moduleSize / 2 - backlash) / (2 * pitchRadius);
    const halfAt = radius => halfAtPitch + involuteAngle(baseRadius, pitchRadius) - involuteAngle(baseRadius, radius);
    const flankStart = Math.max(baseRadius, rootRadius);
    const samples = 8;
    const points = [];

    for (let tooth = 0; tooth < teeth; tooth++) {
        const centre = tooth * pitch;
        points.push(polar(rootRadius, centre - pitch / 2));
        if (flankStart > rootRadius) points.push(polar(rootRadius, centre - halfAt(flankStart)));
        for (let i = 0; i <= samples; i++) {
            const radius = flankStart + (outerRadius - flankStart) * i / samples;
            points.push(polar(radius, centre - halfAt(radius)));
        }
        const tipAngle = halfAt(outerRadius);
        for (let i = 1; i < 4; i++) points.push(polar(outerRadius, centre - tipAngle + 2 * tipAngle * i / 4));
        for (let i = samples; i >= 0; i--) {
            const radius = flankStart + (outerRadius - flankStart) * i / samples;
            points.push(polar(radius, centre + halfAt(radius)));
        }
        if (flankStart > rootRadius) points.push(polar(rootRadius, centre + halfAt(flankStart)));
    }
    return points;
}
