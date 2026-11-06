// ============================================================
// WORKER: gera chunks de pedra 100% na thread secundária
// ============================================================

// Configuração (deve bater com o index.html)
const CHUNK_SIZE = 16;

// ============================================================
// RUIDO SIMPLEX 3D
// ============================================================
const PERM = (() => {
  const p = new Uint8Array(512);
  const base = [];
  let s = 1337;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967295; };
  for (let i = 0; i < 256; i++) base.push(i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
})();

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + t * (b - a); }

function grad3(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function noise3D(x, y, z) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);

  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;

  return lerp(
    lerp(
      lerp(grad3(PERM[AA], x, y, z),       grad3(PERM[BA], x-1, y, z), u),
      lerp(grad3(PERM[AB], x, y-1, z),     grad3(PERM[BB], x-1, y-1, z), u), v),
    lerp(
      lerp(grad3(PERM[AA+1], x, y, z-1),   grad3(PERM[BA+1], x-1, y, z-1), u),
      lerp(grad3(PERM[AB+1], x, y-1, z-1), grad3(PERM[BB+1], x-1, y-1, z-1), u), v),
    w
  );
}

function fbm2(x, y, z) {
  return noise3D(x, y, z) * 0.65 + noise3D(x*2, y*2, z*2) * 0.35;
}

function isSolid(x, y, z) {
  const n1 = fbm2(x * 0.06, y * 0.08, z * 0.06);
  const n2 = noise3D(x * 0.12 + 50, y * 0.15, z * 0.12 + 50);
  let d = n1 * 0.75 + n2 * 0.25;
  d += y * 0.003;
  if (y > 30 && noise3D(x * 0.04, y * 0.04, z * 0.04) > 0.6) {
    return noise3D(x * 0.2, y * 0.2, z * 0.2) > 0.2;
  }
  return d > 0.05;
}

// ============================================================
// GERAÇÃO DE CHUNK
// ============================================================
const FACES = [
  { dir: [ 1, 0, 0], corners: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]], n: [1,0,0] },
  { dir: [-1, 0, 0], corners: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], n: [-1,0,0] },
  { dir: [ 0, 1, 0], corners: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], n: [0,1,0] },
  { dir: [ 0,-1, 0], corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], n: [0,-1,0] },
  { dir: [ 0, 0, 1], corners: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], n: [0,0,1] },
  { dir: [ 0, 0,-1], corners: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], n: [0,0,-1] },
];

const COR_PEDRA = [0.55, 0.55, 0.55];
const N = CHUNK_SIZE;

function gerarChunk(cx, cy, cz, mods) {
  const baseX = cx * N;
  const baseY = cy * N;
  const baseZ = cz * N;

  // 1) Grid de sólidos
  const data = new Uint8Array(N * N * N);
  const idx3 = (ix, iy, iz) => ix + iy * N + iz * N * N;

  for (let ix = 0; ix < N; ix++) {
    for (let iy = 0; iy < N; iy++) {
      for (let iz = 0; iz < N; iz++) {
        const wx = baseX + ix;
        const wy = baseY + iy;
        const wz = baseZ + iz;
        data[idx3(ix, iy, iz)] = isSolid(wx, wy, wz) ? 1 : 0;
      }
    }
  }

  // 2) Aplica modificações (blocos quebrados/colocados)
  //    `mods` = { quebrados: Set<string>, colocados: Set<string> }
  if (mods && (mods.quebrados.size > 0 || mods.colocados.size > 0)) {
    for (const kb of mods.quebrados) {
      const [wx, wy, wz] = kb.split(',').map(Number);
      const ix = wx - baseX, iy = wy - baseY, iz = wz - baseZ;
      if (ix >= 0 && ix < N && iy >= 0 && iy < N && iz >= 0 && iz < N) {
        data[idx3(ix, iy, iz)] = 0;
      }
    }
    for (const kb of mods.colocados) {
      const [wx, wy, wz] = kb.split(',').map(Number);
      const ix = wx - baseX, iy = wy - baseY, iz = wz - baseZ;
      if (ix >= 0 && ix < N && iy >= 0 && iy < N && iz >= 0 && iz < N) {
        data[idx3(ix, iy, iz)] = 1;
      }
    }
  }

  // 3) Monta mesh
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  const solidosExpostos = []; // [x,y,z] de blocos com ao menos 1 face exposta

  let vIndex = 0;

  for (let ix = 0; ix < N; ix++) {
    for (let iy = 0; iy < N; iy++) {
      for (let iz = 0; iz < N; iz++) {
        if (!data[idx3(ix, iy, iz)]) continue;

        const wx = baseX + ix;
        const wy = baseY + iy;
        const wz = baseZ + iz;
        const [r, g, b] = COR_PEDRA;
        let faceVisivel = false;

        for (const face of FACES) {
          const ix2 = ix + face.dir[0];
          const iy2 = iy + face.dir[1];
          const iz2 = iz + face.dir[2];

          let vizinhoSolido;
          if (
            ix2 >= 0 && ix2 < N &&
            iy2 >= 0 && iy2 < N &&
            iz2 >= 0 && iz2 < N
          ) {
            vizinhoSolido = data[idx3(ix2, iy2, iz2)] === 1;
          } else {
            // fora do chunk: pergunta ao terreno (mas consulta mods)
            const nx = wx + face.dir[0];
            const ny = wy + face.dir[1];
            const nz = wz + face.dir[2];
            const nb = `${nx},${ny},${nz}`;
            if (mods && mods.colocados.has(nb)) vizinhoSolido = true;
            else if (mods && mods.quebrados.has(nb)) vizinhoSolido = false;
            else vizinhoSolido = isSolid(nx, ny, nz);
          }

          if (vizinhoSolido) continue;
          faceVisivel = true;

          for (const c of face.corners) {
            positions.push(wx + c[0], wy + c[1], wz + c[2]);
            normals.push(face.n[0], face.n[1], face.n[2]);
            colors.push(r, g, b);
          }
          indices.push(
            vIndex, vIndex + 1, vIndex + 2,
            vIndex, vIndex + 2, vIndex + 3
          );
          vIndex += 4;
        }

        if (faceVisivel) solidosExpostos.push([wx, wy, wz]);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals:   new Float32Array(normals),
    colors:    new Float32Array(colors),
    indices:   new Uint32Array(indices),
    solidosExpostos,
  };
}

// ============================================================
// HANDLER
// ============================================================
self.onmessage = (e) => {
  const { reqId, cx, cy, cz, mods } = e.data;

  // Reconstruir Sets a partir de arrays (structured clone não preserva Set)
  const modsObj = {
    quebrados: new Set(mods?.quebrados || []),
    colocados: new Set(mods?.colocados || []),
  };

  const result = gerarChunk(cx, cy, cz, modsObj);

  // postMessage com transferência (zero-copy)
  self.postMessage(
    { reqId, cx, cy, cz, ...result },
    [
      result.positions.buffer,
      result.normals.buffer,
      result.colors.buffer,
      result.indices.buffer,
    ]
  );
};
