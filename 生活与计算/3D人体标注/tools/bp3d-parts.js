/* bp3d-parts.js —— 人工对照表：BodyParts3D 的概念 → 内部页的图层 / 涂层级别 / 中文名
 * 打包时用（node tools/bp3d-build.js），网页不加载。
 *
 * 每个 system 的 levels 是这一层从外到内的级名，parts 里：
 *   id   概念编号（FMA…），一件可以给多个编号，几何会合并
 *   m    改用「肌肉本名」匹配（BodyParts3D 把大肌肉拆成 zone/head/part，按本名归拢更省事）
 *   cn   中文名；auto 展开的骨头由 bp3d-zh.js 翻
 *   lv   属于第几级（0 是最外面）   to  剥到第几级为止还留着（默认 99 = 一直留着）
 *   tri  这一件的三角上限，超了就用顶点聚类简化
 * 同一件被更细的概念覆盖到的部件会自动归给更细那件，不会重复打包。
 */
'use strict';

/* 血管网、筋膜、眼球、皮肤这些不进内部页（用户明确说血管和神经网不要）；
   但下面 parts 里点名要的大血管主干会保留——判断依据是「这件本身就整个落在被丢弃的概念里」。 */
const DROP = [
  'FMA45621', 'FMA45623', 'FMA45626', 'FMA45628', 'FMA45842', 'FMA45847',
  'FMA49894', 'FMA228642', 'FMA79063', 'FMA9908', 'FMA7163', 'FMA72979',
  'FMA54449', 'FMA54450', 'FMA58401', 'FMA58418', 'FMA58419', 'FMA50863'
];

/** 中轴骨和颅骨剥到第 1 级还留着，四肢骨剥一层就没了 */
const AXIAL = /rib|vertebra|atlas|axis|sacrum|hyoid|frontal|parietal|occipital|temporal|sphenoid|ethmoid|vomer|maxilla|mandible|zygomatic|nasal|lacrimal|palatine|concha/;

const SYSTEMS = [
  {
    sys: 'bone', levels: ['全身骨骼', '中轴骨与颅骨'],
    parts: [
      { auto: 'leaf', roots: ['FMA5018'], tri: 2600, axial: AXIAL },
      { id: 'FMA7485', cn: '胸骨', lv: 0, to: 1, tri: 3000, note: '胸前正中的长条骨，心肺就在它后面' },
      { id: 'FMA7591', cn: '肋软骨', lv: 0, to: 1, tri: 4000, note: '肋骨前端接到胸骨的软骨段' },
      { id: 'FMA25511', cn: '椎间盘', lv: 0, to: 1, tri: 3000, note: '相邻椎体之间的软垫' }
    ]
  },
  {
    sys: 'heart', levels: ['心脏外形', '四腔与瓣膜', '心腔与纤维环'],
    parts: [
      { id: 'FMA73703', cn: '右心壁', lv: 0, to: 0, tri: 9000, note: '心脏右半边的心壁，接收全身回来的血' },
      { id: 'FMA73704', cn: '左心壁', lv: 0, to: 0, tri: 9000, note: '心脏左半边的心壁，把血泵向全身' },
      { id: 'FMA3736', cn: '升主动脉', lv: 0, to: 2, tri: 900, note: '左心室出口，全身供血的起点' },
      { id: 'FMA3768', cn: '主动脉弓', lv: 0, to: 2, tri: 900 },
      { id: 'FMA8612', cn: '肺动脉干', lv: 0, to: 2, tri: 1400, note: '右心室出口，把血送去肺里换气' },
      { id: 'FMA4720', cn: '上腔静脉', lv: 0, to: 2, tri: 900 },
      { id: 'FMA10951', cn: '下腔静脉', lv: 0, to: 2, tri: 2000 },
      { id: 'FMA7096', cn: '右心房', lv: 1, to: 1, tri: 7000, note: '上下腔静脉的血先进这里' },
      { id: 'FMA7098', cn: '右心室', lv: 1, to: 1, tri: 7000, note: '把血泵进肺动脉' },
      { id: 'FMA7097', cn: '左心房', lv: 1, to: 1, tri: 5000, note: '接肺里回来的含氧血' },
      { id: 'FMA7101', cn: '左心室', lv: 1, to: 1, tri: 7000, note: '心壁最厚的一腔，负责全身供血' },
      { id: 'FMA7234', cn: '三尖瓣', lv: 1, to: 2, tri: 4000, note: '右心房通右心室的门' },
      { id: 'FMA7235', cn: '二尖瓣', lv: 1, to: 2, tri: 4000, note: '左心房通左心室的门' },
      { id: 'FMA7236', cn: '主动脉瓣', lv: 1, to: 2, tri: 2200 },
      { id: 'FMA7246', cn: '肺动脉瓣', lv: 1, to: 2, tri: 2200 },
      { id: 'FMA11359', cn: '右心房腔', lv: 2, tri: 2300, note: '腔内铸型：血实际待的空间' },
      { id: 'FMA9291', cn: '右心室腔', lv: 2, tri: 2000 },
      { id: 'FMA9465', cn: '左心房腔', lv: 2, tri: 1100 },
      { id: 'FMA9466', cn: '左心室腔', lv: 2, tri: 1800 },
      { id: 'FMA9496', cn: '心脏纤维环', lv: 2, tri: 5000, note: '四个瓣膜的骨架，把心房心肌和心室心肌隔开' }
    ]
  },
  {
    sys: 'resp', levels: ['肺与气道', '肺段与支气管', '支气管树'],
    parts: [
      { id: 'FMA46472', cn: '鼻', lv: 0, to: 1, tri: 3000, note: '空气进出的第一道，里面有鼻腔和鼻甲' },
      { id: 'FMA7394', cn: '气管', lv: 0, to: 2, tri: 3000, note: '颈前正中那根管，下端分成左右主支气管' },
      { id: 'FMA13295', cn: '膈肌', lv: 0, to: 2, tri: 9000, note: '胸腔和腹腔之间的顶棚，吸气时往下压' },
      { id: 'FMA7333', cn: '右肺上叶', lv: 0, to: 0, tri: 6000 },
      { id: 'FMA7383', cn: '右肺中叶', lv: 0, to: 0, tri: 4500, note: '只有右肺有中叶' },
      { id: 'FMA7337', cn: '右肺下叶', lv: 0, to: 0, tri: 7000 },
      { id: 'FMA7370', cn: '左肺上叶', lv: 0, to: 0, tri: 6000, note: '左肺只有两叶，给心脏让了位置' },
      { id: 'FMA7371', cn: '左肺下叶', lv: 0, to: 0, tri: 6000 },
      { id: 'FMA26661', cn: '右侧支气管树', lv: 1, to: 2, keep: 1, tri: 14000, note: '主支气管往下一级级分叉，一直分到肺段' },
      { id: 'FMA26662', cn: '左侧支气管树', lv: 1, to: 2, keep: 1, tri: 10000 },
      { auto: 'leaf', roots: ['FMA7333', 'FMA7383', 'FMA7337', 'FMA7370', 'FMA7371'], lv: 1, to: 1, tri: 2600, only: /bronchopulmonary segment/, zh: 'seg' }
    ]
  },
  {
    sys: 'dig', levels: ['器官外形', '管腔与胆道'],
    parts: [
      { id: 'FMA54640', cn: '舌', lv: 0, to: 0, tri: 600 },
      { id: 'FMA7131', cn: '食管', lv: 0, to: 1, tri: 700, note: '从咽到胃的一根管，穿过膈肌' },
      { id: 'FMA7148', cn: '胃', lv: 0, to: 0, tri: 2000, note: '左上腹，贴着膈肌下面' },
      { id: 'FMA13362', cn: '肝右叶', lv: 0, to: 0, tri: 12000, note: '右上腹最大的实质器官，肋骨下缘藏着它' },
      { id: 'FMA13363', cn: '肝左叶', lv: 0, to: 0, tri: 14000 },
      { id: 'FMA7202', cn: '胆囊', lv: 0, to: 1, tri: 2400, note: '贴在肝下面存胆汁，右上腹痛常和它有关' },
      { id: 'FMA7198', cn: '胰', lv: 0, to: 0, tri: 8000, note: '横在胃后面，既出消化酶也出胰岛素' },
      { id: 'FMA7206', cn: '十二指肠', lv: 0, to: 0, tri: 1900, note: '胃出口接的一段，胆汁和胰液在这里汇入' },
      { id: 'FMA7207', cn: '空肠', lv: 0, to: 0, tri: 6000 },
      { id: 'FMA7208', cn: '回肠', lv: 0, to: 0, tri: 8000 },
      { id: 'FMA14541', cn: '盲肠', lv: 0, to: 0, tri: 400 },
      { id: 'FMA14542', cn: '阑尾', lv: 0, to: 1, tri: 500, note: '右下腹，发炎就是阑尾炎' },
      { id: 'FMA14545', cn: '升结肠', lv: 0, to: 0, tri: 3300 },
      { id: 'FMA14546', cn: '横结肠', lv: 0, to: 0, tri: 3500 },
      { id: 'FMA14547', cn: '降结肠', lv: 0, to: 0, tri: 5500 },
      { id: 'FMA14544', cn: '直肠', lv: 0, to: 0, tri: 2100 },
      { id: 'FMA14665', cn: '胆道', lv: 1, to: 1, tri: 9000, note: '肝内外的胆管汇成一路通到十二指肠' },
      { id: 'FMA10419', cn: '胰管', lv: 1, to: 1, tri: 3000 }
    ]
  },
  {
    sys: 'urin', levels: ['器官外形'],
    parts: [
      { id: 'FMA7204', cn: '右肾', lv: 0, tri: 2400, note: '在腰部脊柱两侧、肋骨下方，比左肾略低' },
      { id: 'FMA7205', cn: '左肾', lv: 0, tri: 3000 },
      { id: 'FMA15571', cn: '右输尿管', lv: 0, tri: 2000, note: '从肾往下到膀胱，结石卡住会一阵一阵剧痛' },
      { id: 'FMA15572', cn: '左输尿管', lv: 0, tri: 2100 },
      { id: 'FMA15900', cn: '膀胱', lv: 0, tri: 300, note: '盆腔前下方，装满了就有尿意' },
      { id: 'FMA19667', cn: '尿道', lv: 0, tri: 500 }
    ]
  },
  {
    sys: 'repro', levels: ['器官外形'],
    parts: [
      { id: 'FMA9600', cn: '前列腺', lv: 0, tri: 500, note: '包着尿道起始段，增大会影响排尿' },
      { id: 'FMA7210', cn: '睾丸', lv: 0, tri: 500 },
      { id: 'FMA18255', cn: '附睾', lv: 0, tri: 400 },
      { id: 'FMA19386', cn: '精囊', lv: 0, tri: 800 }
    ]
  },
  {
    sys: 'endo', levels: ['腺体'],
    parts: [
      { id: 'FMA13889', cn: '垂体', lv: 0, tri: 1200, note: '挂在脑底部的小腺体，管着别的腺体' },
      { id: 'FMA15629', cn: '右肾上腺', lv: 0, tri: 2300, note: '压在肾的上端，出应激激素' },
      { id: 'FMA15630', cn: '左肾上腺', lv: 0, tri: 3000 },
      { id: 'FMA9607', cn: '胸腺', lv: 0, tri: 2100, note: '胸骨后方，小时候大、成年后缩小' }
    ]
  },
  {
    sys: 'nerve', levels: ['脑外形', '脑干与深部', '脑室系统'],
    parts: [
      { id: 'FMA67292', cn: '右大脑半球', lv: 0, to: 0, tri: 26000, note: '沟和回都是真的，来自 BodyParts3D 的实测数据' },
      { id: 'FMA61819', cn: '左大脑半球', lv: 0, to: 0, tri: 26000 },
      { id: 'FMA67944', cn: '小脑', lv: 0, to: 1, tri: 14000, note: '后下方那团，管平衡和动作的精细协调' },
      { id: 'FMA79876', cn: '脑干', lv: 0, to: 1, tri: 12000, note: '中脑+脑桥+延髓，呼吸心跳的中枢在这里' },
      { id: 'FMA7647', cn: '脊髓', lv: 0, to: 2, tri: 800, note: '在椎管里，从枕骨大孔一直到腰1附近' },
      { id: 'FMA86464', cn: '胼胝体', lv: 1, to: 1, tri: 8000, note: '连接左右半球的纤维板' },
      { id: 'FMA62007', cn: '丘脑', lv: 1, to: 1, tri: 2500, note: '感觉信息进大脑前的中转站' },
      { id: 'FMA62008', cn: '下丘脑', lv: 1, to: 1, tri: 4000, note: '管体温、饥饱、睡眠和内分泌' },
      { id: 'FMA78448', cn: '侧脑室', lv: 2, tri: 9000, note: '脑脊液待的空腔，左右各一个' },
      { id: 'FMA78454', cn: '第三脑室', lv: 2, tri: 3000 },
      { id: 'FMA78469', cn: '第四脑室', lv: 2, tri: 3500 },
      { id: 'FMA78467', cn: '中脑水管', lv: 2, tri: 500, note: '连着三、四脑室的细管，堵了会积水' }
    ]
  },
  {
    sys: 'lymph', levels: ['脾'],
    parts: [
      { id: 'FMA7196', cn: '脾', lv: 0, tri: 1400, note: '左上腹肋骨下面，外伤容易破' }
    ]
  },
  {
    /* 肌肉：BodyParts3D 把大肌肉拆成 zone/head/part，这里按「肌肉本名」归拢，左右自动分开。
       浅层是一眼能摸到的那些（to:0，剥一层就没），深层在第 1 级才露出来。
       数据集里没有背阔肌、腹直肌、咬肌、竖脊肌总称这几块，页面会用程序化的补上。 */
    sys: 'muscle', levels: ['浅层肌', '深层肌'],
    parts: [
      { m: 'pectoralis major', cn: '胸大肌', lv: 0, to: 0, tri: 4000, note: '胸前最外一层，手往前推靠它' },
      { m: 'deltoid', cn: '三角肌', lv: 0, to: 0, tri: 4000, note: '肩膀那块，抬手臂靠它' },
      { m: 'trapezius', cn: '斜方肌', lv: 0, to: 0, tri: 4000, note: '脖子到肩背这一片，久坐酸的就是它' },
      { m: 'sternocleidomastoid', cn: '胸锁乳突肌', lv: 0, to: 0, tri: 3500, note: '转头时颈侧鼓起的那条' },
      { m: 'platysma', cn: '颈阔肌', lv: 0, to: 0, tri: 3500 },
      { m: 'external oblique', cn: '腹外斜肌', lv: 0, to: 0, tri: 7000, note: '腰侧那层，扭腰靠它' },
      { m: 'serratus anterior', cn: '前锯肌', lv: 0, to: 0, tri: 5000, note: '肋侧像锯齿一样的一片' },
      { m: 'biceps brachii', cn: '肱二头肌', lv: 0, to: 0, tri: 3000, note: '上臂前面，屈肘时鼓的那块' },
      { m: 'triceps brachii', cn: '肱三头肌', lv: 0, to: 0, tri: 3500, note: '上臂后面，伸肘靠它' },
      { m: 'brachioradialis', cn: '肱桡肌', lv: 0, to: 0, tri: 3000 },
      { m: 'flexor carpi ulnaris', cn: '尺侧腕屈肌', lv: 0, to: 0, tri: 3000 },
      { m: 'flexor carpi radialis', cn: '桡侧腕屈肌', lv: 0, to: 0, tri: 2200 },
      { m: 'extensor digitorum', cn: '指伸肌', lv: 0, to: 0, tri: 3000 },
      { m: 'palmaris longus', cn: '掌长肌', lv: 0, to: 0, tri: 3000 },
      { m: 'gluteus maximus', cn: '臀大肌', lv: 0, to: 0, tri: 3000, note: '最大的一块臀肌，站起来和上楼靠它' },
      { m: 'tensor fasciae latae', cn: '阔筋膜张肌', lv: 0, to: 0, tri: 2500 },
      { m: 'rectus femoris', cn: '股直肌', lv: 0, to: 0, tri: 4000, note: '大腿前面正中，伸膝主力' },
      { m: 'vastus lateralis', cn: '股外侧肌', lv: 0, to: 0, tri: 4500 },
      { m: 'vastus medialis', cn: '股内侧肌', lv: 0, to: 0, tri: 3500 },
      { m: 'sartorius', cn: '缝匠肌', lv: 0, to: 0, tri: 2800, note: '大腿前面斜着走的一长条' },
      { m: 'gracilis', cn: '股薄肌', lv: 0, to: 0, tri: 2600 },
      { m: 'adductor longus', cn: '长收肌', lv: 0, to: 0, tri: 2400 },
      { m: 'biceps femoris', cn: '股二头肌', lv: 0, to: 0, tri: 4000, note: '大腿后侧，拉伸不够容易紧' },
      { m: 'semitendinosus', cn: '半腱肌', lv: 0, to: 0, tri: 2600 },
      { m: 'semimembranosus', cn: '半膜肌', lv: 0, to: 0, tri: 3200 },
      { m: 'gastrocnemius', cn: '腓肠肌', lv: 0, to: 0, tri: 4000, note: '小腿后面鼓起的那两块，抽筋常抽它' },
      { m: 'tibialis anterior', cn: '胫骨前肌', lv: 0, to: 0, tri: 2600 },
      { m: 'fibularis longus', cn: '腓骨长肌', lv: 0, to: 0, tri: 3000 },
      { m: 'extensor digitorum longus', cn: '趾长伸肌', lv: 0, to: 0, tri: 3000 },

      { m: 'pectoralis minor', cn: '胸小肌', lv: 1, tri: 2600, note: '胸大肌底下那层，从肋骨拉到肩' },
      { m: 'external intercostal muscle', cn: '肋间外肌', lv: 1, tri: 12000, note: '肋骨之间斜向前下，吸气时把肋骨提起来' },
      { m: 'internal intercostal muscle', cn: '肋间内肌', lv: 1, tri: 12000 },
      { m: 'innermost intercostal muscle', cn: '肋间最内肌', lv: 1, tri: 8000 },
      { m: 'transversus thoracis', cn: '胸横肌', lv: 1, tri: 3000 },
      { m: 'serratus posterior superior', cn: '上后锯肌', lv: 1, tri: 2200 },
      { m: 'serratus posterior inferior', cn: '下后锯肌', lv: 1, tri: 2200 },
      { m: 'rhomboid major', cn: '大菱形肌', lv: 1, tri: 2600, note: '两块肩胛骨之间，含胸久了它就累' },
      { m: 'levator scapulae', cn: '肩胛提肌', lv: 1, tri: 2400 },
      { m: 'supraspinatus', cn: '冈上肌', lv: 1, tri: 2400, note: '肩袖四块之一，抬手到侧上方常伤这条' },
      { m: 'infraspinatus muscle', cn: '冈下肌', lv: 1, tri: 2800 },
      { m: 'subscapularis', cn: '肩胛下肌', lv: 1, tri: 2800 },
      { m: 'teres major', cn: '大圆肌', lv: 1, tri: 2200 },
      { m: 'teres minor', cn: '小圆肌', lv: 1, tri: 1800 },
      { m: 'coracobrachialis', cn: '喙肱肌', lv: 1, tri: 1800 },
      { m: 'brachialis', cn: '肱肌', lv: 1, tri: 2600, note: '肱二头肌下面，屈肘的另一条主力' },
      { m: 'anconeus', cn: '肘肌', lv: 1, tri: 1400 },
      { m: 'pronator teres', cn: '旋前圆肌', lv: 1, tri: 2000 },
      { m: 'pronator quadratus', cn: '旋前方肌', lv: 1, tri: 1600 },
      { m: 'supinator', cn: '旋后肌', lv: 1, tri: 2200 },
      { m: 'flexor digitorum profundus', cn: '指深屈肌', lv: 1, tri: 3200 },
      { m: 'flexor digitorum superficialis', cn: '指浅屈肌', lv: 1, tri: 3200 },

      { m: 'scalenus anterior', cn: '前斜角肌', lv: 1, tri: 1800, note: '颈侧深层，臂丛神经从它后面穿出' },
      { m: 'scalenus medius', cn: '中斜角肌', lv: 1, tri: 2000 },
      { m: 'scalenus posterior', cn: '后斜角肌', lv: 1, tri: 1600 },
      { m: 'splenius capitis', cn: '头夹肌', lv: 1, tri: 2600 },
      { m: 'splenius cervicis', cn: '颈夹肌', lv: 1, tri: 2000 },
      { m: 'longissimus thoracis', cn: '胸最长肌', lv: 1, tri: 5000, note: '竖脊肌的一支，沿脊柱两侧上下走' },
      { m: 'longissimus cervicis', cn: '颈最长肌', lv: 1, tri: 2200 },
      { m: 'longissimus capitis', cn: '头最长肌', lv: 1, tri: 1800 },
      { m: 'iliocostalis lumborum', cn: '腰髂肋肌', lv: 1, tri: 4000, note: '腰背最外那支竖脊肌，弯腰搬重物容易拉到' },
      { m: 'iliocostalis thoracis', cn: '胸髂肋肌', lv: 1, tri: 3000 },
      { m: 'iliocostalis cervicis', cn: '颈髂肋肌', lv: 1, tri: 2000 },
      { m: 'spinalis thoracis', cn: '胸棘肌', lv: 1, tri: 2600 },
      { m: 'semispinalis thoracis', cn: '胸半棘肌', lv: 1, tri: 2600 },
      { m: 'semispinalis cervicis', cn: '颈半棘肌', lv: 1, tri: 2400 },
      { m: 'semispinalis capitis', cn: '头半棘肌', lv: 1, tri: 2600, note: '后颈那层，长期低头就是它在扛' },
      { m: 'thoracic rotator', cn: '胸旋转肌', lv: 1, tri: 3000 },
      { m: 'lumbar rotator', cn: '腰旋转肌', lv: 1, tri: 1800 },
      { m: 'psoas major', cn: '腰大肌', lv: 1, tri: 3600, note: '从腰椎穿过盆腔到大腿根，久坐会缩短' },
      { m: 'iliacus', cn: '髂肌', lv: 1, tri: 2600 },
      { m: 'gluteus medius', cn: '臀中肌', lv: 1, tri: 3000, note: '臀大肌底下，单腿站立时稳住骨盆' },
      { m: 'gluteus minimus', cn: '臀小肌', lv: 1, tri: 2400 },
      { m: 'piriformis', cn: '梨状肌', lv: 1, tri: 2000, note: '坐骨神经就从它旁边过，紧了会屁股连着腿麻' },
      { m: 'quadratus femoris', cn: '股方肌', lv: 1, tri: 1600 },
      { m: 'obturator internus', cn: '闭孔内肌', lv: 1, tri: 2200 },
      { m: 'obturator externus', cn: '闭孔外肌', lv: 1, tri: 2000 },
      { m: 'vastus intermedius', cn: '股中间肌', lv: 1, tri: 3000 },
      { m: 'adductor magnus', cn: '大收肌', lv: 1, tri: 3600 },
      { m: 'soleus', cn: '比目鱼肌', lv: 1, tri: 4000, note: '腓肠肌下面那层，走久了酸的多半是它' },
      { m: 'plantaris', cn: '跖肌', lv: 1, tri: 1400 },
      { m: 'tibialis posterior', cn: '胫骨后肌', lv: 1, tri: 2600 },
      { m: 'flexor digitorum longus', cn: '趾长屈肌', lv: 1, tri: 2600 },
      { m: 'flexor hallucis longus', cn: '拇长屈肌', lv: 1, tri: 2600 }
    ]
  }
];

module.exports = { ref: { height: 171.95 }, drop: DROP, systems: SYSTEMS };
