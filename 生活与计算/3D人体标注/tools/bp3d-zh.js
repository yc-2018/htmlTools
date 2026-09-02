/* bp3d-zh.js —— BodyParts3D 的英文名 → 中文名（只给自动展开的骨头用，器官都在 bp3d-parts.js 里手写）
 * 打包时用，网页不加载。译不出来的会原样留着并在构建日志里报出来，方便补词。 */
'use strict';

const ORD = {
  first: '第1', second: '第2', third: '第3', fourth: '第4', fifth: '第5', sixth: '第6',
  seventh: '第7', eighth: '第8', ninth: '第9', tenth: '第10', eleventh: '第11', twelfth: '第12'
};

/* 名词表：键是去掉左右和序数之后的英文名 */
const N = {
  'rib': '肋骨', 'cervical vertebra': '颈椎', 'thoracic vertebra': '胸椎', 'lumbar vertebra': '腰椎',
  'sacrum': '骶骨', 'coccyx': '尾骨', 'atlas': '寰椎(第1颈椎)', 'axis': '枢椎(第2颈椎)',
  'sternum': '胸骨', 'clavicle': '锁骨', 'scapula': '肩胛骨', 'humerus': '肱骨',
  'radius': '桡骨', 'ulna': '尺骨', 'hip bone': '髋骨', 'femur': '股骨', 'patella': '髌骨',
  'tibia': '胫骨', 'fibula': '腓骨',
  'frontal bone': '额骨', 'parietal bone': '顶骨', 'occipital bone': '枕骨',
  'temporal bone': '颞骨', 'sphenoid bone': '蝶骨', 'ethmoid': '筛骨', 'vomer': '犁骨',
  'maxilla': '上颌骨', 'mandible': '下颌骨', 'zygomatic bone': '颧骨', 'nasal bone': '鼻骨',
  'lacrimal bone': '泪骨', 'palatine bone': '腭骨', 'inferior nasal concha': '下鼻甲',
  'hyoid bone': '舌骨',
  'scaphoid': '手舟骨', 'lunate': '月骨', 'triquetral': '三角骨', 'pisiform': '豌豆骨',
  'trapezium': '大多角骨', 'trapezoid': '小多角骨', 'capitate': '头状骨', 'hamate': '钩骨',
  'talus': '距骨', 'calcaneus': '跟骨', 'cuboid bone': '骰骨',
  'medial cuneiform bone': '内侧楔骨', 'intermediate cuneiform bone': '中间楔骨',
  'lateral cuneiform bone': '外侧楔骨', 'navicular bone': '足舟骨', 'sesamoid bone': '籽骨',
  'metacarpal bone': '掌骨', 'metatarsal bone': '跖骨'
};

const FIN = {
  thumb: '拇指', 'index finger': '食指', 'middle finger': '中指',
  'ring finger': '无名指', 'little finger': '小指',
  'big toe': '大脚趾', 'second toe': '第2趾', 'third toe': '第3趾',
  'fourth toe': '第4趾', 'little toe': '小脚趾'
};
const SEG = { proximal: '近节', middle: '中节', distal: '末节' };

/** 英文名 → { cn, side }，side 是 '左'/'右'/''  */
function zh(en) {
  let s = (en || '').toLowerCase().trim(), side = '';
  s = s.replace(/\b(left|right)\b/g, function (m) {
    side = m === 'left' ? '左' : '右';
    return ' ';
  }).replace(/\s+/g, ' ').trim();

  // 指/趾骨：proximal phalanx of index finger → 食指近节指骨
  let m = /^(proximal|middle|distal) phalanx of (.+)$/.exec(s);
  if (m && FIN[m[2]]) {
    const toe = /toe/.test(m[2]);
    return { cn: FIN[m[2]] + SEG[m[1]] + (toe ? '趾骨' : '指骨'), side: side };
  }
  // 序数 + 名词：eighth rib → 第8肋骨
  let ord = '';
  m = /^(\w+) (.+)$/.exec(s);
  if (m && ORD[m[1]]) { ord = ORD[m[1]]; s = m[2]; }
  s = s.replace(/ of (foot|hand)$/, '');
  const base = N[s];
  return { cn: base ? ord + base : (ord + s), side: side, miss: !base };
}

/* 肺段名（bp3d-parts.js 里 zh:'seg' 的那条自动展开用）。
   括号里的 S 号是临床上写片子的编号，方便和 CT 报告对上。 */
const SEGN = {
  'apical': '肺尖段(S1)', 'posterior': '肺后段(S2)', 'anterior': '肺前段(S3)',
  'medial': '肺内侧段(S4)', 'lateral': '肺外侧段(S5)',
  'superior': '肺背段(S6)', 'medial basal': '肺内底段(S7)',
  'anterior basal': '肺前底段(S8)', 'lateral basal': '肺外底段(S9)',
  'posterior basal': '肺后底段(S10)',
  'apicoposterior': '肺尖后段(S1+2)',
  'superior lingular': '肺上舌段(S4)', 'inferior lingular': '肺下舌段(S5)'
};

/** 肺段英文名 → { cn, side }；side 取不到时用 hint（左右中叶那两段名字里不带 left/right） */
function seg(en, hint) {
  let s = (en || '').toLowerCase().trim(), side = hint || '';
  s = s.replace(/\b(left|right)\b/g, function (m) {
    side = m === 'left' ? '左' : '右';
    return ' ';
  }).replace(/\bbronchopulmonary segment\b/, ' ').replace(/\s+/g, ' ').trim();
  const base = SEGN[s];
  return { cn: base || s, side: side, miss: !base };
}

module.exports = { zh: zh, seg: seg, N: N };
