// Atmósfera 3D: luminarias por nivel (fluorescentes, colgantes, farolas) con luz
// real reciclada, haces volumétricos, charcos de luz en el suelo y polvo flotante.
// Todo es presentación pura y determinista (runSeed); con NOFX es no-op total
// (SwiftShader headless y modo bajo rendimiento).
(function () {
  if (!window.THREE) { window.Atmos3D = null; return; }

  const POOL_N = 6;        // luces reales fijas: nunca se añaden/quitan (evita
                           // recompilación de shaders = tirones)
  const DUST_N = 160;
  const WALL_H = 1.2;      // debe coincidir con render3d

  let pool = [];           // PointLights recicladas a las luminarias más cercanas
  let luminarias = [];     // [{x, z, y}] posiciones de emisores del nivel actual
  let dust = null, dustPos = null, dustSeed = null;
  let lastAssign = -1;
  let listo = false;

  // biomas con luminaria construida (los demás solo registran farolas de props)
  const COLGANTE = new Set(['ciudad', 'torres', 'invernadero']);

  function puntito() {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, 'rgba(255,250,235,1)');
    g.addColorStop(0.5, 'rgba(255,250,235,0.35)');
    g.addColorStop(1, 'rgba(255,250,235,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 16);
    return c;
  }

  function charcoCanvas() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, 'rgba(255,244,214,0.9)');
    g.addColorStop(0.55, 'rgba(255,244,214,0.28)');
    g.addColorStop(1, 'rgba(255,244,214,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return c;
  }

  function init(scene) {
    if (window.NOFX || listo) return;
    listo = true;
    for (let i = 0; i < POOL_N; i++) {
      const l = new THREE.PointLight(0xffe8c0, 0.85, 4.5, 2);
      l.position.set(0, -50, 0); // aparcada (nunca visible=false: mismo program count)
      scene.add(l);
      pool.push(l);
    }
    // polvo en suspensión alrededor del jugador (vive en scene: sobrevive rebuilds)
    dustPos = new Float32Array(DUST_N * 3);
    dustSeed = new Float32Array(DUST_N * 2);
    for (let i = 0; i < DUST_N; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 12;
      dustPos[i * 3 + 1] = Math.random() * 2.2;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 9;
      dustSeed[i * 2] = Math.random() * 7;
      dustSeed[i * 2 + 1] = 0.4 + Math.random() * 0.8; // velocidad de caída propia
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const mapTex = new THREE.CanvasTexture(puntito());
    const mat = new THREE.PointsMaterial({
      size: 0.035, sizeAttenuation: true, map: mapTex, transparent: true,
      opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    dust = new THREE.Points(geo, mat);
    dust.frustumCulled = false;
    scene.add(dust);
  }

  // fusión manual de geometrías trasladadas (sin BufferGeometryUtils)
  function fusionar(piezas, material) {
    const pos = [], nor = [];
    for (const { geo, x, y, z, rotY } of piezas) {
      let g2 = geo.toNonIndexed();
      if (rotY) g2.rotateY(rotY);
      g2.translate(x, y, z);
      const p = g2.getAttribute('position').array;
      const n = g2.getAttribute('normal').array;
      for (let i = 0; i < p.length; i++) pos.push(p[i]);
      for (let i = 0; i < n.length; i++) nor.push(n[i]);
      g2.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return new THREE.Mesh(geo, material);
  }

  function buildLevel(world, group) {
    luminarias = [];
    lastAssign = -1;
    window.__ATMOS_LUM = -1; // -1 = no construido (NOFX o init pendiente)
    if (window.NOFX || !listo) return;

    const level = world.level;
    const g = world.map.grid;
    const T = MapGen.T;
    const interior = world.tiles.wallStyle === 'tabique';
    const colgante = COLGANTE.has(level.bioma);
    const abierto = (x, y) => {
      const v = MapGen.at(g, x, y);
      return v !== T.VACIO && v !== T.PARED && v !== T.AGUA;
    };

    // farolas de props: luz real gratis (la geometría ya la pone render3d)
    for (const pr of world.map.props || [])
      if (pr.id === 'farola') luminarias.push({ x: pr.x + 0.5, y: 1.5, z: pr.y + 0.5 });

    if (interior || colgante) {
      // colocación determinista: una candidata por celda de 5×5 tiles con jitter;
      // los niveles oscuros apenas tienen luminarias (el horror manda)
      const rng = RNG.create(`${world.runSeed}::lum::${level.id}::${world.ventanaN || 0}::${world.mapaVersion || 0}`);
      const probOn = Math.max(0, 0.85 - (level.oscuridad || 0) * 0.9);
      const puestas = [];
      // tope proporcional al área (si fuera fijo, en mapas grandes todas caerían
      // en las primeras filas y el centro quedaría a oscuras)
      const cap = Math.min(280, Math.ceil((g.w * g.h) / 40));
      for (let cy = 0; cy < g.h; cy += 4)
        for (let cx = 0; cx < g.w; cx += 4) {
          if (puestas.length >= cap) break;
          if (!rng.chance(probOn)) continue;
          for (let intento = 0; intento < 8; intento++) {
            const x = cx + rng.int(0, 3), y = cy + rng.int(0, 3);
            if (x >= g.w || y >= g.h || !abierto(x, y)) continue;
            // orientación del tubo según el eje despejado del pasillo
            const ejeX = abierto(x - 1, y) && abierto(x + 1, y);
            puestas.push({ x: x + 0.5, z: y + 0.5, rotY: ejeX ? 0 : Math.PI / 2 });
            break;
          }
        }

      const emisorMat = new THREE.MeshBasicMaterial({ color: 0xfff6dc, toneMapped: false, fog: false });
      const soporteMat = new THREE.MeshLambertMaterial({ color: 0x24221c });
      const hazMat = new THREE.MeshBasicMaterial({
        color: 0xfff2d8, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false,
      });
      const emisores = [], soportes = [], haces = [], charcos = [];
      const yEmisor = colgante ? 1.0 : WALL_H + 0.02;
      for (const p of puestas) {
        if (colgante) {
          // bombilla colgando de un cable fino
          soportes.push({ geo: new THREE.CylinderGeometry(0.01, 0.01, 0.6, 4), x: p.x, y: 1.3, z: p.z });
          emisores.push({ geo: new THREE.SphereGeometry(0.07, 8, 6), x: p.x, y: yEmisor, z: p.z });
        } else {
          // tubo fluorescente sobre el pasillo, alineado con su eje
          emisores.push({ geo: new THREE.BoxGeometry(0.7, 0.05, 0.12), x: p.x, y: yEmisor, z: p.z, rotY: p.rotY });
        }
        haces.push({ geo: new THREE.ConeGeometry(0.55, yEmisor, 12, 1, true), x: p.x, y: yEmisor / 2, z: p.z });
        charcos.push(p);
        luminarias.push({ x: p.x, y: yEmisor, z: p.z });
      }
      if (emisores.length) {
        group.add(fusionar(emisores, emisorMat));
        if (soportes.length) group.add(fusionar(soportes, soporteMat));
        group.add(fusionar(haces, hazMat));
        // charcos de luz: quads fusionados con una sola textura radial
        const cp = [], cu = [], ci = [];
        for (const p of charcos) {
          const b = cp.length / 3, r = 0.8, y0 = 0.015;
          cp.push(p.x - r, y0, p.z + r, p.x + r, y0, p.z + r, p.x + r, y0, p.z - r, p.x - r, y0, p.z - r);
          cu.push(0, 0, 1, 0, 1, 1, 0, 1);
          ci.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
        const cgeo = new THREE.BufferGeometry();
        cgeo.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
        cgeo.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2));
        cgeo.setIndex(ci);
        const ctex = new THREE.CanvasTexture(charcoCanvas());
        group.add(new THREE.Mesh(cgeo, new THREE.MeshBasicMaterial({
          map: ctex, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
          depthWrite: false, toneMapped: false,
        })));
      }
    }
    window.__ATMOS_LUM = luminarias.length;
  }

  function frame(world, t, px, pz, luzOn) {
    if (window.NOFX || !listo) return;

    // reasignar el pool a las luminarias más cercanas (barato, cada ~250ms)
    if (t - lastAssign > 250) {
      lastAssign = t;
      if (luminarias.length) {
        const orden = luminarias
          .map((l) => ({ l, d: (l.x - px) * (l.x - px) + (l.z - pz) * (l.z - pz) }))
          .sort((a, b) => a.d - b.d);
        for (let i = 0; i < POOL_N; i++) {
          const cand = orden[i];
          if (cand && cand.d < 220) pool[i].position.set(cand.l.x, cand.l.y - 0.15, cand.l.z);
          else pool[i].position.set(0, -50, 0);
        }
      } else {
        for (const l of pool) l.position.set(0, -50, 0);
      }
    }

    // parpadeo fluorescente sutil e independiente por luz (muy Backrooms)
    for (let i = 0; i < POOL_N; i++) {
      const dip = Math.random() < 0.006 ? 0.35 : 1;
      const objetivo = 0.85 * dip * (0.94 + 0.06 * Math.sin(t * 0.011 + i * 2.1));
      pool[i].intensity += (objetivo - pool[i].intensity) * 0.3;
    }

    // polvo: deriva senoidal + caída lenta, envuelto en una caja alrededor del jugador
    if (dust) {
      const dt = Math.min(50, t - (frame._t || t));
      frame._t = t;
      const BX = 12, BY = 2.2, BZ = 9;
      for (let i = 0; i < DUST_N; i++) {
        let x = dustPos[i * 3], y = dustPos[i * 3 + 1], z = dustPos[i * 3 + 2];
        x += Math.sin(t * 0.0003 + dustSeed[i * 2]) * 0.0006 * dt;
        y -= dustSeed[i * 2 + 1] * 0.00012 * dt;
        z += Math.cos(t * 0.00022 + dustSeed[i * 2] * 2) * 0.0004 * dt;
        // wrap relativo al jugador (el enjambre le sigue sin teletransportes visibles)
        const rx = x - px, rz = z - pz;
        if (rx > BX / 2) x -= BX; else if (rx < -BX / 2) x += BX;
        if (rz > BZ / 2) z -= BZ; else if (rz < -BZ / 2) z += BZ;
        if (y < 0.05) y += BY;
        dustPos[i * 3] = x; dustPos[i * 3 + 1] = y; dustPos[i * 3 + 2] = z;
      }
      dust.geometry.attributes.position.needsUpdate = true;
      // con la linterna, las motas destacan en el haz
      const mat = dust.material;
      mat.opacity += ((luzOn ? 0.5 : 0.32) - mat.opacity) * 0.05;
      mat.size += ((luzOn ? 0.045 : 0.035) - mat.size) * 0.05;
    }
  }

  window.Atmos3D = { init, buildLevel, frame };
})();
