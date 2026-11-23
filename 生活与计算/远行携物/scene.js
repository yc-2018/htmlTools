// 三维剖屋：房间 + 阳台 + 卫生间，家具与物品全部是程序化模型
(function () {
  'use strict';

  const T = THREE, K = window.XW;
  const make = K.make, mat = K.mat, basic = K.basic;
  const R = K.R, B = K.B, C = K.C, S = K.S, Tor = K.Tor, Put = K.Put, TX = K.TX;

  let renderer, scene, camera, canvas, decor, handlers = {};
  let entries = [], raycaster, ndc;
  let sized = false, activeView = 'all', time = 0;

  const cam = {
    theta: .56, phi: .96, radius: 20,
    target: new T.Vector3(-.32, .62, -.2)
  };
  const want = {
    theta: cam.theta, phi: cam.phi, radius: cam.radius,
    target: cam.target.clone()
  };

  const VIEWS = {
    all: { target: [-.2, .55, -.15], w: 9.8, d: 6.8, r: 14.4, theta: .54, phi: .94 },
    room: { target: [-2.25, .6, .05], w: 6.6, d: 6.5, r: 8.6, theta: .5, phi: .97 },
    balcony: { target: [2.55, .9, -2.25], w: 4.2, d: 3.7, r: 5.9, theta: .56, phi: .98 },
    bath: { target: [2.9, .5, 1.5], w: 4.2, d: 3.7, r: 6.2, theta: .5, phi: 1.02 }
  };

  // ---------- 房间外壳与家具 ----------

  function block(g, w, h, d, color, x, y, z, o) {
    return R(g, w, h, d, mat(g, color, o), x, y, z, o);
  }

  function woodMat(g, tone) {
    return mat(g, tone || 0xb98a5c, { r: .72 });
  }

  function makeBase() {
    const g = make();
    decor.add(g);

    const slab = mat(g, 0x6d5140, { r: .8 });
    R(g, 9.9, .26, 7.0, slab, -.2, -.31, -.17, { r: .06 });
    R(g, 9.6, .04, 6.7, mat(g, 0x5b4334, { r: .85 }), -.2, -.07, -.17, { r: .02 });

    const wood = mat(g, 0xffffff, { r: .8, map: TX.wood });
    const bf = new T.Mesh(new T.PlaneGeometry(6.02, 6.48), wood);
    bf.rotation.x = -Math.PI / 2;
    bf.position.set(-1.96, .002, -.17);
    bf.receiveShadow = true;
    g.add(bf);

    const balconyFloor = mat(g, 0xffffff, { r: .8, map: TX.balconyTile });
    const bl = new T.Mesh(new T.PlaneGeometry(3.54, 3.18), balconyFloor);
    bl.rotation.x = -Math.PI / 2;
    bl.position.set(2.79, .004, -1.81);
    bl.receiveShadow = true;
    g.add(bl);

    const bathFloor = mat(g, 0xffffff, { r: .7, map: TX.bathTile });
    const ba = new T.Mesh(new T.PlaneGeometry(3.54, 3.24), bathFloor);
    ba.rotation.x = -Math.PI / 2;
    ba.position.set(2.79, .005, 1.46);
    ba.receiveShadow = true;
    g.add(ba);

    const rugMat = new T.MeshStandardMaterial({
      map: TX.rug, transparent: true, alphaTest: .35, roughness: 1
    });
    g.userData.mats.push(rugMat);
    const rug = new T.Mesh(new T.PlaneGeometry(3.6, 2.8), rugMat);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-2.35, .012, .35);
    rug.receiveShadow = true;
    g.add(rug);

    const runnerMat = new T.MeshStandardMaterial({
      map: TX.runner, transparent: true, alphaTest: .35, roughness: 1
    });
    g.userData.mats.push(runnerMat);
    const runner = new T.Mesh(new T.PlaneGeometry(4.4, .78), runnerMat);
    runner.rotation.x = -Math.PI / 2;
    runner.position.set(-1.65, .014, 2.62);
    runner.receiveShadow = true;
    g.add(runner);

    const catcher = new T.Mesh(new T.PlaneGeometry(22, 16), new T.ShadowMaterial({ opacity: .16 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.set(-.2, -.445, -.17);
    catcher.receiveShadow = true;
    g.add(catcher);
  }

  function makeWalls() {
    const g = make();
    decor.add(g);
    const wall = mat(g, 0xf0e7d7, { r: .95 });
    const wall2 = mat(g, 0xecefe5, { r: .95 });
    const trim = woodMat(g, 0xe4d6c0);

    B(g, 6.04, 2.7, .16, wall, -1.96, 0, -3.46);
    B(g, 3.56, 2.7, .16, wall2, 2.8, 0, -3.46);
    B(g, .16, 2.7, 6.5, wall, -5.03, 0, -.17);
    B(g, 6.04, .1, .2, trim, -1.96, 2.6, -3.46);
    B(g, 3.56, .1, .2, trim, 2.8, 2.6, -3.46);
    B(g, .2, .1, 6.5, trim, -5.03, 2.6, -.17);
    B(g, .16, .12, 6.5, trim, -4.94, 0, -.17);
    B(g, 6.04, .12, .16, trim, -1.96, 0, -3.37);

    // 卧室后墙的窗
    const winX = -3.58, winY = 1.82, winZ = -3.37;
    B(g, 1.24, 1.12, .04, mat(g, 0xf7f2e6, { r: .65 }), winX, winY, winZ);
    Put(g, new T.PlaneGeometry(1.08, .96), basic(g, { map: TX.sky }), winX, winY + .56, winZ + .024);
    const frameM = mat(g, 0xe8ddc8, { r: .6 });
    B(g, 1.16, .045, .05, frameM, winX, winY + 1.06, winZ + .03);
    B(g, 1.16, .045, .05, frameM, winX, winY, winZ + .03);
    B(g, .045, 1.1, .05, frameM, winX - .55, winY, winZ + .03);
    B(g, .045, 1.1, .05, frameM, winX + .55, winY, winZ + .03);
    B(g, .03, 1.04, .04, frameM, winX, winY + .02, winZ + .03);
    B(g, .03, .5, .04, frameM, winX, winY + .58, winZ + .03);
    B(g, 1.5, .05, .22, mat(g, 0xe4d3b8, { r: .7 }), winX, winY - .04, winZ + .1);

    // 窗帘
    const curtain = mat(g, 0xe0cbb0, { r: 1 });
    [-.78, .78].forEach((dx, i) => {
      R(g, .18, 1.34, .09, curtain, winX + dx, 1.2, winZ + .1, { r: .045, ry: i ? -.08 : .08 });
      R(g, .06, 1.32, .1, curtain, winX + dx + (i ? -.06 : .06), 1.21, winZ + .11, { r: .03 });
    });
    C(g, .014, .014, 1.7, mat(g, 0x8b7a62, { m: .4, r: .4 }), winX, 2.52, winZ + .13, { rz: Math.PI / 2 });

    // 阳台后墙的窗
    const bx = 3.38, by = 1.42, bz = -3.37;
    B(g, 1.56, 1.12, .04, mat(g, 0xf7f3e9, { r: .65 }), bx, by, bz);
    Put(g, new T.PlaneGeometry(1.4, .96), basic(g, { map: TX.sky }), bx, by + .56, bz + .024);
    B(g, 1.48, .04, .05, frameM, bx, by + 1.06, bz + .03);
    B(g, 1.48, .04, .05, frameM, bx, by, bz + .03);
    B(g, .04, 1.1, .05, frameM, bx - .7, by, bz + .03);
    B(g, .04, 1.1, .05, frameM, bx + .7, by, bz + .03);
    B(g, .03, 1.02, .04, frameM, bx, by + .02, bz + .03);
    B(g, 1.8, .05, .2, mat(g, 0xdfd2bb, { r: .7 }), bx, by - .04, bz + .09);

    // 玻璃隔断（卧室 / 阳台）
    const frame = mat(g, 0x4a453d, { r: .45, m: .3 });
    const glass = mat(g, 0xd7e8e4, { r: .1, o: .18, ns: true });
    const px = 1.03;
    B(g, .08, .1, 3.2, frame, px, 0, -1.8);
    B(g, .08, .08, 3.2, frame, px, 2.28, -1.8);
    B(g, .07, 2.3, .08, frame, px, .04, -3.36);
    B(g, .07, 2.3, .08, frame, px, .04, -.26);
    B(g, .05, 2.26, .05, frame, px, .06, -1.82);
    B(g, .045, 2.2, 1.45, glass, px, .06, -2.58);
    B(g, .045, 2.2, 1.35, glass, px + .05, .06, -1.0);
    B(g, .05, .05, 1.5, frame, px, 1.02, -2.6);
    B(g, .05, .05, 1.35, frame, px, 1.02, -1.0);

    // 半墙：阳台 / 卫生间
    const halfTile = mat(g, 0xe9f1ec, { r: .7, map: TX.balconyTile });
    B(g, 3.52, 1.16, .17, halfTile, 2.79, 0, -.2);
    B(g, 3.6, .055, .24, mat(g, 0xe0cfb6, { r: .7 }), 2.79, 1.16, -.2);
    // 半墙：卧室 / 卫生间
    B(g, .17, 1.16, 3.3, halfTile, 1.0, 0, 1.42);
    B(g, .24, .055, 3.38, mat(g, 0xe0cfb6, { r: .7 }), 1.0, 1.16, 1.42);

    // 阳台栏杆
    const railGlass = mat(g, 0xcfe4e0, { r: .1, o: .22, ns: true });
    const rail = mat(g, 0x6a675e, { r: .4, m: .4 });
    B(g, .07, 1.02, .07, rail, 4.53, 0, -3.33);
    B(g, .07, 1.02, .07, rail, 4.53, 0, -.35);
    B(g, .05, .05, 3.05, rail, 4.53, 1.0, -1.84);
    B(g, .04, .88, 2.95, railGlass, 4.53, .1, -1.84);
    for (let i = 0; i < 6; i++) {
      B(g, .04, .8, .04, rail, 4.53, .12, -3.2 + i * .6);
    }

    // 阳台窗边的挂钩与小帘
    const curtain2 = mat(g, 0xdad3bd, { r: 1 });
    [-1, 1].forEach(s => {
      R(g, .13, 1.1, .08, curtain2, bx + s * 1.03, 1.02, bz + .1, { r: .035 });
    });

    // 左边墙上的挂钟
    const clockRim = mat(g, 0x8b6f4f, { r: .55 });
    const ck = new T.Mesh(new T.CircleGeometry(.17, 32), basic(g, { map: TX.clock }));
    ck.position.set(-4.93, 1.98, -.9);
    ck.rotation.y = Math.PI / 2;
    g.add(ck);
    Tor(g, .175, .012, clockRim, -4.94, 1.98, -.9, { ry: Math.PI / 2, seg: 8 });

    // 床头上方的装饰画
    B(g, .7, .52, .035, mat(g, 0x8b6f4f, { r: .6 }), -2.38, 1.74, -3.35);
    Put(g, new T.PlaneGeometry(.6, .44), basic(g, { map: TX.art1 }), -2.38, 2.0, -3.328);

    // 书桌上方的画
    B(g, .5, .66, .035, mat(g, 0x8b6f4f, { r: .6 }), -1.62, 1.62, -3.35);
    Put(g, new T.PlaneGeometry(.4, .56), basic(g, { map: TX.art2 }), -1.62, 1.95, -3.328);
  }

  function makeBedroom() {
    const g = make();
    decor.add(g);
    const wood = woodMat(g, 0xc09466);
    const wood2 = mat(g, 0x9a7048, { r: .7 });
    const linen = mat(g, 0xf4ecdc, { r: .95 });

    // 床
    R(g, 1.2, .24, 1.5, wood, -3.6, .02, -2.42, { r: .03 });
    R(g, 1.1, .32, 1.4, linen, -3.6, .24, -2.42, { r: .05 });
    R(g, 1.16, .72, .09, wood2, -3.6, .24, -3.19, { r: .03 });
    R(g, 1.0, .06, .12, linen, -3.6, .92, -3.17, { r: .02 });
    R(g, .06, .16, .06, wood2, -4.12, 0, -1.72);
    R(g, .06, .16, .06, wood2, -3.08, 0, -1.72);
    R(g, .38, .025, .2, mat(g, 0xc8b9a2, { r: .9 }), -2.38, .5, -2.84, { r: .01 });

    // 床头柜
    R(g, .48, .44, .44, wood, -2.32, 0, -2.96, { r: .02 });
    R(g, .52, .06, .48, wood2, -2.32, .44, -2.96, { r: .02 });
    R(g, .36, .02, .04, wood2, -2.32, .22, -2.72, { r: .008 });
    R(g, .06, .1, .06, wood2, -2.5, 0, -2.78);
    R(g, .06, .1, .06, wood2, -2.14, 0, -2.78);
    C(g, .045, .06, .06, mat(g, 0xe0c8a4, { r: .6 }), -2.32, .5, -3.04);
    C(g, .075, .09, .1, mat(g, 0xf2e5c9, { r: .8 }), -2.32, .56, -3.04);
    C(g, .008, .008, .16, mat(g, 0x6b6254, { m: .3 }), -2.32, .56, -3.04);

    // 床边的小碟，耳塞放在上面
    C(g, .07, .06, .018, mat(g, 0xe4d7c0, { r: .6 }), -2.31, .002, -1.99);
    Tor(g, .069, .005, mat(g, 0xd2c1a6, { r: .5 }), -2.31, .02, -1.99, { rx: Math.PI / 2 });

    // 书桌
    const deskX = -1.62, deskZ = -2.9;
    R(g, 2.5, .05, .7, wood2, deskX, .74, deskZ, { r: .025 });
    R(g, .06, .74, .62, wood, deskX - 1.18, 0, deskZ, { r: .01 });
    R(g, .06, .74, .62, wood, deskX + 1.18, 0, deskZ, { r: .01 });
    R(g, 2.1, .14, .04, wood, deskX, .6, deskZ + .27, { r: .01 });

    // 桌上小书架
    B(g, 1.3, .045, .22, wood2, -.82, 1.42, -3.26);
    B(g, .035, .22, .2, wood, -.82, 1.44, -3.27, { rz: 0 });
    B(g, .035, .22, .2, wood, -1.45, 1.44, -3.27);
    B(g, .035, .22, .2, wood, -.2, 1.44, -3.27);
    for (let i = 0; i < 4; i++) {
      const colors = [0xc98b6a, 0x6f8f85, 0xd8c3a2, 0x8f7f9c];
      B(g, .05, .17, .13, mat(g, colors[i], { r: .9 }), -.95 + i * .065, 1.448, -3.24, { rz: i % 2 ? -.06 : .04 });
    }

    // 椅子
    const chX = -.9, chZ = -2.22;
    R(g, .44, .05, .42, wood2, chX, .44, chZ, { r: .02 });
    [[-.19, -.17], [.19, -.17], [-.19, .17], [.19, .17]].forEach(p => {
      R(g, .045, .44, .045, wood, chX + p[0], 0, chZ + p[1]);
    });
    R(g, .42, .44, .05, wood, chX, .47, chZ - .17, { r: .02 });
    R(g, .36, .3, .02, mat(g, 0xd5c7b1, { r: .95 }), chX, .56, chZ - .17, { r: .015 });

    // 衣柜
    const wx = -4.68, wz = .55;
    R(g, .62, 2.28, .96, mat(g, 0xb58a5e, { r: .7 }), wx, 0, wz, { r: .02 });
    R(g, .66, .08, 1, wood2, wx, 2.28, wz, { r: .02 });
    const door = mat(g, 0xc79d6d, { r: .65 });
    R(g, .03, 2.1, .42, door, wx + .325, .07, wz - .235, { r: .01 });
    R(g, .03, 2.1, .42, door, wx + .325, .07, wz + .235, { r: .01 });
    B(g, .02, .34, .04, mat(g, 0x6b5a45, { m: .3 }), wx + .345, 1.2, wz - .05);
    B(g, .02, .34, .04, mat(g, 0x6b5a45, { m: .3 }), wx + .345, 1.2, wz + .05);

    // 开放式衣物架
    const rx = -4.62, rz = 1.48;
    const rack = mat(g, 0xa9a49a, { r: .35, m: .35 });
    B(g, .04, 1.84, .04, rack, rx, 0, rz - .31);
    B(g, .04, 1.84, .04, rack, rx, 0, rz + .31);
    B(g, .36, .035, .035, rack, rx, .015, rz - .31);
    B(g, .36, .035, .035, rack, rx, .015, rz + .31);
    B(g, .035, .035, .66, rack, rx, 1.83, rz);
    B(g, .46, .035, .68, wood2, rx, .4, rz);

    // 梳妆台
    const dx = -4.56, dz = 2.48;
    R(g, .6, .72, 1.08, wood, dx, 0, dz, { r: .02 });
    R(g, .64, .06, 1.12, wood2, dx, .72, dz, { r: .02 });
    for (let i = 0; i < 3; i++) {
      R(g, .02, .16, .96, mat(g, 0xd0aa7d, { r: .6 }), dx + .305, .12 + i * .2, dz, { r: .01 });
      B(g, .025, .03, .12, mat(g, 0x7b6249, { m: .3 }), dx + .32, .2 + i * .2, dz);
    }
    B(g, .06, .1, .06, wood2, dx - .22, 0, dz - .42);
    B(g, .06, .1, .06, wood2, dx - .22, 0, dz + .42);
    B(g, .06, .1, .06, wood2, dx + .22, 0, dz - .42);
    B(g, .06, .1, .06, wood2, dx + .22, 0, dz + .42);
    B(g, .5, .025, .03, wood2, dx + .04, .78, dz + .18);

    // 角落落地灯
    C(g, .02, .02, 1.5, mat(g, 0x6d6354, { m: .4, r: .4 }), -2.9, .012, 1.1);
    C(g, .2, .22, .03, mat(g, 0x6d6354, { m: .4, r: .4 }), -2.9, .012, 1.1);
    C(g, .12, .2, .24, mat(g, 0xf4e6c8, { r: .7, e: 0xffe6b0, ei: .35 }), -2.9, 1.512, 1.1);
    // 地毯上的小植栽
    C(g, .1, .13, .18, mat(g, 0xc98b6a, { r: .8 }), -3.3, .012, -.1);
    S(g, .14, mat(g, 0x6f8f70, { r: .95 }), -3.3, .312, -.1, { seg: 10 });
    S(g, .09, mat(g, 0x7fa07c, { r: .95 }), -3.22, .412, -.06, { seg: 10 });
    S(g, .08, mat(g, 0x5e7f64, { r: .95 }), -3.4, .402, -.14, { seg: 10 });
  }

  function makeBalcony() {
    const g = make();
    decor.add(g);
    const wood = woodMat(g, 0xb99164);
    const dark = mat(g, 0x8f704f, { r: .7 });
    const metal = mat(g, 0xa9aba1, { r: .35, m: .45 });

    // 操作台
    const cx = 2.4, cz = -2.9;
    R(g, 2.24, .78, .5, mat(g, 0xd8cdb7, { r: .8 }), cx, 0, cz, { r: .015 });
    R(g, 2.3, .055, .56, wood, cx, .78, cz, { r: .02 });
    B(g, 2.2, .006, .47, mat(g, 0xe9e2d2, { r: .3, m: .05 }), cx, .835, cz);
    for (let i = 0; i < 2; i++) {
      R(g, 1.0, .6, .02, mat(g, 0xe3dac8, { r: .8 }), cx - .55 + i * 1.08, .1, cz + .26, { r: .01 });
      B(g, .1, .02, .025, dark, cx - .55 + i * 1.08, .46, cz + .28);
    }
    B(g, .06, .1, .06, dark, cx - 1.02, 0, cz + .18);
    B(g, .06, .1, .06, dark, cx + 1.02, 0, cz + .18);

    // 墙上置物架
    B(g, .82, .035, .22, wood, 1.66, 1.09, -3.27);
    B(g, .035, .11, .17, dark, 1.3, .98, -3.29);
    B(g, .035, .11, .17, dark, 2.02, .98, -3.29);

    // 洗衣篮
    C(g, .17, .15, .34, mat(g, 0xbea887, { r: .95 }), 4.15, 0, -2.94);
    Tor(g, .175, .013, mat(g, 0x9d8668, { r: .8 }), 4.15, .345, -2.94, { rx: Math.PI / 2 });
    R(g, .27, .05, .2, mat(g, 0xe9dfcc, { r: .95 }), 4.15, .33, -2.94, { r: .02 });

    // 晾衣杆的物品本身在 MODELS；这里加一个接水盘和拖鞋装饰
    C(g, .1, .1, .006, mat(g, 0x9ab0a8, { r: .4 }), 2.48, .004, -1.58);
    R(g, .19, .02, .11, mat(g, 0xb1a18a, { r: .9 }), 3.72, .005, -1.0, { r: .02 });

    // 栏杆上的小盆栽
    const pot = mat(g, 0xc98462, { r: .8 });
    C(g, .12, .09, .16, pot, 4.53, 1.05, -2.86);
    S(g, .13, mat(g, 0x6e8f70, { r: .95 }), 4.53, 1.3, -2.86, { seg: 10 });
    S(g, .08, mat(g, 0x7fa07c, { r: .95 }), 4.45, 1.38, -2.82, { seg: 10 });
    S(g, .07, mat(g, 0x5e7f64, { r: .95 }), 4.59, 1.36, -2.9, { seg: 10 });

    // 右侧墙角的凳子与毛巾
    const stoolX = 4.14, stoolZ = -.62;
    R(g, .4, .05, .36, wood, stoolX, .42, stoolZ, { r: .02 });
    [[-.15, -.13], [.15, -.13], [-.15, .13], [.15, .13]].forEach(p => {
      R(g, .04, .42, .04, dark, stoolX + p[0], 0, stoolZ + p[1]);
    });
    R(g, .3, .08, .24, mat(g, 0xd6b49a, { r: .95 }), stoolX, .47, stoolZ, { r: .02 });
    C(g, .08, .1, .12, pot, stoolX, .55, stoolZ + .06);
    S(g, .1, mat(g, 0x799a77, { r: .95 }), stoolX, .72, stoolZ + .06, { seg: 9 });
  }

  function makeBath() {
    const g = make();
    decor.add(g);
    const white = mat(g, 0xfbf7ee, { r: .35 });
    const wood = woodMat(g, 0xc79a6a);
    const metal = mat(g, 0xb9bdb8, { m: .6, r: .25 });
    const tile = mat(g, 0xe8f0eb, { r: .55 });

    // 洗手台（靠半墙摆放）
    const vx = 2.03, vz = .22;
    R(g, 1.04, .72, .56, wood, vx, 0, vz, { r: .025 });
    R(g, 1.1, .06, .62, white, vx, .72, vz, { r: .02 });
    for (let i = 0; i < 2; i++) {
      R(g, .46, .5, .02, mat(g, 0xd7ad7d, { r: .65 }), vx - .28 + i * .56, .12, vz + .29, { r: .01 });
      B(g, .1, .02, .025, mat(g, 0x6f5a43, { m: .3 }), vx - .28 + i * .56, .36, vz + .31);
    }
    // 台上盆
    Tor(g, .14, .045, white, 1.93, .79, .24, { rx: Math.PI / 2, seg: 8 });
    C(g, .125, .1, .1, mat(g, 0xf1ece1, { r: .4 }), 1.93, .74, .24);
    C(g, .115, .115, .006, mat(g, 0xd7e8ea, { r: .2, o: .6, ns: true }), 1.93, .835, .24);
    C(g, .014, .014, .16, metal, 1.93, .78, .11);
    C(g, .012, .012, .15, metal, 1.93, .92, .11, { rx: Math.PI / 2 });
    // 镜子挂在半墙上，镜面高度控制在压顶以下
    B(g, .62, .3, .03, wood, 1.93, .855, -.1);
    Put(g, new T.PlaneGeometry(.52, .24), basic(g, { map: TX.mirror }), 1.93, 1.005, -.083);

    // 马桶
    const tx = 1.42, tz = 2.55;
    R(g, .3, .62, .5, white, 1.16, 0, tz, { r: .03 });
    R(g, .34, .05, .56, white, 1.16, .62, tz, { r: .02 });
    C(g, .2, .24, .34, white, 1.48, .05, tz, { seg: 20 });
    const bowl = new T.Mesh(new T.SphereGeometry(.235, 20, 14), white);
    bowl.scale.set(1, .55, .92);
    bowl.position.set(1.48, .3, tz);
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    g.add(bowl);
    C(g, .25, .25, .045, mat(g, 0xf4eee3, { r: .4 }), 1.48, .4, tz);
    C(g, .19, .19, .008, mat(g, 0xd9e8e6, { r: .3 }), 1.48, .446, tz);
    B(g, .05, .02, .12, metal, 1.16, .675, tz);
    B(g, .02, .03, .2, mat(g, 0xcac6ba, { r: .5 }), 1.32, .55, tz - .42);

    // 浴缸
    const bx = 3.55, bz = 1.78;
    R(g, .94, .1, 1.52, mat(g, 0xe9e4d8, { r: .5 }), bx, 0, bz, { r: .05 });
    R(g, 1.04, .46, 1.6, white, bx, .08, bz, { r: .12 });
    R(g, .96, .06, 1.52, mat(g, 0xf7f2e8, { r: .4 }), bx, .5, bz, { r: .1 });
    const water = new T.Mesh(new T.PlaneGeometry(.86, 1.42), mat(g, 0xcfe4e2, { r: .15, o: .65, ns: true }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(bx, .526, bz);
    g.add(water);
    C(g, .014, .014, .16, metal, bx - .38, .55, bz - .64);
    C(g, .012, .012, .12, metal, bx - .38, .71, bz - .64, { rx: Math.PI / 2 });
    // 浴缸上的木托板
    R(g, .84, .025, .26, wood, bx, .55, bz - .18, { r: .012 });
    B(g, .06, .01, .1, wood, bx, .575, bz - .18);

    // 半墙上的毛巾杆：手巾 + 浴巾
    const barM = mat(g, 0xa9aba2, { m: .55, r: .3 });
    B(g, .9, .02, .02, barM, 3.5, .95, -.1);
    B(g, .03, .05, .03, barM, 3.06, .92, -.1);
    B(g, .03, .05, .03, barM, 3.94, .92, -.1);
    const handTowel = mat(g, 0xe4cdbd, { r: .95 });
    R(g, .26, .38, .045, handTowel, 3.18, .57, -.073, { r: .01 });
    R(g, .27, .07, .06, handTowel, 3.18, .945, -.073, { r: .015 });
    const bathTowel = mat(g, 0xf1e3cf, { r: .95 });
    R(g, .5, .76, .045, bathTowel, 3.62, .2, -.073, { r: .012 });
    R(g, .51, .08, .065, bathTowel, 3.62, .935, -.073, { r: .015 });
    B(g, .5, .055, .004, mat(g, 0xcfae92, { r: .9 }), 3.62, .32, -.048);

    // 洗衣机旁的地垫与凳子
    const matM = new T.MeshStandardMaterial({ color: 0xd8c8b0, roughness: 1 });
    g.userData.mats.push(matM);
    const bm = new T.Mesh(new T.PlaneGeometry(1.0, .48), matM);
    bm.rotation.x = -Math.PI / 2;
    bm.position.set(3.55, .014, 2.78);
    bm.receiveShadow = true;
    g.add(bm);
    const sw = 4.18;
    R(g, .4, .06, .34, wood, sw, .38, .62, { r: .02 });
    [[-.14, -.12], [.14, -.12], [-.14, .12], [.14, .12]].forEach(p => {
      R(g, .04, .38, .04, wood, sw + p[0], 0, .62 + p[1]);
    });
    R(g, .26, .1, .22, mat(g, 0xe9dfcc, { r: .95 }), sw, .44, .62, { r: .02 });
    // 凳上的小绿植
    C(g, .1, .07, .14, mat(g, 0xc98462, { r: .8 }), 4.18, .55, .62);
    S(g, .11, mat(g, 0x6f9070, { r: .95 }), 4.18, .73, .62, { seg: 10 });
    S(g, .07, mat(g, 0x7fa07c, { r: .95 }), 4.1, .81, .58, { seg: 9 });
    // 地面小方块装饰
    B(g, .16, .012, .16, mat(g, 0xbacac3, { r: .6 }), 4.3, .002, 1.4);
    for (let i = 0; i < 3; i++) B(g, .13, .002, .012, mat(g, 0x8fa39b), 4.3, .014, 1.35 + i * .045);
  }

  // ---------- 搭物品 ----------

  function buildItems() {
    const layout = K.LAYOUT;
    const itemIds = Object.keys(window.XW_DATA.ITEM_MAP);
    const accent = new T.Color('#6b6154');

    itemIds.forEach(id => {
      const lay = layout[id];
      if (!lay) return;
      const model = K.MODELS[lay.m];
      if (!model) return;
      const g = make();
      model(g);
      if (lay.s) g.scale.setScalar(lay.s);
      g.position.set(lay.p[0], lay.p[1], lay.p[2]);
      g.rotation.y = lay.r || 0;
      scene.add(g);

      const bb = new T.Box3().setFromObject(g);
      const size = new T.Vector3();
      bb.getSize(size);
      const cx = (bb.min.x + bb.max.x) / 2;
      const cz = (bb.min.z + bb.max.z) / 2;
      const anchor = new T.Vector3(cx, bb.max.y + .1, cz);

      const ringMat = new T.MeshBasicMaterial({
        color: accent, transparent: true, opacity: .7,
        side: T.DoubleSide, depthWrite: false
      });
      const rad = Math.min(.42, Math.max(.14, Math.max(size.x, size.z) * .62));
      const ring = new T.Mesh(new T.TorusGeometry(rad, .007, 8, 40), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(cx, lay.halo ? (bb.min.y + bb.max.y) / 2 : lay.p[1] + .016, cz);
      ring.renderOrder = 6;
      ring.visible = false;
      scene.add(ring);

      const entry = {
        id: id,
        group: g,
        mats: g.userData.mats,
        anchor: anchor,
        ring: ring,
        ringMat: ringMat,
        required: false,
        hovered: false,
        dim: false,
        scale: 1,
        baseScale: lay.s || 1
      };
      g.traverse(o => {
        if (o.isMesh) {
          o.userData.entry = entry;
          o.castShadow = o.castShadow && !lay.halo;
        }
      });
      entry.mats.forEach(m => {
        m.userData.baseTransparent = m.transparent;
        m.userData.baseDepthWrite = m.depthWrite;
      });
      entries.push(entry);
    });
  }

  function applyEntryFade(e) {
    const dim = e.dim && !e.hovered;
    const f = dim ? .22 : 1;
    e.mats.forEach(m => {
      const base = m.userData.baseOpacity != null ? m.userData.baseOpacity : 1;
      m.opacity = base * f;
      m.transparent = f < .999 || m.userData.baseTransparent;
      if (m.userData.baseTransparent) m.depthWrite = f > .6 ? m.userData.baseDepthWrite : false;
      else m.depthWrite = f < .999 ? false : m.userData.baseDepthWrite;
    });
  }

  // ---------- 初始化 ----------

  function init(el, hs) {
    canvas = el;
    handlers = hs || {};
    try {
      renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (err) {
      return false;
    }
    if (!renderer || !renderer.getContext()) return false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x000000, 0);

    scene = new T.Scene();
    scene.userData.mats = [];

    camera = new T.PerspectiveCamera(32, 1, .1, 90);
    camera.position.set(9, 10, 12);

    raycaster = new T.Raycaster();
    ndc = new T.Vector2();

    const hemi = new T.HemisphereLight(0xfff6e6, 0x655c4d, .5);
    scene.add(hemi);
    const sun = new T.DirectionalLight(0xfff0d8, 1.05);
    sun.position.set(6.5, 11, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 32;
    sun.shadow.bias = -.0006;
    sun.shadow.normalBias = .015;
    scene.add(sun);
    const fill = new T.DirectionalLight(0xdfe9ff, .22);
    fill.position.set(-7, 6, 5);
    scene.add(fill);
    const warm = new T.PointLight(0xffd9a0, .28, 12, 2);
    warm.position.set(2.8, 2.2, .2);
    scene.add(warm);

    decor = make();
    scene.add(decor);

    makeBase();
    makeWalls();
    makeBedroom();
    makeBalcony();
    makeBath();
    buildItems();
    bindOrbit();
    resize();
    applyView(window.innerWidth < 760 ? 'room' : 'all', true);
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    time = 0;
    requestAnimationFrame(loop);
    return true;
  }

  function resize() {
    if (!renderer) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    sized = true;
    applyView(activeView, true);
  }

  function viewRadius(v) {
    const vf = T.MathUtils.degToRad(camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const minWidth = (v.w / 2) / Math.tan(hf / 2) * .75;
    return Math.max(v.r, minWidth);
  }

  function applyView(name, instant) {
    const v = VIEWS[name];
    if (!v || !camera) return;
    activeView = name;
    want.target.set(v.target[0], v.target[1], v.target[2]);
    want.theta = v.theta;
    want.phi = v.phi;
    want.radius = viewRadius(v);
    if (instant) {
      cam.target.copy(want.target);
      cam.theta = want.theta;
      cam.phi = want.phi;
      cam.radius = want.radius;
      placeCamera();
    }
  }

  function placeCamera() {
    const s = new T.Spherical(cam.radius, cam.phi, cam.theta);
    camera.position.set(0, 0, 0).add(cam.target).add(new T.Vector3().setFromSpherical(s));
    camera.lookAt(cam.target);
  }

  // ---------- 交互 ----------

  let dragging = false, panning = false, moved = 0, lastX = 0, lastY = 0;
  let pointers = new Map(), pinchDist = 0;

  function panBy(dx, dy) {
    const scale = 2 * want.radius * Math.tan(T.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, canvas.clientHeight);
    const right = new T.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new T.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    want.target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
    want.target.x = T.MathUtils.clamp(want.target.x, -6, 6);
    want.target.y = T.MathUtils.clamp(want.target.y, -.4, 3.4);
    want.target.z = T.MathUtils.clamp(want.target.z, -5, 5);
  }

  function bindOrbit() {
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragging = true;
        panning = e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey);
        if (panning) e.preventDefault();
        moved = 0;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.classList.add('dragging');
        if (panning) canvas.classList.add('panning');
      } else if (pointers.size === 2) {
        dragging = false;
        const arr = [...pointers.values()];
        pinchDist = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
      }
    });

    canvas.addEventListener('pointermove', e => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const arr = [...pointers.values()];
        const d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
        if (pinchDist) {
          want.radius = T.MathUtils.clamp(want.radius * pinchDist / Math.max(1, d), 1.4, 34);
        }
        pinchDist = d;
        return;
      }
      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        lastX = e.clientX;
        lastY = e.clientY;
        if (panning) {
          panBy(dx, dy);
        } else {
          want.theta -= dx * .0048;
          if (want.theta > Math.PI) want.theta -= Math.PI * 2;
          else if (want.theta < -Math.PI) want.theta += Math.PI * 2;
          want.phi = T.MathUtils.clamp(want.phi + dy * .0038, .4, 1.46);
        }
        return;
      }
      if (e.pointerType === 'mouse' && handlers.onHover) {
        const hit = pickAt(e.clientX, e.clientY);
        handlers.onHover(hit);
      }
    });

    const end = e => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        canvas.classList.remove('dragging', 'panning');
        if (!panning && dragging && moved < 7) {
          const hit = pickAt(e.clientX, e.clientY);
          if (hit && handlers.onPick) handlers.onPick(hit);
        }
        dragging = false;
        panning = false;
        pinchDist = 0;
      } else if (pointers.size === 1) {
        const p = [...pointers.values()][0];
        lastX = p.x;
        lastY = p.y;
        dragging = true;
        panning = false;
        canvas.classList.remove('panning');
        moved = 99;
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', e => {
      pointers.delete(e.pointerId);
      if (!pointers.size) {
        dragging = false;
        panning = false;
        canvas.classList.remove('dragging', 'panning');
      }
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('auxclick', e => e.preventDefault());
    canvas.addEventListener('pointerleave', e => {
      if (!dragging && e.pointerType === 'mouse' && handlers.onHover) handlers.onHover(null);
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      want.radius = T.MathUtils.clamp(want.radius * (1 + e.deltaY * .0011), 1.4, 34);
    }, { passive: false });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && handlers.onEscape) handlers.onEscape();
    });
  }

  function pickAt(clientX, clientY) {
    if (!camera) return null;
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const groups = [];
    for (const e of entries) groups.push(e.group);
    const hits = raycaster.intersectObjects(groups, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !(o.userData && o.userData.entry)) o = o.parent;
      if (o && o.userData.entry) return o.userData.entry.id;
    }
    // 小物件兜底：按屏幕距离找最近
    let best = null, bestD = 26;
    for (const e of entries) {
      const p = project(e.anchor);
      if (!p.visible) continue;
      const d = Math.hypot(p.x - (clientX - rect.left), p.y - (clientY - rect.top));
      if (d < bestD) {
        bestD = d;
        best = e.id;
      }
    }
    return best;
  }

  function project(v) {
    const p = v.clone().project(camera);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    return {
      x: (p.x * .5 + .5) * w,
      y: (-p.y * .5 + .5) * h,
      visible: p.z > -1 && p.z < 1
    };
  }

  // ---------- 状态 ----------

  function setMode(mode, requiredIds) {
    const reqSet = requiredIds ? new Set(requiredIds) : null;
    const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#6b6154';
    const col = new T.Color(accent).convertSRGBToLinear();
    entries.forEach(e => {
      e.required = !!(reqSet && reqSet.has(e.id));
      e.dim = !!(reqSet && !e.required);
      e.ring.visible = e.required;
      if (e.required) e.ringMat.color.copy(col);
      applyEntryFade(e);
    });
  }

  function setHover(id) {
    entries.forEach(e => {
      const h = e.id === id;
      if (h === e.hovered) return;
      e.hovered = h;
      applyEntryFade(e);
    });
  }

  function loop() {
    requestAnimationFrame(loop);
    const dt = .016;
    const k = .14;
    const dTheta = Math.atan2(Math.sin(want.theta - cam.theta), Math.cos(want.theta - cam.theta));
    cam.theta += dTheta * k;
    cam.phi += (want.phi - cam.phi) * k;
    cam.radius += (want.radius - cam.radius) * k;
    cam.target.lerp(want.target, k);
    placeCamera();

    time += dt;
    const pulse = .52 + Math.sin(time * 2.6) * .2;
    entries.forEach(e => {
      if (e.ring.visible) {
        e.ringMat.opacity = pulse;
        const rs = 1 + Math.sin(time * 2.6) * .035;
        e.ring.scale.setScalar(rs);
      }
      const targetScale = e.hovered ? 1.07 : 1;
      if (Math.abs(e.scale - targetScale) > .001) {
        e.scale += (targetScale - e.scale) * .2;
        e.group.scale.setScalar(e.scale * e.baseScale);
      }
    });

    renderer.render(scene, camera);
  }

  window.XWScene = {
    init: init,
    resize: resize,
    applyView: applyView,
    setMode: setMode,
    setHover: setHover,
    activeView: () => activeView
  };
})();
