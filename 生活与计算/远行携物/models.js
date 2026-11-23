// 物品与房间的 3D 小模型：全部用原生几何体搭出来，不依赖外部模型文件
(function () {
  'use strict';

  const T = THREE;
  const geoCache = new Map();

  function rboxGeo(w, h, d, r) {
    r = Math.min(r, w / 2 - .004, d / 2 - .004, h / 2 - .004);
    const key = [w, h, d, r].map(v => v.toFixed(3)).join('|');
    if (geoCache.has(key)) return geoCache.get(key);
    const shape = new T.Shape();
    const x = -w / 2, y = -d / 2;
    shape.moveTo(x + r, y);
    shape.lineTo(x + w - r, y);
    shape.quadraticCurveTo(x + w, y, x + w, y + r);
    shape.lineTo(x + w, y + d - r);
    shape.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    shape.lineTo(x + r, y + d);
    shape.quadraticCurveTo(x, y + d, x, y + d - r);
    shape.lineTo(x, y + r);
    shape.quadraticCurveTo(x, y, x + r, y);
    const geo = new T.ExtrudeGeometry(shape, {
      depth: Math.max(.001, h - 2 * r),
      bevelEnabled: true,
      bevelThickness: r,
      bevelSize: r * .96,
      bevelSegments: 2,
      curveSegments: 4
    });
    geo.rotateX(-Math.PI / 2);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    geo.translate(0, -(bb.min.y + bb.max.y) / 2, 0);
    geo.computeBoundingBox();
    geo.computeVertexNormals();
    geoCache.set(key, geo);
    return geo;
  }

  function boxGeo(w, h, d) {
    const key = 'b' + [w, h, d].map(v => v.toFixed(3)).join('|');
    if (!geoCache.has(key)) geoCache.set(key, new T.BoxGeometry(w, h, d));
    return geoCache.get(key);
  }

  function make() {
    const g = new T.Group();
    g.userData.mats = [];
    return g;
  }

  function mat(g, color, o) {
    o = o || {};
    const m = new T.MeshStandardMaterial({
      color: new T.Color(color).convertSRGBToLinear(),
      roughness: o.r != null ? o.r : .85,
      metalness: o.m || 0,
      emissive: new T.Color(o.e || 0x000000).convertSRGBToLinear(),
      emissiveIntensity: o.ei != null ? o.ei : 1
    });
    if (o.map) m.map = o.map;
    if (o.o != null && o.o < 1) {
      m.transparent = true;
      m.opacity = o.o;
      m.depthWrite = o.dw !== false;
    }
    if (o.side) m.side = o.side;
    m.userData.baseOpacity = o.o != null ? o.o : 1;
    m.userData.noShadow = o.ns != null ? o.ns : (o.o != null && o.o < .85);
    g.userData.mats.push(m);
    return m;
  }

  function basic(g, o) {
    o = o || {};
    const m = new T.MeshBasicMaterial({
      color: o.color != null ? new T.Color(o.color).convertSRGBToLinear() : 0xffffff,
      map: o.map || null,
      transparent: o.transparent || false,
      opacity: o.o != null ? o.o : 1,
      depthWrite: o.dw !== false,
      side: o.side || T.FrontSide
    });
    m.userData.baseOpacity = o.o != null ? o.o : 1;
    m.userData.noShadow = true;
    g.userData.mats.push(m);
    return m;
  }

  function addMesh(g, geo, m, x, y, z, rx, ry, rz) {
    const mesh = new T.Mesh(geo, m);
    mesh.position.set(x || 0, y || 0, z || 0);
    mesh.rotation.set(rx || 0, ry || 0, rz || 0);
    mesh.castShadow = !m.userData.noShadow;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  }

  function R(g, w, h, d, m, x, y, z, o) {
    o = o || {};
    const r = o.r != null ? o.r : Math.min(w, h, d) * .16;
    return addMesh(g, rboxGeo(w, h, d, r), m, x || 0, (y || 0) + h / 2, z || 0, o.rx || 0, o.ry || 0, o.rz || 0);
  }

  function B(g, w, h, d, m, x, y, z, o) {
    o = o || {};
    return addMesh(g, boxGeo(w, h, d), m, x || 0, (y || 0) + h / 2, z || 0, o.rx || 0, o.ry || 0, o.rz || 0);
  }

  function C(g, rt, rb, h, m, x, y, z, o) {
    o = o || {};
    const geo = new T.CylinderGeometry(rt, rb, h, o.seg || 22, 1, !!o.open);
    return addMesh(g, geo, m, x || 0, (y || 0) + h / 2, z || 0, o.rx || 0, o.ry || 0, o.rz || 0);
  }

  function S(g, r, m, x, y, z, o) {
    o = o || {};
    const geo = new T.SphereGeometry(r, o.seg || 18, o.seg2 || 14);
    return addMesh(g, geo, m, x, y, z, o.rx || 0, o.ry || 0, o.rz || 0);
  }

  function Tor(g, Rr, rr, m, x, y, z, o) {
    o = o || {};
    const geo = new T.TorusGeometry(Rr, rr, o.seg || 10, o.arcSeg || 28, o.arc != null ? o.arc : Math.PI * 2);
    return addMesh(g, geo, m, x, y, z, o.rx || 0, o.ry || 0, o.rz || 0);
  }

  function Put(g, geo, m, x, y, z, rx, ry, rz) {
    return addMesh(g, geo, m, x, y, z, rx, ry, rz);
  }

  // ---------- 程序化贴图 ----------

  function canvasTex(w, h, draw, repeatX, repeatY) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    draw(x, w, h);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    if (repeatX) t.repeat.set(repeatX, repeatY || repeatX);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = 8;
    return t;
  }

  function rr(x, a, b, w, h, r) {
    x.beginPath();
    x.moveTo(a + r, b);
    x.arcTo(a + w, b, a + w, b + h, r);
    x.arcTo(a + w, b + h, a, b + h, r);
    x.arcTo(a, b + h, a, b, r);
    x.arcTo(a, b, a + w, b, r);
    x.closePath();
  }

  const TX = {};

  TX.wood = canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#c9a577';
    x.fillRect(0, 0, w, h);
    const rows = 8, rh = h / rows;
    for (let i = 0; i < rows; i++) {
      const tone = 186 + (i % 3) * 10;
      x.fillStyle = 'rgb(' + tone + ',' + (tone - 34) + ',' + (tone - 80) + ')';
      x.fillRect(0, i * rh, w, rh);
      x.strokeStyle = 'rgba(120,84,48,.55)';
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(0, i * rh + .5);
      x.lineTo(w, i * rh + .5);
      x.stroke();
      x.strokeStyle = 'rgba(126,86,48,.3)';
      x.lineWidth = 1;
      for (let k = 0; k < 7; k++) {
        const yy = i * rh + 8 + Math.random() * (rh - 16);
        x.beginPath();
        x.moveTo(0, yy);
        x.bezierCurveTo(w * .3, yy + 6, w * .65, yy - 7, w, yy + 2);
        x.stroke();
      }
      const jx = (i % 2 ? 90 : 300) + Math.random() * 60;
      x.strokeStyle = 'rgba(116,78,42,.45)';
      x.beginPath();
      x.moveTo(jx, i * rh);
      x.lineTo(jx, i * rh + rh);
      x.stroke();
    }
  }, 1.6, 2.6);

  function tileTex(base, edge, grout, cells, repeat) {
    return canvasTex(512, 512, (x, w, h) => {
      x.fillStyle = grout;
      x.fillRect(0, 0, w, h);
      const s = w / cells;
      for (let i = 0; i < cells; i++) {
        for (let j = 0; j < cells; j++) {
          const v = (i + j) % 2 ? 4 : -2;
          x.fillStyle = base;
          x.globalAlpha = .92;
          x.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
          x.globalAlpha = 1;
          x.fillStyle = edge;
          x.globalAlpha = .10 + (v > 0 ? .03 : 0);
          x.fillRect(i * s + 3, j * s + 3, s - 6, 10);
          x.globalAlpha = 1;
          if ((i * 7 + j * 5) % 6 === 0) {
            x.strokeStyle = 'rgba(120,145,148,.12)';
            x.beginPath();
            x.arc(i * s + s * .5, j * s + s * .55, s * .22, .4, 2.3);
            x.stroke();
          }
        }
      }
    }, repeat, repeat);
  }

  TX.bathTile = tileTex('#e3f0f1', '#bfd9dc', '#c3d9db', 4, 2.6);
  TX.balconyTile = tileTex('#d9e4d8', '#b4c6b5', '#b5c6b4', 3, 2.2);

  TX.rug = canvasTex(512, 384, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    rr(x, 8, 8, w - 16, h - 16, 46);
    x.fillStyle = '#eee1cb';
    x.fill();
    x.lineWidth = 16;
    x.strokeStyle = '#c98c68';
    x.stroke();
    rr(x, 34, 34, w - 68, h - 68, 28);
    x.lineWidth = 4;
    x.strokeStyle = 'rgba(159,107,77,.55)';
    x.stroke();
    x.save();
    rr(x, 8, 8, w - 16, h - 16, 46);
    x.clip();
    x.strokeStyle = 'rgba(190,129,96,.45)';
    x.lineWidth = 7;
    for (let i = -1; i < 8; i++) {
      x.beginPath();
      x.moveTo(60 + i * 90, 50);
      x.lineTo(130 + i * 90, h / 2);
      x.lineTo(60 + i * 90, h - 50);
      x.stroke();
    }
    x.strokeStyle = 'rgba(120,140,127,.22)';
    x.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      x.beginPath();
      x.moveTo(0, 40 + i * 38);
      x.lineTo(w, 40 + i * 38);
      x.stroke();
    }
    x.restore();
  });
  TX.rug.wrapS = TX.rug.wrapT = T.ClampToEdgeWrapping;

  TX.runner = canvasTex(512, 160, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    rr(x, 5, 5, w - 10, h - 10, 24);
    x.fillStyle = '#e9dcc4';
    x.fill();
    x.lineWidth = 10;
    x.strokeStyle = '#bb7f5f';
    x.stroke();
    x.strokeStyle = 'rgba(160,116,80,.35)';
    x.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      rr(x, 26 + i * 66, 24, 40, h - 48, 10);
      x.stroke();
    }
  });
  TX.runner.wrapS = TX.runner.wrapT = T.ClampToEdgeWrapping;

  TX.sky = canvasTex(512, 512, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#cfe4e2');
    g.addColorStop(.56, '#f0ead6');
    g.addColorStop(1, '#f7e4c2');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,242,205,.9)';
    x.beginPath();
    x.arc(w * .68, h * .3, 52, 0, 7);
    x.fill();
    x.fillStyle = 'rgba(173,198,178,.55)';
    x.beginPath();
    x.moveTo(0, h * .72);
    x.quadraticCurveTo(w * .2, h * .58, w * .42, h * .7);
    x.quadraticCurveTo(w * .62, h * .8, w * .82, h * .64);
    x.quadraticCurveTo(w * .95, h * .56, w, h * .66);
    x.lineTo(w, h);
    x.lineTo(0, h);
    x.fill();
    x.fillStyle = 'rgba(139,172,151,.45)';
    x.beginPath();
    x.moveTo(0, h * .84);
    x.quadraticCurveTo(w * .28, h * .74, w * .5, h * .84);
    x.quadraticCurveTo(w * .74, h * .94, w, h * .78);
    x.lineTo(w, h);
    x.lineTo(0, h);
    x.fill();
    x.fillStyle = 'rgba(255,255,255,.55)';
    x.beginPath();
    x.ellipse(w * .24, h * .2, 52, 16, 0, 0, 7);
    x.ellipse(w * .34, h * .16, 34, 12, 0, 0, 7);
    x.fill();
  });
  TX.sky.wrapS = TX.sky.wrapT = T.ClampToEdgeWrapping;

  TX.screen = canvasTex(320, 200, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#203b3a');
    g.addColorStop(.55, '#3f6e68');
    g.addColorStop(1, '#d9a777');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(247,238,219,.88)';
    rr(x, w * .13, h * .26, w * .3, h * .48, 8);
    x.fill();
    x.fillStyle = 'rgba(32,59,58,.75)';
    rr(x, w * .16, h * .3, w * .24, h * .04, 3);
    x.fill();
    rr(x, w * .16, h * .38, w * .17, h * .03, 3);
    x.fill();
    x.fillStyle = 'rgba(226,164,108,.9)';
    x.beginPath();
    x.arc(w * .72, h * .38, h * .16, 0, 7);
    x.fill();
    x.fillStyle = 'rgba(250,244,230,.7)';
    x.fillRect(w * .62, h * .66, w * .27, h * .04);
    x.fillRect(w * .62, h * .74, w * .19, h * .03);
  });
  TX.screen.wrapS = TX.screen.wrapT = T.ClampToEdgeWrapping;

  TX.mirror = canvasTex(256, 384, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#e5f1ee');
    g.addColorStop(.5, '#c2d9d6');
    g.addColorStop(1, '#eef2e7');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,.5)';
    x.beginPath();
    x.moveTo(w * .1, h);
    x.lineTo(w * .62, 0);
    x.lineTo(w * .8, 0);
    x.lineTo(w * .3, h);
    x.fill();
    x.fillStyle = 'rgba(255,255,255,.35)';
    x.beginPath();
    x.moveTo(w * .62, h);
    x.lineTo(w * .86, h * .3);
    x.lineTo(w * .92, h * .38);
    x.lineTo(w * .72, h);
    x.fill();
  });
  TX.mirror.wrapS = TX.mirror.wrapT = T.ClampToEdgeWrapping;

  TX.grill = canvasTex(256, 256, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.strokeStyle = 'rgba(62,54,44,.5)';
    x.lineWidth = 2;
    for (let r = 20; r < 120; r += 20) {
      x.beginPath();
      x.arc(w / 2, h / 2, r, 0, 7);
      x.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      x.beginPath();
      x.moveTo(w / 2, h / 2);
      x.lineTo(w / 2 + Math.cos(a) * 120, h / 2 + Math.sin(a) * 120);
      x.stroke();
    }
    x.fillStyle = 'rgba(72,62,50,.6)';
    x.beginPath();
    x.arc(w / 2, h / 2, 12, 0, 7);
    x.fill();
  });
  TX.grill.wrapS = TX.grill.wrapT = T.ClampToEdgeWrapping;

  TX.art1 = canvasTex(320, 400, (x, w, h) => {
    x.fillStyle = '#efe2cd';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#c97c59';
    x.beginPath();
    x.arc(w * .5, h * .58, w * .3, Math.PI, 0);
    x.fill();
    x.fillStyle = '#5f8f85';
    x.beginPath();
    x.arc(w * .32, h * .4, w * .14, 0, 7);
    x.fill();
    x.strokeStyle = 'rgba(90,70,48,.4)';
    x.lineWidth = 4;
    x.strokeRect(w * .09, h * .07, w * .82, h * .86);
  });
  TX.art2 = canvasTex(320, 400, (x, w, h) => {
    x.fillStyle = '#f0e6d2';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#56796f';
    x.beginPath();
    x.moveTo(0, h * .7);
    x.quadraticCurveTo(w * .3, h * .2, w * .64, h * .55);
    x.quadraticCurveTo(w * .84, h * .72, w, h * .45);
    x.lineTo(w, h);
    x.lineTo(0, h);
    x.fill();
    x.fillStyle = '#d9a05b';
    x.beginPath();
    x.arc(w * .68, h * .28, w * .13, 0, 7);
    x.fill();
    x.strokeStyle = 'rgba(90,70,48,.4)';
    x.lineWidth = 4;
    x.strokeRect(w * .09, h * .07, w * .82, h * .86);
  });
  TX.art1.wrapS = TX.art1.wrapT = T.ClampToEdgeWrapping;
  TX.art2.wrapS = TX.art2.wrapT = T.ClampToEdgeWrapping;

  TX.clock = canvasTex(256, 256, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = '#fbf4e6';
    x.beginPath();
    x.arc(w / 2, h / 2, 118, 0, 7);
    x.fill();
    x.strokeStyle = 'rgba(88,70,48,.8)';
    x.lineWidth = 5;
    x.stroke();
    x.strokeStyle = 'rgba(88,70,48,.6)';
    x.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      x.beginPath();
      x.moveTo(w / 2 + Math.cos(a) * 98, h / 2 + Math.sin(a) * 98);
      x.lineTo(w / 2 + Math.cos(a) * 108, h / 2 + Math.sin(a) * 108);
      x.stroke();
    }
    x.strokeStyle = '#4d4234';
    x.lineWidth = 7;
    x.beginPath();
    x.moveTo(w / 2, h / 2);
    x.lineTo(w / 2 - 38, h / 2 - 34);
    x.stroke();
    x.lineWidth = 5;
    x.beginPath();
    x.moveTo(w / 2, h / 2);
    x.lineTo(w / 2 + 54, h / 2 + 16);
    x.stroke();
    x.fillStyle = '#c97c59';
    x.beginPath();
    x.arc(w / 2, h / 2, 9, 0, 7);
    x.fill();
  });
  TX.clock.wrapS = TX.clock.wrapT = T.ClampToEdgeWrapping;

  TX.scale = canvasTex(256, 160, (x, w, h) => {
    x.fillStyle = '#e9efe9';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#3b4a44';
    rr(x, 40, 36, w - 80, h - 68, 16);
    x.fill();
    x.fillStyle = '#9be0b8';
    x.font = '600 54px ui-monospace, monospace';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('62.4', w / 2, h / 2 + 2);
  });
  TX.scale.wrapS = TX.scale.wrapT = T.ClampToEdgeWrapping;

  // ---------- 小零件 ----------

  function pumpBottle(g, color, h, r, opts) {
    opts = opts || {};
    const body = mat(g, color, { r: .55 });
    C(g, r, r * 1.06, h * .72, body, 0, 0, 0);
    C(g, r * .58, r * .7, h * .07, mat(g, 0x4f5a52, { r: .45 }), 0, h * .72, 0);
    C(g, .009, .009, h * .12, mat(g, 0x4f5a52, { r: .4 }), 0, h * .79, 0);
    B(g, r * 1.55, .018, r * 1.1, mat(g, 0x4f5a52, { r: .4 }), 0, h * .9, .01);
    if (opts.label !== false) {
      C(g, r * 1.02, r * 1.02, h * .25, mat(g, opts.label || 0xf4eddc, { r: .8 }), 0, h * .2, 0);
    }
  }

  function tube(g, color, h, w, capColor) {
    const body = mat(g, color, { r: .5 });
    R(g, w, h * .82, w * .62, body, 0, 0, 0, { r: w * .15 });
    C(g, w * .3, w * .34, h * .18, mat(g, capColor || 0xe9e4d6, { r: .5 }), 0, h * .82, 0);
    C(g, w * .32, w * .32, .006, mat(g, 0x77756c), 0, h * .99, 0);
    R(g, w * .82, h * .22, .004, mat(g, 0xefe8d8, { r: .6 }), 0, h * .25, w * .315);
  }

  function folded(g, color, w, d, layers, lh) {
    const m = mat(g, color, { r: .95 });
    for (let i = 0; i < layers; i++) {
      R(g, w - i * .01, lh, d - i * .01, m, 0, i * lh, 0, { r: .012 });
    }
  }

  function bottleTop(g, color, h) {
    C(g, .012, .013, h * .17, mat(g, 0xf2ecdd, { r: .6 }), 0, 0, 0);
    C(g, .014, .014, h * .05, mat(g, color, { r: .5 }), 0, h * .17, 0);
  }

  // ---------- 61 件物品 ----------

  const MODELS = {
    quilt(g) {
      const cream = mat(g, 0xf3e8d7, { r: .95 });
      R(g, .92, .085, .6, cream, 0, 0, 0, { r: .045 });
      R(g, .9, .14, .58, mat(g, 0xc97a58, { r: .9 }), 0, .075, 0, { r: .06 });
      R(g, .18, .148, .585, mat(g, 0xf6eedf, { r: .9 }), -.2, .075, 0, { r: .028 });
      R(g, .06, .05, .2, mat(g, 0xb06a4c, { r: .7 }), .3, .07, .18, { r: .01 });
    },

    pillow(g) {
      R(g, .56, .155, .38, mat(g, 0xfaf4e8, { r: 1 }), 0, 0, 0, { r: .075 });
      R(g, .48, .022, .3, mat(g, 0xefe5d3, { r: 1 }), 0, .15, 0, { r: .05 });
    },

    matRoll(g) {
      const m = mat(g, 0xd7b881, { r: .85 });
      Put(g, new T.CylinderGeometry(.082, .082, .72, 20), m, 0, .082, 0, 0, 0, Math.PI / 2);
      const band = mat(g, 0x9c7449, { r: .7 });
      Tor(g, .086, .008, band, -.24, .082, 0, { ry: Math.PI / 2, seg: 8 });
      Tor(g, .086, .008, band, .24, .082, 0, { ry: Math.PI / 2, seg: 8 });
      C(g, .083, .083, .006, mat(g, 0xc7a06f), .36, -.003, 0, { rz: Math.PI / 2 });
    },

    eyeMask(g) {
      R(g, .17, .035, .085, mat(g, 0xb49ac7, { r: 1 }), 0, 0, 0, { r: .035 });
      B(g, .16, .006, .012, mat(g, 0x6e5a82), 0, .028, -.04);
      B(g, .045, .006, .01, mat(g, 0x8f76a4), -.04, .035, .012);
      B(g, .045, .006, .01, mat(g, 0x8f76a4), .04, .035, .012);
    },

    earplugs(g) {
      C(g, .04, .044, .032, mat(g, 0xe7d3b3, { r: .8 }), 0, 0, 0);
      S(g, .016, mat(g, 0xe08a4f, { r: .9 }), .065, .016, .022);
      S(g, .016, mat(g, 0xd77f46, { r: .9 }), .085, .016, -.008);
      Tor(g, .03, .006, mat(g, 0xbfa886), 0, .032, 0, { rx: Math.PI / 2 });
    },

    lintRoller(g) {
      const teal = mat(g, 0x4f8b84, { r: .6 });
      C(g, .013, .015, .18, teal, 0, 0, 0);
      C(g, .028, .03, .03, teal, 0, .18, 0);
      Put(g, new T.CylinderGeometry(.042, .042, .2, 20), mat(g, 0xf1e9da, { r: .9 }), 0, .225, 0, 0, 0, Math.PI / 2);
      const ring = mat(g, 0xb7ad9b, { r: .7 });
      Tor(g, .043, .004, ring, -.06, .225, 0, { ry: Math.PI / 2, seg: 8 });
      Tor(g, .043, .004, ring, .06, .225, 0, { ry: Math.PI / 2, seg: 8 });
    },

    monitor(g) {
      const dark = mat(g, 0x353330, { r: .5 });
      B(g, .3, .018, .18, mat(g, 0x6b5a48, { r: .6 }), 0, 0, 0);
      B(g, .052, .02, .04, dark, 0, .018, -.02);
      Put(g, new T.BoxGeometry(.05, .2, .04), dark, 0, .12, -.02, -.08, 0, 0);
      B(g, .62, .37, .034, dark, 0, .19, 0);
      Put(g, new T.PlaneGeometry(.58, .33), basic(g, { map: TX.screen }), 0, .375, .019);
      B(g, .04, .012, .02, mat(g, 0x8f8a80), 0, .19, .012);
    },

    laptop(g) {
      const al = mat(g, 0xd1d5d1, { r: .35, m: .45 });
      B(g, .34, .015, .24, al, 0, 0, 0);
      B(g, .28, .004, .17, mat(g, 0x3a3e40, { r: .7 }), 0, .015, .015);
      B(g, .34, .22, .012, al, 0, .02, -.118);
      Put(g, new T.PlaneGeometry(.31, .19), basic(g, { map: TX.screen }), 0, .13, -.111);
      B(g, .08, .004, .015, mat(g, 0xb9bdb9), 0, .019, .1);
    },

    cableCoil(g) {
      const w = mat(g, 0xf3efe6, { r: .65 });
      Tor(g, .055, .011, w, 0, .012, 0, { rx: Math.PI / 2 });
      B(g, .048, .016, .026, w, -.075, .008, .012);
      B(g, .021, .012, .018, mat(g, 0x4a4a48, { r: .5 }), .075, .006, -.006);
      B(g, .024, .008, .012, mat(g, 0xd6d0c5), -.075, .024, .026);
    },

    powerStrip(g) {
      const w = mat(g, 0xf6f2e9, { r: .6 });
      R(g, .34, .04, .075, w, 0, 0, 0, { r: .015 });
      const hole = mat(g, 0x4c4b46, { r: .7 });
      for (let i = 0; i < 4; i++) {
        B(g, .038, .006, .028, hole, -.12 + i * .08, .04, 0);
        B(g, .034, .002, .012, mat(g, 0x77746c), -.12 + i * .08, .046, .02);
      }
      B(g, .07, .006, .018, mat(g, 0xe06a58, { r: .6 }), .135, .04, 0);
      const cable = new T.CylinderGeometry(.009, .009, .18, 10);
      Put(g, cable, w, .24, .012, .03, 0, 0, 1.1);
    },

    charger(g) {
      const w = mat(g, 0xf7f3ea, { r: .45 });
      R(g, .058, .052, .046, w, 0, 0, 0, { r: .012 });
      B(g, .012, .012, .008, mat(g, 0x9a958b, { m: .6, r: .3 }), .016, .046, -.01);
      B(g, .012, .012, .008, mat(g, 0x9a958b, { m: .6, r: .3 }), -.016, .046, -.01);
      B(g, .02, .007, .01, mat(g, 0x3f3f3d), -.012, .022, .023);
      Tor(g, .03, .006, mat(g, 0xeee9df, { r: .6 }), .055, .006, .02, { rx: Math.PI / 2, seg: 8 });
    },

    powerBank(g) {
      R(g, .12, .022, .062, mat(g, 0x44566b, { r: .4 }), 0, 0, 0, { r: .012 });
      const led = mat(g, 0x93e4b6, { e: 0x51c98c, ei: 1.4, r: .4 });
      for (let i = 0; i < 4; i++) B(g, .011, .002, .005, led, -.032 + i * .02, .022, -.015);
      B(g, .012, .006, .004, mat(g, 0x2c3a48), .043, .009, .032);
    },

    headphones(g) {
      const wood = mat(g, 0xa97c52, { r: .7 });
      R(g, .14, .014, .14, wood, 0, 0, 0, { r: .02 });
      C(g, .011, .011, .25, mat(g, 0x9b9a92, { m: .5, r: .35 }), 0, .01, 0);
      const pad = mat(g, 0x4f7f7c, { r: .8 });
      Tor(g, .075, .012, pad, 0, .285, .02, { arc: Math.PI, seg: 10 });
      const cupGeo = new T.CylinderGeometry(.036, .04, .026, 18);
      Put(g, cupGeo, pad, -.075, .225, .02, Math.PI / 2, 0, 0);
      Put(g, cupGeo, pad, .075, .225, .02, Math.PI / 2, 0, 0);
      Put(g, new T.CylinderGeometry(.02, .02, .006, 14), mat(g, 0x3f6562), -.075, .225, .036, Math.PI / 2, 0, 0);
      Put(g, new T.CylinderGeometry(.02, .02, .006, 14), mat(g, 0x3f6562), .075, .225, .036, Math.PI / 2, 0, 0);
    },

    phoneStand(g) {
      const wood = mat(g, 0xb98b5f, { r: .75 });
      B(g, .11, .01, .09, wood, 0, 0, 0);
      Put(g, new T.BoxGeometry(.11, .13, .012), wood, 0, .06, -.028, -.22, 0, 0);
      Put(g, new T.BoxGeometry(.078, .15, .008), mat(g, 0x36393a, { r: .4 }), 0, .08, -.002, -.18, 0, 0);
      const scr = basic(g, { map: TX.screen });
      Put(g, new T.PlaneGeometry(.068, .13), scr, 0, .08, .003, -.18, 0, 0);
      B(g, .09, .012, .02, wood, 0, .01, .025);
    },

    phone(g) {
      const dark = mat(g, 0x35393a, { r: .4 });
      R(g, .078, .009, .15, dark, 0, 0, 0, { r: .012 });
      Put(g, new T.PlaneGeometry(.067, .13), basic(g, { map: TX.screen }), 0, .01, 0, -Math.PI / 2, 0, 0);
      B(g, .024, .006, .032, dark, -.018, 0, -.047);
    },

    speaker(g) {
      R(g, .16, .115, .1, mat(g, 0x8d918a, { r: .95 }), 0, 0, 0, { r: .03 });
      Put(g, new T.CircleGeometry(.04, 26), basic(g, { map: TX.grill, transparent: true }), 0, .062, .051);
      B(g, .022, .008, .012, mat(g, 0x3f3f3c, { r: .5 }), .06, .095, .05);
      B(g, .12, .008, .06, mat(g, 0x6f736d), 0, .115, 0);
    },

    mirrorStand(g) {
      const wood = mat(g, 0xa97c52, { r: .65 });
      B(g, .3, .018, .11, wood, 0, 0, 0);
      B(g, .024, .44, .022, wood, -.125, .018, 0);
      B(g, .024, .44, .022, wood, .125, .018, 0);
      Tor(g, .126, .012, wood, 0, .458, 0, { arc: Math.PI, seg: 8 });
      Put(g, new T.PlaneGeometry(.235, .43), basic(g, { map: TX.mirror }), 0, .255, .005);
      B(g, .26, .012, .014, wood, 0, .018, .008);
    },

    hairDryer(g) {
      const body = mat(g, 0xd9a7a0, { r: .5 });
      const dark = mat(g, 0x44443f, { r: .45 });
      const light = mat(g, 0xefe3d8, { r: .6 });
      R(g, .052, .11, .062, body, 0, .005, -.03, { r: .02, rx: -.08 });
      B(g, .03, .014, .028, dark, 0, .085, -.052);
      Put(g, new T.CylinderGeometry(.052, .057, .19, 22), body, 0, .142, 0, Math.PI / 2, 0, 0);
      Put(g, new T.CylinderGeometry(.042, .042, .008, 18), dark, 0, .142, -.096, Math.PI / 2, 0, 0);
      Tor(g, .048, .006, light, 0, .142, -.092, { seg: 8 });
      Put(g, new T.CylinderGeometry(.038, .052, .06, 22), body, 0, .142, .125, Math.PI / 2, 0, 0);
      Put(g, new T.CylinderGeometry(.036, .036, .006, 18), dark, 0, .142, .157, Math.PI / 2, 0, 0);
      B(g, .026, .012, .034, dark, 0, .194, .02);
      Tor(g, .034, .006, dark, .015, .012, -.075, { rx: Math.PI / 2, seg: 8 });
    },

    nailClipper(g) {
      const met = mat(g, 0xb9bdc0, { m: .65, r: .3 });
      Put(g, new T.BoxGeometry(.07, .008, .018), met, 0, .012, 0);
      Put(g, new T.BoxGeometry(.062, .008, .014), met, 0, .021, .006);
      Put(g, new T.BoxGeometry(.03, .004, .01), met, .008, .029, .008);
      S(g, .004, mat(g, 0x8d9295, { m: .5 }), -.032, .012, .006);
    },

    earPick(g) {
      const met = mat(g, 0xa9adb0, { m: .6, r: .3 });
      Put(g, new T.CylinderGeometry(.0032, .0024, .105, 8), met, 0, .004, 0, 0, 0, Math.PI / 2);
      Put(g, new T.CylinderGeometry(.002, .002, .018, 6), met, -.057, .004, 0, 0, 0, Math.PI / 2.4);
      S(g, .008, met, -.063, .006, .004);
    },

    floss(g) {
      const teal = mat(g, 0x4fa59a, { r: .5 });
      R(g, .062, .018, .042, mat(g, 0xf6f2e8, { r: .6 }), 0, 0, 0, { r: .004 });
      B(g, .03, .004, .043, teal, .012, .016, 0);
      B(g, .006, .006, .03, mat(g, 0xe9e3d7), -.02, .016, .0);
    },

    cottonSwabs(g) {
      const jar = mat(g, 0xe9f2f0, { r: .15, o: .32, ns: true });
      C(g, .043, .043, .1, jar, 0, 0, 0, { open: true, seg: 20 });
      C(g, .043, .043, .004, jar, 0, 0, 0, { seg: 20 });
      const stick = mat(g, 0xf3efe6, { r: .8 });
      for (let i = 0; i < 3; i++) {
        const a = -.3 + i * .3;
        Put(g, new T.CylinderGeometry(.0026, .0026, .14, 6), stick, -.012 + i * .012, .09, .004, .15, 0, a);
        S(g, .007, mat(g, 0xfbf8f1), -.03 + i * .024, .157, -.004);
        S(g, .007, mat(g, 0xfbf8f1), -.012 + i * .024, .16, -.004);
      }
      B(g, .09, .002, .09, mat(g, 0xd9e5e1), 0, 0, 0);
    },

    lotion(g) { pumpBottle(g, 0xe8c3ad, .17, .036); },

    hanger(g) {
      const wood = mat(g, 0xa77c52, { r: .7 });
      Tor(g, .021, .005, mat(g, 0x8b8a83, { m: .5, r: .35 }), 0, -.016, 0, { seg: 8, arc: Math.PI * 1.45 });
      Put(g, new T.BoxGeometry(.2, .012, .012), wood, -.1, -.062, 0, 0, 0, .34);
      Put(g, new T.BoxGeometry(.2, .012, .012), wood, .1, -.062, 0, 0, 0, -.34);
      B(g, .38, .011, .012, wood, 0, -.118, 0);
    },

    tops(g) {
      MODELS.hanger(g);
      const cloth = mat(g, 0xc47a5c, { r: 1 });
      const s = new T.Shape();
      s.moveTo(-.055, 0);
      s.lineTo(-.19, -.03);
      s.lineTo(-.3, -.115);
      s.lineTo(-.25, -.23);
      s.lineTo(-.165, -.18);
      s.lineTo(-.185, -.5);
      s.lineTo(.185, -.5);
      s.lineTo(.165, -.18);
      s.lineTo(.25, -.23);
      s.lineTo(.3, -.115);
      s.lineTo(.19, -.03);
      s.lineTo(.055, 0);
      s.quadraticCurveTo(0, -.055, -.055, 0);
      const shirt = new T.ExtrudeGeometry(s, {
        depth: .03, bevelEnabled: true, bevelThickness: .007,
        bevelSize: .007, bevelSegments: 2, curveSegments: 8
      });
      shirt.translate(0, 0, -.015);
      Put(g, shirt, cloth, 0, -.095, 0);
      Tor(g, .057, .0075, mat(g, 0xe8d8bf, { r: .85 }), 0, -.095, .018, { arc: Math.PI, rz: Math.PI, seg: 6 });
      B(g, .055, .06, .004, mat(g, 0xd6b49c, { r: .9 }), .075, -.33, .021);
    },

    pants(g) {
      const denim = mat(g, 0x647b94, { r: .95 });
      folded(g, 0x647b94, .34, .26, 3, .038);
      R(g, .3, .012, .22, mat(g, 0x7b90a6, { r: .9 }), 0, .114, 0, { r: .01 });
      B(g, .05, .03, .005, mat(g, 0x4d6076), .12, .124, .1);
    },

    underwear(g) {
      folded(g, 0xd9a3a6, .2, .15, 3, .028);
      R(g, .16, .01, .11, mat(g, 0xe7c2c4, { r: .9 }), 0, .084, 0, { r: .01 });
      B(g, .15, .006, .012, mat(g, 0xb98388, { r: .85 }), 0, .094, -.045);
    },

    socks(g) {
      const shape = new T.Shape();
      shape.moveTo(-.02, 0);
      shape.lineTo(.15, 0);
      shape.quadraticCurveTo(.185, .002, .185, .026);
      shape.quadraticCurveTo(.185, .05, .15, .052);
      shape.quadraticCurveTo(.09, .056, .062, .08);
      shape.quadraticCurveTo(.05, .1, .052, .13);
      shape.lineTo(.048, .17);
      shape.lineTo(-.022, .17);
      shape.lineTo(-.018, .06);
      shape.quadraticCurveTo(-.016, .02, -.02, 0);
      const geo = new T.ExtrudeGeometry(shape, {
        depth: .024, bevelEnabled: true, bevelThickness: .006,
        bevelSize: .006, bevelSegments: 2, curveSegments: 8
      });
      geo.rotateX(-Math.PI / 2);
      geo.translate(-.08, .006, .085);
      Put(g, geo, mat(g, 0xe9e2d2, { r: 1 }), 0, 0, 0);
      Put(g, geo, mat(g, 0x9dae9a, { r: 1 }), .014, .034, -.014, 0, .06, 0);
    },

    slippers(g) {
      const cream = mat(g, 0xefe4cf, { r: 1 });
      const strap = mat(g, 0xb98d68, { r: .9 });
      [-.065, .075].forEach((z, i) => {
        const x = i ? .02 : -.02;
        R(g, .2, .032, .1, cream, x, 0, z, { r: .03, ry: i ? -.06 : .06 });
        Tor(g, .043, .009, strap, x, .045, z, { rx: Math.PI / 2, arc: Math.PI, seg: 8, ry: Math.PI / 2 });
      });
    },

    scissors(g) {
      const met = mat(g, 0xb7bcc0, { m: .65, r: .3 });
      const handle = mat(g, 0x4f8f87, { r: .6 });
      Put(g, new T.BoxGeometry(.15, .007, .018), met, 0, .012, 0, 0, 0, .16);
      Put(g, new T.BoxGeometry(.15, .007, .018), met, 0, .012, 0, 0, 0, -.16);
      Tor(g, .026, .006, handle, .085, .012, .035, { rx: Math.PI / 2, seg: 8 });
      Tor(g, .026, .006, handle, .085, .012, -.035, { rx: Math.PI / 2, seg: 8 });
      S(g, .009, mat(g, 0x7c8286, { m: .6 }), 0, .012, 0);
    },

    knife(g) {
      R(g, .135, .024, .03, mat(g, 0x4c4a46, { r: .6 }), 0, 0, 0, { r: .008 });
      R(g, .09, .011, .013, mat(g, 0xc3c7c9, { m: .7, r: .25 }), .015, .022, 0, { r: .004 });
      B(g, .012, .034, .026, mat(g, 0x8b8a82, { m: .5, r: .4 }), .05, .022, 0);
    },

    lighter(g) {
      R(g, .028, .052, .016, mat(g, 0xc4574a, { r: .5 }), 0, 0, 0, { r: .005 });
      B(g, .024, .013, .014, mat(g, 0xa9abaa, { m: .6, r: .35 }), 0, .052, 0);
      B(g, .01, .006, .008, mat(g, 0x4d4c48), 0, .065, 0);
    },

    sprayBottle(g) {
      const glass = mat(g, 0xd8ebe4, { r: .2, o: .5, ns: true });
      const cap = mat(g, 0x4f8f87, { r: .5 });
      C(g, .04, .044, .12, glass, 0, 0, 0);
      C(g, .024, .028, .022, glass, 0, .12, 0);
      R(g, .072, .032, .038, cap, 0, .142, 0, { r: .01 });
      C(g, .005, .005, .022, cap, .032, .162, 0, { rz: -.35 });
      C(g, .02, .02, .004, mat(g, 0x3f6f69), 0, .028, .044, { rx: Math.PI / 2 });
    },

    tape(g) {
      Tor(g, .056, .022, mat(g, 0xc9a36f, { r: .8 }), 0, .022, 0, { rx: Math.PI / 2 });
      C(g, .027, .027, .046, mat(g, 0xdfd0b5, { r: .8 }), 0, 0, 0);
      C(g, .032, .032, .024, mat(g, 0xb08a5a, { r: .7 }), 0, .011, 0);
    },

    mask(g) {
      R(g, .16, .015, .09, mat(g, 0xcfe0e6, { r: .9 }), 0, 0, 0, { r: .04 });
      B(g, .15, .006, .012, mat(g, 0xb9cdd6, { r: .8 }), 0, .015, .025);
      Tor(g, .026, .0035, mat(g, 0xe6e1d6), -.088, .008, 0, { rx: Math.PI / 2, seg: 6 });
      Tor(g, .026, .0035, mat(g, 0xe6e1d6), .088, .008, 0, { rx: Math.PI / 2, seg: 6 });
    },

    tissueSmall(g) {
      R(g, .09, .028, .055, mat(g, 0x5fa89e, { r: .6 }), 0, 0, 0, { r: .006 });
      B(g, .03, .004, .02, mat(g, 0xf7f3e7), 0, .028, 0);
      B(g, .05, .008, .002, mat(g, 0xe8f1ec), 0, .012, .028);
    },

    tissueLarge(g) {
      R(g, .17, .072, .1, mat(g, 0xf0e7d5, { r: .7 }), 0, 0, 0, { r: .012 });
      B(g, .17, .026, .101, mat(g, 0x6c9c92, { r: .7 }), 0, .02, 0);
      B(g, .04, .004, .02, mat(g, 0xf7f3e7), 0, .072, 0);
    },

    sewingKit(g) {
      const wood = mat(g, 0xb99263, { r: .7 });
      C(g, .03, .03, .05, wood, 0, 0, 0);
      C(g, .032, .032, .028, mat(g, 0xc17d5d, { r: .9 }), 0, .011, 0);
      C(g, .033, .033, .004, mat(g, 0xe6d8c0), 0, .04, 0);
      Put(g, new T.CylinderGeometry(.0025, .0025, .09, 6), mat(g, 0xb9bdc0, { m: .7, r: .3 }), .07, .006, .04, 0, 0, Math.PI / 2);
      S(g, .006, mat(g, 0xd8d8d4), .115, .006, .04);
    },

    meds(g) {
      C(g, .035, .038, .08, mat(g, 0xf5efe2, { r: .6 }), 0, 0, 0);
      C(g, .037, .037, .018, mat(g, 0xd47c52, { r: .55 }), 0, .08, 0);
      R(g, .085, .006, .055, mat(g, 0xdadde0, { r: .3, m: .4 }), .07, 0, .015, { r: .003 });
      for (let i = 0; i < 3; i++) {
        S(g, .005, mat(g, 0xfbf7ee), .045 + i * .022, .006, .015);
      }
    },

    waterBottle(g) {
      const gel = mat(g, 0xcfe2dc, { r: .2, o: .55, ns: true });
      C(g, .043, .046, .21, gel, 0, 0, 0);
      C(g, .028, .034, .03, gel, 0, .21, 0);
      C(g, .028, .028, .022, mat(g, 0x4f8f87, { r: .5 }), 0, .24, 0);
      Tor(g, .044, .006, mat(g, 0x4f8f87, { r: .6 }), 0, .105, 0, { rx: Math.PI / 2 });
      B(g, .036, .034, .004, mat(g, 0xf6f0e2), 0, .06, .044);
    },

    umbrella(g) {
      const navy = mat(g, 0x495c6d, { r: .8 });
      Put(g, new T.CylinderGeometry(.018, .052, .62, 18), navy, 0, .052, 0, 0, 0, Math.PI / 2);
      Put(g, new T.CylinderGeometry(.011, .011, .12, 10), mat(g, 0x8a6a4b), -.36, .052, 0, 0, 0, Math.PI / 2);
      Tor(g, .035, .008, mat(g, 0x8a6a4b), -.42, .052, 0, { arc: Math.PI, rz: Math.PI / 2, seg: 8 });
      Tor(g, .05, .006, mat(g, 0xcfc3a8, { r: .7 }), .16, .052, 0, { ry: Math.PI / 2, seg: 8 });
      C(g, .006, .006, .03, mat(g, 0xcfc3a8), .225, .04, 0, { rz: Math.PI / 2 });
    },

    fan(g) {
      const body = mat(g, 0x648a82, { r: .5 });
      const metal = mat(g, 0x9aa19a, { m: .35, r: .45 });
      C(g, .15, .16, .028, body, 0, 0, 0);
      C(g, .018, .018, .5, metal, 0, .02, 0);
      C(g, .033, .033, .03, body, 0, .5, 0);
      Tor(g, .142, .012, body, 0, .68, .02, { seg: 10 });
      Put(g, new T.CircleGeometry(.133, 30), basic(g, { map: TX.grill, transparent: true }), 0, .68, .035);
      const blade = mat(g, 0xd6ddcf, { r: .7 });
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * Math.PI * 2;
        Put(g, new T.BoxGeometry(.105, .026, .005), blade,
          Math.cos(a) * .06, .68 + Math.sin(a) * .06, .028, 0, 0, a);
      }
      S(g, .018, body, 0, .68, .035);
      Tor(g, .06, .006, metal, 0, .62, 0, { arc: Math.PI, rx: Math.PI / 2, seg: 6 });
    },

    scale(g) {
      R(g, .28, .026, .28, mat(g, 0xf2efe6, { r: .45 }), 0, 0, 0, { r: .03 });
      B(g, .29, .004, .29, mat(g, 0xdfe7df, { r: .5 }), 0, .022, 0);
      Put(g, new T.PlaneGeometry(.13, .075), basic(g, { map: TX.scale }), 0, .027, .1, -Math.PI / 2, 0, 0);
      C(g, .045, .045, .002, mat(g, 0xcfd7cf), -.075, .026, .07);
      C(g, .045, .045, .002, mat(g, 0xcfd7cf), .075, .026, .07);
    },

    vacuum(g) {
      const body = mat(g, 0x597b75, { r: .5 });
      const dark = mat(g, 0x3e3e3a, { r: .55 });
      R(g, .23, .07, .15, dark, 0, 0, -.02, { r: .03 });
      C(g, .055, .065, .18, body, 0, .04, .03);
      C(g, .036, .036, .03, mat(g, 0xc8d3ce, { r: .3, m: .2 }), 0, .09, .03);
      C(g, .014, .014, .74, mat(g, 0x9ba29b, { m: .35, r: .4 }), 0, .2, .03);
      R(g, .034, .09, .034, body, 0, .93, .03, { r: .012 });
      Tor(g, .05, .007, dark, 0, 1.0, .03, { arc: Math.PI, seg: 8 });
      C(g, .032, .045, .07, mat(g, 0xc8d3ce, { r: .3, o: .45, ns: true }), 0, .15, .06);
    },

    riceCooker(g) {
      const cream = mat(g, 0xf3ecdc, { r: .5 });
      const dark = mat(g, 0x4a4b45, { r: .5 });
      C(g, .15, .16, .21, cream, 0, 0, 0);
      C(g, .145, .152, .045, mat(g, 0xf8f3e8, { r: .4 }), 0, .21, 0);
      C(g, .026, .032, .024, dark, 0, .255, 0);
      B(g, .06, .022, .022, cream, -.145, .12, 0);
      B(g, .06, .022, .022, cream, .145, .12, 0);
      B(g, .06, .022, .018, dark, 0, .06, .158);
      B(g, .036, .008, .012, mat(g, 0x8fd3a8, { e: 0x4cbb7f, ei: 1 }), 0, .095, .158);
      C(g, .012, .012, .008, mat(g, 0xc47a58, { r: .6 }), .07, .255, 0);
    },

    toothbrush(g) {
      const mint = mat(g, 0x67a69d, { r: .5 });
      C(g, .01, .012, .13, mint, 0, 0, 0, { rz: .06 });
      B(g, .022, .03, .012, mint, .01, .13, 0);
      B(g, .019, .022, .005, mat(g, 0xf7f3e7, { r: .9 }), .01, .133, .008);
    },

    toothpaste(g) {
      const white = mat(g, 0xf7f3e8, { r: .6 });
      R(g, .11, .032, .036, white, 0, 0, 0, { r: .014 });
      B(g, .11, .012, .037, mat(g, 0x5fa89e, { r: .6 }), 0, .01, 0);
      C(g, .014, .016, .018, mat(g, 0x4f8f87), .065, .007, 0, { rz: -Math.PI / 2 });
      B(g, .02, .004, .038, white, -.06, .032, 0);
    },

    cup(g) {
      const blue = mat(g, 0xd8e8ec, { r: .25, o: .72 });
      C(g, .044, .036, .09, blue, 0, 0, 0);
      C(g, .034, .034, .004, mat(g, 0xbcd4da, { r: .3 }), 0, .085, 0);
      Tor(g, .028, .006, blue, .05, .05, 0, { ry: Math.PI / 2, seg: 8 });
    },

    eggSteamer(g) {
      const cream = mat(g, 0xf2ebdb, { r: .55 });
      C(g, .12, .13, .06, cream, 0, 0, 0);
      C(g, .1, .11, .07, mat(g, 0xe7efe9, { r: .3, o: .65, ns: true }), 0, .06, 0);
      C(g, .07, .08, .025, cream, 0, .13, 0);
      C(g, .022, .026, .018, mat(g, 0x4f8f87, { r: .5 }), 0, .155, 0);
      B(g, .05, .018, .02, cream, .12, .03, 0);
    },

    bucket(g) {
      const steel = mat(g, 0x79979b, { r: .45, m: .2 });
      C(g, .1, .078, .16, steel, 0, 0, 0);
      Tor(g, .1, .007, mat(g, 0x5f7d81), 0, .158, 0, { rx: Math.PI / 2 });
      Tor(g, .105, .006, mat(g, 0x5f7d81, { r: .5 }), 0, .16, 0, { arc: Math.PI, seg: 8 });
      C(g, .082, .082, .004, mat(g, 0x93acae, { r: .4 }), 0, .002, 0);
    },

    dryingRod(g) {
      const met = mat(g, 0x979a90, { r: .4, m: .35 });
      C(g, .014, .014, 1.66, met, -.44, 0, 0);
      C(g, .014, .014, 1.66, met, .44, 0, 0);
      Put(g, new T.CylinderGeometry(.011, .011, .98, 12), met, 0, 1.66, 0, 0, 0, Math.PI / 2);
      C(g, .011, .011, .6, met, 0, .5, 0, { rz: Math.PI / 2 });
      B(g, .18, .028, .07, met, -.44, 0, 0);
      B(g, .18, .028, .07, met, .44, 0, 0);
      const cloth = mat(g, 0xd9a98b, { r: .95 });
      R(g, .24, .3, .012, cloth, .2, 1.36, .0, { r: .01 });
      Tor(g, .026, .004, met, .2, 1.67, 0, { arc: Math.PI, seg: 6 });
      Tor(g, .02, .004, met, -.14, 1.67, 0, { arc: Math.PI, seg: 6 });
    },

    wallMirror(g) {
      const wood = mat(g, 0x8e6b4a, { r: .65 });
      R(g, .44, .6, .028, wood, 0, 0, 0, { r: .018 });
      Put(g, new T.PlaneGeometry(.37, .52), basic(g, { map: TX.mirror }), 0, .3, .036);
      B(g, .1, .02, .012, wood, 0, .6, -.02);
    },

    tableware(g) {
      const cream = mat(g, 0xf4eee1, { r: .35 });
      C(g, .09, .074, .03, cream, 0, 0, 0);
      C(g, .074, .058, .028, cream, 0, .03, 0);
      C(g, .056, .045, .026, cream, 0, .058, 0);
      C(g, .11, .11, .011, cream, .18, 0, 0);
      C(g, .11, .11, .011, cream, .18, .011, 0);
      const wood = mat(g, 0xa97b4f, { r: .7 });
      Put(g, new T.CylinderGeometry(.0035, .0035, .24, 6), wood, -.15, .01, .07, 0, 0, Math.PI / 2);
      Put(g, new T.CylinderGeometry(.0035, .0035, .24, 6), wood, -.15, .01, .085, 0, 0, Math.PI / 2);
    },

    dishSoap(g) { pumpBottle(g, 0x8fbea2, .22, .042); },

    rag(g) {
      const cloth = mat(g, 0x7899a2, { r: 1 });
      R(g, .15, .022, .11, cloth, 0, 0, 0, { r: .01 });
      B(g, .15, .006, .02, mat(g, 0xe6dcc3, { r: .9 }), 0, .022, -.02);
      B(g, .15, .006, .015, mat(g, 0xe6dcc3, { r: .9 }), 0, .022, .028);
    },

    shampoo(g) { pumpBottle(g, 0xdcebe2, .24, .045); },
    bodyWash(g) { pumpBottle(g, 0xe5c49c, .26, .047); },

    faceWash(g) {
      R(g, .05, .1, .036, mat(g, 0xf7f0e6, { r: .5 }), 0, 0, 0, { r: .012 });
      C(g, .016, .018, .024, mat(g, 0xd79c8f, { r: .5 }), 0, .1, 0);
      B(g, .036, .03, .004, mat(g, 0xe6b7aa, { r: .6 }), 0, .04, .019);
    },

    detergent(g) {
      const blue = mat(g, 0x7fa9bd, { r: .5 });
      R(g, .16, .22, .11, blue, 0, 0, 0, { r: .03 });
      C(g, .034, .034, .03, mat(g, 0x4f7588, { r: .5 }), 0, .22, 0);
      Tor(g, .045, .009, blue, .11, .15, 0, { ry: Math.PI / 2, arc: Math.PI, seg: 8, rz: Math.PI });
      B(g, .1, .07, .004, mat(g, 0xf2eddf, { r: .7 }), 0, .07, .056);
      B(g, .07, .012, .005, mat(g, 0x5f8fa4, { r: .6 }), 0, .12, .058);
    },

    razor(g) {
      const dark = mat(g, 0x3f5561, { r: .4 });
      Put(g, new T.CylinderGeometry(.007, .009, .11, 10), dark, .012, .009, 0, 0, 0, Math.PI / 2);
      R(g, .03, .016, .05, mat(g, 0xc4c9cb, { m: .6, r: .3 }), -.058, .008, 0, { r: .004 });
      B(g, .022, .004, .044, mat(g, 0xdfe4e4, { r: .4 }), -.06, .018, 0);
    },

    shavingFoam(g) {
      C(g, .033, .035, .16, mat(g, 0xf4f1e9, { r: .5 }), 0, 0, 0);
      C(g, .035, .035, .015, mat(g, 0x5f93a2), 0, .16, 0);
      C(g, .012, .014, .025, mat(g, 0x8fb7c2), 0, .175, 0);
      C(g, .034, .034, .045, mat(g, 0x86b8c4, { r: .6 }), 0, .07, 0);
    }
  };

  // ---------- 摆位 ----------

  const LAYOUT = {
    // 床边：枕头、眼罩在床铺头部
    blanket: { m: 'quilt', p: [-3.66, .56, -2.02], r: .08 },
    pillow: { m: 'pillow', p: [-3.6, .56, -2.88], r: .08 },
    mat: { m: 'matRoll', p: [-3.35, .003, -1.42], r: .18 },
    'eye-mask': { m: 'eyeMask', p: [-3.6, .732, -2.82], r: -.2, s: 1.25 },
    earplugs: { m: 'earplugs', p: [-2.31, .022, -1.98], r: .25, s: 1.4 },
    'lint-roller': { m: 'lintRoller', p: [-2.6, .003, -1.63], r: .35, s: 1.15 },

    // 书桌
    monitor: { m: 'monitor', p: [-1.74, .79, -2.94], r: 0 },
    laptop: { m: 'laptop', p: [-.64, .79, -2.88], r: .12 },
    'laptop-cable': { m: 'cableCoil', p: [-1.05, .79, -2.63], r: .2 },
    'power-strip': { m: 'powerStrip', p: [-2.46, .003, -2.18], r: .62 },
    charger: { m: 'charger', p: [-.7, .79, -2.62], r: .3 },
    'power-bank': { m: 'powerBank', p: [-.52, .79, -2.64], r: -.2 },
    headphones: { m: 'headphones', p: [-2.02, .79, -2.66], r: .15 },
    'phone-stand': { m: 'phoneStand', p: [-.46, .79, -3.1], r: -.12 },
    'backup-phone': { m: 'phone', p: [-1.18, .79, -3.02], r: .4 },
    'bt-speaker': { m: 'speaker', p: [-.8, 1.442, -3.28], r: .08 },

    // 衣柜 / 梳妆台
    mirror: { m: 'mirrorStand', p: [-4.55, .78, 2.48], r: Math.PI / 2 },
    'hair-dryer': { m: 'hairDryer', p: [-4.66, .773, 2.08], r: 1.25, s: 1.35 },
    'nail-clipper': { m: 'nailClipper', p: [-4.33, .772, 2.9], r: .3 },
    'ear-pick': { m: 'earPick', p: [-4.28, .782, 2.96], r: 1.1 },
    floss: { m: 'floss', p: [-4.35, .78, 2.73], r: -.2 },
    'cotton-swab': { m: 'cottonSwabs', p: [-4.4, .78, 2.2], r: 0 },
    lotion: { m: 'lotion', p: [-4.28, .78, 2.42], r: 0 },
    hanger: { m: 'hanger', p: [4.02, 1.676, -1.32], r: Math.PI / 2, halo: true },
    tops: { m: 'tops', p: [-4.62, 1.84, 1.48], r: Math.PI / 2, s: .8, halo: true },
    pants: { m: 'pants', p: [-4.62, .418, 1.32], s: .85 },
    underwear: { m: 'underwear', p: [-4.62, .418, 1.5], s: .8 },
    socks: { m: 'socks', p: [-4.62, .418, 1.66], s: .9 },

    // 地面
    slippers: { m: 'slippers', p: [-2.5, .014, -.32], r: .18 },
    scissors: { m: 'scissors', p: [-1.55, .02, 2.62], r: .4 },
    knife: { m: 'knife', p: [-1.14, .016, 2.38], r: 1.2 },
    lighter: { m: 'lighter', p: [-.84, .016, 2.72], r: .5 },
    'alcohol-spray': { m: 'sprayBottle', p: [-.5, .016, 2.35], r: 0 },
    tape: { m: 'tape', p: [-.14, .016, 2.7], r: 0 },
    mask: { m: 'mask', p: [-3.0, .016, 2.82], r: .15 },
    'tissue-small': { m: 'tissueSmall', p: [-1.35, .016, 2.86], r: -.1 },
    'tissue-large': { m: 'tissueLarge', p: [-.74, .016, 2.9], r: .1 },
    'sewing-kit': { m: 'sewingKit', p: [-2.0, .016, 2.4], r: .3 },
    meds: { m: 'meds', p: [-2.56, .016, 2.72], r: .6 },
    'water-bottle': { m: 'waterBottle', p: [-2.9, .016, 2.4], r: 0 },
    umbrella: { m: 'umbrella', p: [-3.65, .016, 2.55], r: 1.35 },
    fan: { m: 'fan', p: [-3.78, .014, 1.58], r: .1 },
    scale: { m: 'scale', p: [-3.1, .016, 2.6], r: .05 },
    vacuum: { m: 'vacuum', p: [.46, .003, 1.52], r: -.5 },

    // 阳台
    'rice-cooker': { m: 'riceCooker', p: [1.66, .842, -2.9], r: .15 },
    toothbrush: { m: 'toothbrush', p: [1.36, 1.132, -3.27], r: .4 },
    toothpaste: { m: 'toothpaste', p: [1.86, 1.126, -3.27], r: 1.48 },
    'rinse-cup': { m: 'cup', p: [1.36, 1.126, -3.27], r: .2 },
    'egg-steamer': { m: 'eggSteamer', p: [2.22, .842, -2.95], r: -.2 },
    bucket: { m: 'bucket', p: [3.86, .004, -2.42], r: .2 },
    'drying-rack': { m: 'dryingRod', p: [4.02, .004, -1.5], r: 1.57 },
    'balcony-mirror': { m: 'wallMirror', p: [1.55, 1.125, -3.36], r: 0, halo: true },
    tableware: { m: 'tableware', p: [2.72, .842, -2.92], r: .1 },
    'dish-soap': { m: 'dishSoap', p: [3.08, .842, -2.94], r: 0 },
    rag: { m: 'rag', p: [3.4, .842, -2.84], r: .25 },

    // 卫生间
    shampoo: { m: 'shampoo', p: [3.34, .576, 1.64], r: .1 },
    'body-wash': { m: 'bodyWash', p: [3.58, .576, 1.64], r: 0 },
    'face-wash': { m: 'faceWash', p: [3.82, .576, 1.64], r: -.15 },
    'laundry-detergent': { m: 'detergent', p: [2.7, .005, .38], r: .25 },
    razor: { m: 'razor', p: [2.3, .78, .15], r: .9 },
    'shaving-foam': { m: 'shavingFoam', p: [2.16, .78, .38], r: 0 }
  };

  window.XW = {
    T: T,
    TX: TX,
    make: make,
    mat: mat,
    basic: basic,
    R: R,
    B: B,
    C: C,
    S: S,
    Tor: Tor,
    Put: Put,
    addMesh: addMesh,
    rboxGeo: rboxGeo,
    MODELS: MODELS,
    LAYOUT: LAYOUT
  };
})();
