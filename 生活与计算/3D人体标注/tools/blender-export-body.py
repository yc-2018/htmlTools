# -*- coding: utf-8 -*-
"""把 Blender 里的人体网格导成「3D人体标注」需要的 body.glb + body-regions.json。

用法（在 3D人体标注 目录下执行）：
    blender --background 人体.blend --python tools/blender-export-body.py -- --out assets

参数：
    --out DIR       输出目录，默认 assets
    --object NAME   指定网格对象；默认取场景里面数最多的那个网格
    --no-regions    只导 body.glb，不生成分区表
    --quiet         少打日志

前提：
  * 网格只能有一个材质，否则 glTF 会拆成多个 primitive，三角面顺序就和分区表对不上
  * 部位按顶点组（骨骼权重）划分，MakeHuman / MPFB2、Rigify、Mixamo 的骨骼名都认；
    一个顶点组都没有时只会得到一个躯干区，这种情况不如删掉 json，让页面按几何自动分区
  * 形变目标就是 Blender 的 Shape Key，名字要用 assets/README.md 里那套
  * 脚本不替你应用修改器（会连带丢掉 Shape Key），有修改器请自己先应用
"""

import base64
import json
import os
import struct
import sys

import bpy
from mathutils import Vector

WAIST = 0.616                      # 与 js/body-model.js 的 L.waist 保持一致
LIMB_AXES = {'aPos': '前面', 'aNeg': '后面', 'lPos': '外侧', 'lNeg': '内侧'}
HORIZ_AXES = {'aPos': '前面', 'aNeg': '后面', 'lPos': '上面', 'lNeg': '下面'}
MORPHS = ['female', 'fatUp', 'fatDown', 'bustUp', 'bustDown',
          'waistUp', 'waistDown', 'hipUp', 'hipDown', 'muscleUp']

TORSO = ('torso', 'torso', '躯干', '', {})

# 骨骼名关键词 → (区键, kind, 中文名, 附加字段)；从上往下匹配，先具体后笼统
RULES = [
    (('finger1', 'thumb'), 'thumb', 'finger', '拇指', {}),
    (('finger2', 'handindex', 'index'), 'index', 'finger', '食指', {}),
    (('finger3', 'handmiddle', 'middle'), 'middle', 'finger', '中指', {}),
    (('finger4', 'handring', 'ring'), 'ring', 'finger', '无名指', {}),
    (('finger5', 'handpinky', 'pinky', 'little'), 'little', 'finger', '小指', {}),
    (('metacarpal', 'palm', 'hand', 'wrist'), 'hand', 'palm', '手', {}),
    (('lowerarm', 'forearm'), 'forearm', 'limb', '前臂',
     {'t0': '靠近肘部', 't1': '靠近腕部'}),
    (('upperarm', 'upper_arm', 'arm'), 'upperarm', 'limb', '上臂',
     {'t0': '靠近肩部', 't1': '靠近肘部'}),
    (('toe',), 'toe', 'toe', '脚趾', {'noFacing': True}),
    (('foot',), 'foot', 'foot', '脚', {}),
    (('lowerleg', 'shin', 'calf'), 'shin', 'limb', '小腿',
     {'t0': '靠近膝部', 't1': '靠近脚踝'}),
    (('upperleg', 'thigh'), 'thigh', 'limb', '大腿',
     {'t0': '靠近大腿根部', 't1': '靠近膝部'}),
    (('neck',), 'neck', 'neck', '颈部', {}),
    (('head', 'jaw', 'skull', 'eye', 'oris', 'oculi', 'nasalis', 'risorius',
      'temporalis', 'levator', 'depressor', 'mentalis', 'buccinator',
      'tongue', 'teeth'), 'head', 'head', '头部', {}),
    (('breast', 'nipple'), 'breast', 'breast', '乳房', {}),
]

# 相邻两段之间补出来的关节区：(近端, 远端, 中文名, 方位词)
JOINTS = [
    ('upperarm', 'forearm', '肘',
     {'aPos': '肘窝(前面)', 'aNeg': '肘尖(后面)', 'lPos': '外侧', 'lNeg': '内侧'}),
    ('forearm', 'hand', '腕',
     {'aPos': '掌侧(手心一侧)', 'aNeg': '背侧(手背一侧)',
      'lPos': '拇指一侧', 'lNeg': '小指一侧'}),
    ('thigh', 'shin', '膝',
     {'aPos': '膝盖前面(髌骨)', 'aNeg': '膝后(腘窝)', 'lPos': '外侧', 'lNeg': '内侧'}),
    ('shin', 'foot', '踝',
     {'aPos': '踝前方', 'aNeg': '跟腱(后面)', 'lPos': '外踝', 'lNeg': '内踝'}),
]

# 输出顺序；躯干必须排第一，页面查不到面时拿它兜底
RANK = ['torso', 'head', 'neck', 'breast', 'upperarm', '肘', 'forearm', '腕',
        'hand', 'thumb', 'index', 'middle', 'ring', 'little',
        'thigh', '膝', 'shin', '踝', 'foot', 'toe']


def log(opt, *a):
    if not opt['quiet']:
        print('[body]', *a)


def die(msg):
    print('[body] 出错：' + msg)
    sys.exit(1)


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    opt = {'out': 'assets', 'object': None, 'regions': True, 'quiet': False}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--out' and i + 1 < len(argv):
            opt['out'] = argv[i + 1]; i += 2
        elif a == '--object' and i + 1 < len(argv):
            opt['object'] = argv[i + 1]; i += 2
        elif a == '--no-regions':
            opt['regions'] = False; i += 1
        elif a == '--quiet':
            opt['quiet'] = True; i += 1
        else:
            i += 1
    return opt
def side_of(n):
    if n.endswith('.l') or n.endswith('_l') or '.l.' in n or 'left' in n:
        return '左'
    if n.endswith('.r') or n.endswith('_r') or '.r.' in n or 'right' in n:
        return '右'
    return ''


def match(raw):
    """顶点组名 → (区键, kind, 中文名, 左右, 附加字段)"""
    n = raw.lower().replace('mixamorig:', '').replace(' ', '')
    s = side_of(n)
    for pats, key, kind, name, extra in RULES:
        for p in pats:
            if p in n:
                return (key + s, kind, s + name, s, extra)
    return TORSO


def pick_mesh(name):
    if name:
        o = bpy.data.objects.get(name)
        if not o or o.type != 'MESH':
            die('找不到网格对象：' + name)
        return o
    best = None
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and (not best or len(o.data.polygons) > len(best.data.polygons)):
            best = o
    if not best:
        die('场景里没有网格对象')
    return best


def read_mesh(obj):
    """三角面顶点索引 + 顶点坐标（已转成运行时那套坐标系并按身高归一化）"""
    me = obj.data
    me.calc_loop_triangles()
    mw = obj.matrix_world
    vs = []
    for v in me.vertices:
        p = mw @ v.co
        vs.append(Vector((p.x, p.z, -p.y)))       # Blender Z 朝上 → glTF Y 朝上
    tris = [tuple(t.vertices) for t in me.loop_triangles]
    return tris, vs, normalize(vs)


def normalize(vs):
    """左右居中、脚落到 y=0、按腰部横截面找中轴，然后整体除以身高"""
    xs = [v.x for v in vs]
    cx = (min(xs) + max(xs)) / 2.0
    y0 = min(v.y for v in vs)
    for v in vs:
        v.x -= cx
        v.y -= y0
    H = max(v.y for v in vs)
    lo, hi = 1e9, -1e9
    for v in vs:
        if abs(v.y / H - WAIST) > 0.03 or abs(v.x) > H * 0.06:
            continue
        lo = min(lo, v.z)
        hi = max(hi, v.z)
    cz = 0.0 if lo > hi else (lo + hi) / 2.0
    for v in vs:
        v.z -= cz
        v /= H
    return H
def assign(obj, tris):
    """每个三角面归到一个区键：顶点取权重最大的顶点组，面取三个顶点里的多数"""
    gk = dict((g.index, match(g.name)) for g in obj.vertex_groups)
    wv = []
    for v in obj.data.vertices:
        acc = {}
        for g in v.groups:
            k = gk.get(g.group)
            if k:
                acc[k] = acc.get(k, 0.0) + g.weight
        best, bw = TORSO, 0.0
        for k, w in acc.items():
            if w > bw:
                best, bw = k, w
        wv.append(best)
    fk = []
    for t in tris:
        a, b, c = wv[t[0]], wv[t[1]], wv[t[2]]
        fk.append(a if (a == b or a == c) else (b if b == c else a))
    return fk


def centroids(tris, vs):
    out = []
    for t in tris:
        out.append((vs[t[0]] + vs[t[1]] + vs[t[2]]) / 3.0)
    return out


def members(fk, key):
    return [i for i, k in enumerate(fk) if k[0] == key]


def axis_of(pts):
    """两趟最远点法求主轴端点，比 PCA 省事且够用"""
    m = mean_of(pts)
    p1 = max(pts, key=lambda p: (p - m).length_squared)
    p2 = max(pts, key=lambda p: (p - p1).length_squared)
    return p1.copy(), p2.copy()


def limb_frame(d, s):
    """肢体的前后 / 侧向参考轴；轴向偏水平时侧向词换成上下（和 mesh-model.js 一致）"""
    d = d.normalized()
    a = Vector((0, 0, 1)) - d * d.z
    if a.length_squared < 0.01:
        a = Vector((0, 1, 0)) - d * d.y
    a.normalize()
    l = d.cross(a).normalized()
    horiz = abs(d.y) < 0.5
    if (l.y < 0) if horiz else (l.x * (s or 1) < 0):
        l = -l
    return a, l, (HORIZ_AXES if horiz else LIMB_AXES)
def carve(fk, cen, prox, dist, name, axes, side, band=0.085):
    """把两段交界处的一圈面单独拿出来当关节区"""
    ia, ib = members(fk, prox), members(fk, dist)
    if len(ia) < 24 or len(ib) < 24:
        return
    p1, p2 = axis_of([cen[i] for i in ia + ib])
    d = p2 - p1
    ln = d.length
    if ln < 1e-6:
        return
    d /= ln

    def t(i):
        return (cen[i] - p1).dot(d) / ln

    star = (sum(t(i) for i in ia) / len(ia) + sum(t(i) for i in ib) / len(ib)) / 2.0
    hit = [i for i in ia + ib if abs(t(i) - star) < band]
    if len(hit) < 12:
        return
    meta = (name + side, 'blob', side + name, side, {'axes': axes, '_dir': d.copy()})
    for i in hit:
        fk[i] = meta


def split_foot(fk, cen, side):
    """脚分成前脚掌和后脚跟两块，描述能精确到脚跟 / 足弓"""
    idx = members(fk, 'foot' + side)
    if len(idx) < 40:
        return
    zs = sum(cen[i].z for i in idx) / len(idx)
    rear = ('footrear' + side, 'foot', side + '脚', side, {'zone': 'rear'})
    fore = ('footfore' + side, 'foot', side + '脚', side, {'zone': 'fore'})
    for i in idx:
        fk[i] = fore if cen[i].z >= zs else rear


def rank(key):
    for i, r in enumerate(RANK):
        if key.startswith(r):
            return i
    return len(RANK)


def vec(p):
    return [round(p.x, 5), round(p.y, 5), round(p.z, 5)]


def palm_frame(pts, m, d, s, thumb):
    """手是扁的：薄的那个方向就是掌面法线，掌心朝身体中线一侧"""
    a, l, _ = limb_frame(d, s)
    span = lambda u: max((p - m).dot(u) for p in pts) - min((p - m).dot(u) for p in pts)
    n = a if span(a) <= span(l) else l
    if n.x * (s or 1) > 0:
        n = -n
    t = None
    if thumb is not None:
        t = thumb - m
        t -= n * t.dot(n)
        t -= d * t.dot(d)
    if t is None or t.length < 1e-6:
        t = d.cross(n)
        if t.z < 0:
            t = -t
    return n.normalized(), t.normalized()
def geom(meta, pts, torso_c, thumb):
    """按 kind 反填一个区需要的坐标与参考轴，长度都已按身高归一化"""
    key, kind, name, side, extra = meta
    s = 1 if side == '左' else (-1 if side == '右' else 0)
    r = {'kind': kind, 'name': name}
    if side:
        r['side'] = side
    for k, v in extra.items():
        if not k.startswith('_'):
            r[k] = v
    m = mean_of(pts)
    d = extra.get('_dir')

    if kind in ('limb', 'finger', 'toe', 'neck'):
        p1, p2 = axis_of(pts)
        if (p1 - torso_c).length > (p2 - torso_c).length:
            p1, p2 = p2, p1
        r['from'], r['to'] = vec(p1), vec(p2)
        if kind in ('finger', 'toe'):
            r['tip'] = vec(p2)
        d = p2 - p1
    elif kind == 'head':
        r['center'] = vec(m)
        r['chin'] = round(min(p.y for p in pts), 5)
        r['top'] = 1.0
        r['half'] = round((r['top'] - r['chin']) * 0.5, 5)
        return r
    elif kind == 'torso':
        r['center'] = vec(m)
        return r
    else:
        r['center'] = vec(m)
        if kind == 'foot':
            zs = [p.z for p in pts]
            r['zSpan'] = round(max((max(zs) - min(zs)) * 0.5, 0.008), 5)
            d = Vector((0, -1, 0))
        elif kind == 'palm':
            p1, p2 = axis_of(pts)
            a, l = palm_frame(pts, m, (p2 - p1).normalized(), s, thumb)
            r['aVec'], r['lVec'] = vec(a), vec(l)
            return r
        elif kind == 'breast':
            r['aVec'], r['lVec'] = [0, 0, 1], [s or 1, 0, 0]
            return r

    if d is None or d.length < 1e-9:
        d = Vector((0, -1, 0))
    a, l, ax = limb_frame(d, s)
    r['aVec'], r['lVec'] = vec(a), vec(l)
    axes = extra.get('axes')
    if axes and ax is HORIZ_AXES:
        # 轴向偏水平时侧向词要让给参考轴，和 mesh-model.js 的 segAxes 一致
        axes = {'aPos': axes['aPos'], 'aNeg': axes['aNeg'],
                'lPos': ax['lPos'], 'lNeg': ax['lNeg']}
    r['axes'] = axes or ax
    return r
def export_glb(path, obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    want = {
        'filepath': path, 'export_format': 'GLB', 'use_selection': True,
        'export_yup': True, 'export_apply': False, 'export_morph': True,
        'export_skins': False, 'export_animations': False, 'export_cameras': False,
        'export_lights': False, 'export_texcoords': False, 'export_normals': True,
        'export_materials': 'NONE',
    }
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kw = dict((k, v) for k, v in want.items() if k in props)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        kw.pop('export_materials', None)     # 老版本这个参数是布尔值
        bpy.ops.export_scene.gltf(**kw)


COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2),
        5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NUM = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    total = struct.unpack_from('<I', data, 8)[0]
    off, js, bin_ = 12, None, None
    while off + 8 <= total:
        clen, ctype = struct.unpack_from('<II', data, off)
        chunk = data[off + 8:off + 8 + clen]
        off += 8 + clen
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            bin_ = chunk
    return js, bin_


def accessor(js, bin_, i):
    acc = js['accessors'][i]
    n = NUM[acc['type']]
    fmt, size = COMP[acc['componentType']]
    bv = js['bufferViews'][acc['bufferView']]
    base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = bv.get('byteStride') or n * size
    out = []
    for k in range(acc['count']):
        out.append(struct.unpack_from('<' + fmt * n, bin_, base + k * stride))
    return out
def perim(q):
    return ((q[1] - q[0]).length + (q[2] - q[1]).length + (q[0] - q[2]).length)


def verify(path, tris, vs):
    """回读 GLB，确认三角面顺序和脚本这边一致；周长比值对得上就说明没被重排"""
    js, bin_ = read_glb(path)
    if not js or not bin_:
        return '读不回导出的 GLB'
    prims = js['meshes'][0]['primitives']
    if len(prims) != 1:
        return 'GLB 里有 %d 个 primitive（材质不止一个？），面的顺序会和分区表错开' % len(prims)
    p = prims[0]
    pos = accessor(js, bin_, p['attributes']['POSITION'])
    if 'indices' in p:
        idx = [v[0] for v in accessor(js, bin_, p['indices'])]
    else:
        idx = list(range(len(pos)))
    n = len(idx) // 3
    if n != len(tris):
        return '面数不一致：GLB %d，脚本 %d' % (n, len(tris))
    step = max(1, n // 200)
    ratio = None
    for t in range(0, n, step):
        a = perim([Vector(pos[idx[t * 3 + k]]) for k in range(3)])
        b = perim([vs[i] for i in tris[t]])
        if a < 1e-9 or b < 1e-9:
            continue
        if ratio is None:
            ratio = a / b
        elif abs(a / b - ratio) > ratio * 0.02:
            return '三角面顺序和导出结果对不上（第 %d 个面）' % t
    return ''
def mean_of(pts):
    m = Vector((0, 0, 0))
    for p in pts:
        m += p
    return m / max(1, len(pts))


def make_regions(obj, tris, vs, opt):
    """顶点组 → 分区表；返回 (regions, 每面区号)"""
    fk = assign(obj, tris)
    cen = centroids(tris, vs)
    for side in ('左', '右', ''):
        for prox, dist, name, axes in JOINTS:
            carve(fk, cen, prox + side, dist + side, name, axes, side)
        split_foot(fk, cen, side)

    metas = {}
    for m in fk:
        metas.setdefault(m[0], m)
    metas.setdefault('torso', TORSO)
    order = sorted(metas.keys(), key=lambda k: (rank(k), k))
    ids = dict((k, i) for i, k in enumerate(order))
    pts = dict((k, []) for k in order)
    for i, m in enumerate(fk):
        pts[m[0]].append(cen[i])

    torso_c = mean_of(pts['torso']) if pts['torso'] else Vector((0, WAIST, 0))
    thumb = {}
    for side in ('左', '右', ''):
        p = pts.get('thumb' + side)
        thumb[side] = mean_of(p) if p else None

    regions = []
    for k in order:
        m = metas[k]
        r = geom(m, pts[k] or [torso_c], torso_c, thumb.get(m[3]))
        r['id'] = ids[k]
        regions.append(r)
        log(opt, '  %-9s %-14s %6d 面' % (r['kind'], r['name'], len(pts[k])))
    return regions, [ids[m[0]] for m in fk]
def main():
    opt = parse_args()
    obj = pick_mesh(opt['object'])
    out = bpy.path.abspath(opt['out'])
    if not os.path.isdir(out):
        os.makedirs(out)

    mats = [m for m in obj.data.materials if m]
    if len(mats) > 1:
        log(opt, '警告：网格有 %d 个材质，glTF 会拆成多个 primitive，'
                 '分区表会失效，请先合并成一个' % len(mats))
    mods = [m.name for m in obj.modifiers if m.show_viewport]
    if mods:
        log(opt, '警告：网格上有修改器（%s），导出不会应用，'
                 '需要的话请自己先应用' % '、'.join(mods))

    tris, vs, H = read_mesh(obj)
    log(opt, '网格 %s：顶点 %d，三角面 %d，身高约 %.1f cm'
        % (obj.name, len(vs), len(tris), H * 100 if H < 3 else H))

    sk = obj.data.shape_keys
    names = [b.name for b in sk.key_blocks][1:] if sk else []
    if names:
        known = [n for n in names if n in MORPHS]
        log(opt, '形变目标 %d 个，认得的 %d 个：%s'
            % (len(names), len(known), '、'.join(known) or '无'))
        for n in names:
            if n not in MORPHS:
                log(opt, '  用不上的形变目标：' + n)
    else:
        log(opt, '没有形变目标：体重和三围滑块只会改描述，不会改外形')

    glb = os.path.join(out, 'body.glb')
    export_glb(glb, obj)
    log(opt, '已写出 ' + glb)
    if not opt['regions']:
        return

    bad = verify(glb, tris, vs)
    if bad:
        log(opt, '不生成分区表：' + bad)
        log(opt, '页面仍可用这个 GLB，会退回按几何自动分区')
        return

    log(opt, '分区结果：')
    regions, faces = make_regions(obj, tris, vs, opt)
    data = {'version': 1, 'rotateY': 0, 'regions': regions, 'triangles': len(faces)}
    if len(regions) > 255:
        data['faces'] = faces
    else:
        data['facesB64'] = base64.b64encode(bytes(bytearray(faces))).decode('ascii')
    spec = os.path.join(out, 'body-regions.json')
    with open(spec, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    log(opt, '已写出 %s（%d 个区）' % (spec, len(regions)))


if __name__ == '__main__':
    main()
