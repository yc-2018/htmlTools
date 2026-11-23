// 61 件物品、三个区域、四种出行方式
(function () {
  'use strict';

  const ITEMS = [
    // 房间 · 床铺区
    { id: 'blanket', name: '被子', tag: 'dorm', icon: 'blanket' },
    { id: 'pillow', name: '枕头', tag: 'dorm', icon: 'hotel' },
    { id: 'mat', name: '席子', tag: 'dorm', icon: 'grid_on' },
    { id: 'eye-mask', name: '眼罩', tag: 'dorm', icon: 'bedtime' },
    { id: 'earplugs', name: '耳塞', tag: 'dorm', icon: 'hearing_disabled' },
    { id: 'lint-roller', name: '粘毛器', tag: 'dorm', icon: 'brush' },

    // 房间 · 书桌区
    { id: 'monitor', name: '显示器', tag: 'dorm', icon: 'desktop_windows' },
    { id: 'laptop', name: '电脑', tag: 'short', icon: 'laptop_mac' },
    { id: 'laptop-cable', name: '电脑充电线', tag: 'short', icon: 'cable' },
    { id: 'power-strip', name: '插排', tag: 'dorm', icon: 'outlet' },
    { id: 'charger', name: '充电器', tag: 'short', icon: 'charger' },
    { id: 'power-bank', name: '充电宝', tag: 'short', icon: 'battery_charging_full' },
    { id: 'headphones', name: '耳机', tag: 'short', icon: 'headphones' },
    { id: 'phone-stand', name: '手机支架', tag: 'dorm', icon: 'phone_iphone' },
    { id: 'backup-phone', name: '备用机', tag: 'dorm', icon: 'devices' },
    { id: 'bt-speaker', name: '蓝牙音箱', tag: 'dorm', icon: 'speaker' },

    // 房间 · 衣柜区
    { id: 'mirror', name: '镜子', tag: 'long', icon: 'crop_portrait' },
    { id: 'hair-dryer', name: '吹风机', tag: 'dorm', icon: 'air' },
    { id: 'nail-clipper', name: '指甲钳', tag: 'long', icon: 'content_cut' },
    { id: 'ear-pick', name: '耳勺', tag: 'long', icon: 'hearing' },
    { id: 'floss', name: '牙线', tag: 'long', icon: 'all_inclusive' },
    { id: 'cotton-swab', name: '棉签', tag: 'long', icon: 'cleaning_services' },
    { id: 'lotion', name: '润肤露', tag: 'short', icon: 'spa' },
    { id: 'hanger', name: '衣架', tag: 'dorm', icon: 'checkroom' },
    { id: 'tops', name: '上衣', tag: 'short', icon: 'apparel' },
    { id: 'pants', name: '裤子', tag: 'short', icon: 'dry_cleaning' },
    { id: 'underwear', name: '内裤', tag: 'short', icon: 'layers' },
    { id: 'socks', name: '袜子', tag: 'short', icon: 'footprint' },

    // 房间 · 地面区
    { id: 'slippers', name: '拖鞋', tag: 'dorm', icon: 'footprint' },
    { id: 'scissors', name: '剪刀', tag: 'dorm', icon: 'content_cut' },
    { id: 'knife', name: '小刀', tag: 'dorm', icon: 'hardware' },
    { id: 'lighter', name: '打火机', tag: 'dorm', icon: 'local_fire_department' },
    { id: 'alcohol-spray', name: '酒精喷雾', tag: 'dorm', icon: 'sanitizer' },
    { id: 'tape', name: '胶带', tag: 'dorm', icon: 'sticky_note_2' },
    { id: 'mask', name: '口罩', tag: 'long', icon: 'masks' },
    { id: 'tissue-small', name: '小包纸巾', tag: 'short', icon: 'sticky_note_2' },
    { id: 'tissue-large', name: '大包纸巾', tag: 'long', icon: 'package_2' },
    { id: 'sewing-kit', name: '针线', tag: 'dorm', icon: 'all_inclusive' },
    { id: 'meds', name: '备用药', tag: 'dorm', icon: 'medication' },
    { id: 'water-bottle', name: '水瓶', tag: 'long', icon: 'water_bottle' },
    { id: 'umbrella', name: '雨伞', tag: 'long', icon: 'umbrella' },
    { id: 'fan', name: '风扇', tag: 'dorm', icon: 'mode_fan' },
    { id: 'scale', name: '电子秤', tag: 'dorm', icon: 'scale' },
    { id: 'vacuum', name: '吸尘器', tag: 'dorm', icon: 'vacuum' },

    // 阳台
    { id: 'rice-cooker', name: '电饭煲', tag: 'dorm', icon: 'soup_kitchen' },
    { id: 'toothbrush', name: '牙刷', tag: 'long', icon: 'brush' },
    { id: 'toothpaste', name: '牙膏', tag: 'long', icon: 'dentistry' },
    { id: 'rinse-cup', name: '漱口杯', tag: 'long', icon: 'local_cafe' },
    { id: 'egg-steamer', name: '蒸蛋器', tag: 'dorm', icon: 'egg' },
    { id: 'bucket', name: '水桶', tag: 'dorm', icon: 'water_drop' },
    { id: 'drying-rack', name: '晾衣杆', tag: 'dorm', icon: 'curtains' },
    { id: 'balcony-mirror', name: '阳台镜', tag: 'dorm', icon: 'crop_portrait' },
    { id: 'tableware', name: '碗筷碟', tag: 'dorm', icon: 'flatware' },
    { id: 'dish-soap', name: '洗洁精', tag: 'dorm', icon: 'soap' },
    { id: 'rag', name: '抹布', tag: 'dorm', icon: 'wash' },

    // 卫生间
    { id: 'shampoo', name: '洗发水', tag: 'long', icon: 'shower' },
    { id: 'body-wash', name: '沐浴露', tag: 'long', icon: 'water_drop' },
    { id: 'face-wash', name: '洗面奶', tag: 'long', icon: 'soap' },
    { id: 'laundry-detergent', name: '洗衣液', tag: 'long', icon: 'local_laundry_service' },
    { id: 'razor', name: '刮胡刀', tag: 'long', icon: 'hardware' },
    { id: 'shaving-foam', name: '刮胡泡沫', tag: 'long', icon: 'air' }
  ];

  const ROOMS = [
    {
      id: 'room', name: '房间', icon: 'bed',
      zones: [
        { name: '床铺区', ids: ['blanket', 'pillow', 'mat', 'eye-mask', 'earplugs', 'lint-roller'] },
        { name: '书桌区', ids: ['monitor', 'laptop', 'laptop-cable', 'power-strip', 'charger', 'power-bank', 'headphones', 'phone-stand', 'backup-phone', 'bt-speaker'] },
        { name: '衣柜区', ids: ['mirror', 'hair-dryer', 'nail-clipper', 'ear-pick', 'floss', 'cotton-swab', 'lotion', 'hanger', 'tops', 'pants', 'underwear', 'socks'] },
        { name: '地面区', ids: ['slippers', 'scissors', 'knife', 'lighter', 'alcohol-spray', 'tape', 'mask', 'tissue-small', 'tissue-large', 'sewing-kit', 'meds', 'water-bottle', 'umbrella', 'fan', 'scale', 'vacuum'] }
      ]
    },
    {
      id: 'balcony', name: '阳台', icon: 'balcony',
      zones: [
        { name: '洗漱角', ids: ['toothbrush', 'toothpaste', 'rinse-cup'] },
        { name: '操作台', ids: ['rice-cooker', 'egg-steamer', 'tableware', 'dish-soap', 'rag'] },
        { name: '晾晒区', ids: ['drying-rack', 'balcony-mirror', 'bucket'] }
      ]
    },
    {
      id: 'bath', name: '卫生间', icon: 'bathtub',
      zones: [
        { name: '洗漱区', ids: ['shampoo', 'body-wash', 'face-wash'] },
        { name: '清洁区', ids: ['laundry-detergent', 'razor', 'shaving-foam'] }
      ]
    }
  ];

  const ITEM_MAP = {};
  ITEMS.forEach(it => { ITEM_MAP[it.id] = it; });

  const MODE_INCLUDES = {
    short: ['short'],
    long: ['short', 'long'],
    dorm: ['short', 'dorm'],
    rent: ['short', 'long', 'rent']
  };

  const MODE_LABEL = { '': '未选', short: '短途', long: '长途', dorm: '宿舍', rent: '租房' };
  const TAG_LABEL = { short: '短途', long: '长途', dorm: '宿舍', rent: '租房' };

  function idsForMode(mode) {
    if (!mode) return [];
    const inc = MODE_INCLUDES[mode] || [];
    return ITEMS.filter(it => inc.indexOf(it.tag) >= 0).map(it => it.id);
  }

  window.XW_DATA = {
    ITEMS: ITEMS,
    ITEM_MAP: ITEM_MAP,
    ROOMS: ROOMS,
    MODE_INCLUDES: MODE_INCLUDES,
    MODE_LABEL: MODE_LABEL,
    TAG_LABEL: TAG_LABEL,
    idsForMode: idsForMode
  };
})();
