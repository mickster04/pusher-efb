// Shared scenario layouts for the suggester golden test (all around one reference point, the aircraft sits at it).
export function scenarios(G) {
  const ref = [-43.49, 172.53];
  const P = (brg, d, from = ref) => G.offset(from[0], from[1], brg, d);
  const seg = (name, type, a, b) => ({ name, type, widthM: 20, points: [a, b] });
  return {
    ref,
    layouts: {
      // straight taxiway A 60 m south in 100 m stretches, plus a LINK joining at the east
      straight: () => {
        const o = P(180, 60); const paths = [];
        for (let i = 0; i < 6; i++) paths.push(seg('A', 1, P(270, 300 - i * 100, o), P(270, 200 - i * 100, o)));
        paths.push(seg('LINK 1', 1, P(90, 60, o), P(0, 55, P(90, 60, o))));
        return { icao: 'T', refLat: ref[0], refLon: ref[1], paths, parking: [] };
      },
      // L-shaped taxiway: east 120 m then north
      bend: () => {
        const o = P(180, 50); const e = P(90, 120, o);
        const paths = [seg('B', 1, P(270, 80, o), o), seg('B', 1, o, e), seg('B', 1, e, P(0, 100, e)), seg('B', 1, P(0, 100, e), P(0, 200, e))];
        return { icao: 'T', refLat: ref[0], refLon: ref[1], paths, parking: [] };
      },
      // two taxiways, one a type-4 path, both angled
      two: () => {
        const a0 = P(200, 90), c0 = P(160, 140);
        const paths = [seg('A', 1, P(290, 150, a0), a0), seg('A', 1, a0, P(110, 150, a0)), seg('C', 4, P(250, 120, c0), c0), seg('C', 4, c0, P(70, 120, c0))];
        return { icao: 'T', refLat: ref[0], refLon: ref[1], paths, parking: [] };
      },
      // no named taxiways: unnamed lane and a stand connector
      connector: () => {
        const s60 = P(180, 60);
        const paths = [seg('', 3, ref, P(180, 30)), seg('', 1, P(180, 30), s60), seg('', 1, s60, P(90, 60, s60)), seg('', 1, s60, P(270, 60, s60))];
        return { icao: 'T', refLat: ref[0], refLon: ref[1], paths, parking: [{ name: 'G1', type: 1, lat: ref[0], lon: ref[1], headingDeg: 0, radiusM: 30 }] };
      }
    },
    headings: [0, 30, 90, 135, 180, 225, 270, 330]
  };
}
