/*
 * RegexLab · 正则表达式测试
 * 分区：工具函数 → 数据（标志/快捷插入/正则库/速查）→ 状态与存储 → 静态区块构建
 *       → 匹配引擎 → 高亮与结果渲染 → 关键字解释 → 代码生成 → 分享与初始化
 * 匹配统一使用浏览器原生 RegExp；代码生成只做语法转义与兼容性提示。
 */
(function () {
  'use strict';

  /* ================= 工具函数 ================= */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  let toastTimer = 0;
  function toast(msg) {
    const el = EL.toast;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  function copyText(text) {
    if (!text) { toast('没有可复制的内容'); return; }
    const done = () => toast('已复制');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    if (ok) done(); else toast('复制失败，请手动选择');
  }

  function storageGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 隐私模式下忽略 */ }
  }

  /* ================= 数据 ================= */

  const ALLOWED_FLAGS = 'gimsuyvd';

  const FLAG_INFO = [
    { id: 'g', short: 'global', zh: '全局', desc: '全局匹配：返回所有匹配，而不是停在第一个' },
    { id: 'i', short: 'ignore', zh: '忽略大小写', desc: '忽略大小写' },
    { id: 'm', short: 'multiline', zh: '多行', desc: '多行模式：^ 和 $ 匹配每一行的开头与结尾' },
    { id: 's', short: 'dotAll', zh: '点匹配换行', desc: '点号 . 也匹配换行符' },
    { id: 'u', short: 'unicode', zh: 'Unicode', desc: 'Unicode 模式：按码点处理，\\u{...} 与 \\p{...} 生效' },
    { id: 'y', short: 'sticky', zh: '粘性', desc: '粘性匹配：只从 lastIndex 指定的位置开始匹配' },
    { id: 'd', short: 'indices', zh: '记录下标', desc: '记录每个捕获组的起止下标（hasIndices）' },
    { id: 'v', short: 'set', zh: '集合', desc: 'Unicode 集合模式，较新特性（Chrome 112+）' }
  ];

  const QUICK_TOKENS = [
    { t: '\\d', d: '数字 0-9' },
    { t: '\\w', d: '单词字符' },
    { t: '\\s', d: '空白字符' },
    { t: '\\b', d: '单词边界' },
    { t: '.', d: '任意字符' },
    { t: '[abc]', d: '字符类', focus: [1, 4] },
    { t: '[^abc]', d: '排除字符', focus: [2, 5] },
    { t: '(abc)', d: '捕获组', focus: [1, 4] },
    { t: '(?:abc)', d: '非捕获组', focus: [3, 6] },
    { t: '(?<name>abc)', d: '命名捕获组', focus: [3, 7] },
    { t: '(?=abc)', d: '正向先行断言', focus: [3, 6] },
    { t: '(?!abc)', d: '负向先行断言', focus: [3, 6] },
    { t: '(?<=abc)', d: '正向后行断言', focus: [4, 7] },
    { t: '(?<!abc)', d: '负向后行断言', focus: [4, 7] },
    { t: '*', d: '0 次或多次' },
    { t: '+', d: '1 次或多次' },
    { t: '?', d: '0 次或 1 次' },
    { t: '{2,5}', d: '重复次数' },
    { t: '*?', d: '懒惰匹配' },
    { t: '|', d: '或' },
    { t: '^', d: '行首' },
    { t: '$', d: '行尾' },
    { t: '\\1', d: '反向引用' }
  ];

  const DEFAULT_TEXT = [
    '张伟    zhangwei@example.com    2024-03-15',
    '李娜    li.na+work@mail.example.org    2024-11-02',
    '技术支持 support@company.cn / 文档 https://example.com/docs/api?page=2',
    '订单号 A-10293，金额 ¥1,280.50，回访电话 13800138000',
    '备注：请于 2024-12-31 前完成验收，逾期按 0.05% 计违约金。',
    '联系人 wang_wu@sub.domain.com.cn（座机 010-88886666）'
  ].join('\n');

  const DEFAULT_PATTERN = '\\b(?<user>[\\w.+-]+)@(?<domain>[\\w-]+(?:\\.[\\w-]+)+)\\b';

  const LIBRARY = [
    {
      name: '邮箱地址',
      pat: '[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}',
      flags: 'g',
      sample: '联系 zhang.wei@example.com 或 li_na+work@mail.example.org，无效写法 a@b、@c.com'
    },
    {
      name: '中国大陆手机号',
      pat: '(?<!\\d)1[3-9]\\d{9}(?!\\d)',
      flags: 'g',
      sample: '客服 13800138000，备用 19912345678，工号 013800138000 不算手机号'
    },
    {
      name: '固定电话',
      pat: '0\\d{2,3}-\\d{7,8}',
      flags: 'g',
      sample: '北京 010-88886666，上海 021-66889900，内线 8001'
    },
    {
      name: 'URL 网址',
      pat: 'https?://[^\\s<>"\']+',
      flags: 'g',
      sample: '文档 https://example.com/docs/api?page=2 ，图片 http://img.example.cn/a.png 完'
    },
    {
      name: 'IPv4 地址',
      pat: '\\b(?:(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\b',
      flags: 'g',
      sample: '网关 192.168.1.1，DNS 8.8.8.8，非法 999.1.1.1'
    },
    {
      name: '日期 YYYY-MM-DD',
      pat: '(?<year>\\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\\d|3[01])',
      flags: 'g',
      sample: '开始 2024-03-15，截止 2024-12-31，非法 2024-13-40'
    },
    {
      name: '时间 HH:MM(:SS)',
      pat: '\\b(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?\\b',
      flags: 'g',
      sample: '上班 09:30，午休 12:00:00，加班到 23:59，异常 25:61'
    },
    {
      name: '中文字符',
      pat: '[\\u4e00-\\u9fa5]+',
      flags: 'g',
      sample: 'Hello 世界，这是 2024 年的第 3 次更新'
    },
    {
      name: '身份证号（18 位）',
      pat: '\\b\\d{17}[\\dXx]\\b',
      flags: 'g',
      sample: '身份证 11010519491231002X，手机 13800138000'
    },
    {
      name: '十六进制颜色',
      pat: '#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\\b',
      flags: 'g',
      sample: '主色 #2563eb，浅色 #fff，半透明 #2563eb80，单独的 # 不算'
    },
    {
      name: '密码强度（8-20 位含大小写数字）',
      pat: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)\\S{8,20}$',
      flags: 'gm',
      sample: 'Abc12345\nabcdefgh\nABCDEFG1\nAbc 12345'
    },
    {
      name: 'HTML 标签',
      pat: '</?(?<tag>[a-zA-Z][\\w-]*)(?:\\s[^>]*)?/?>',
      flags: 'g',
      sample: '<div class="box"><p>文本</p><br/></div>'
    },
    {
      name: 'UUID',
      pat: '\\b[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\\b',
      flags: 'g',
      sample: 'id 550e8400-e29b-41d4-a716-446655440000，短写法 550e8400'
    },
    {
      name: '重复出现的单词',
      pat: '\\b(\\w+)\\s+\\1\\b',
      flags: 'gi',
      sample: 'This is is a a test test text'
    },
    {
      name: '行尾多余空白',
      pat: '[ \\t]+$',
      flags: 'gm',
      sample: '第一行后面有空格   \n第二行是 Tab\t\n第三行干净'
    },
    {
      name: '千分位数字',
      pat: '\\b\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?\\b',
      flags: 'g',
      sample: '营收 1,280.50 万，用户 12,345,678 人，普通数字 2024'
    },
    {
      name: 'Markdown 链接',
      pat: '\\[(?<text>[^\\]]+)\\]\\((?<url>[^)\\s]+)\\)',
      flags: 'g',
      sample: '[官网](https://example.com) 和 ![图片](a.png)'
    },
    {
      name: '行注释 //',
      pat: '//[^\\n]*',
      flags: 'g',
      sample: 'const a = 1; // 初始化\n// 单独一行的注释'
    }
  ];

  const CHEAT = [
    {
      title: '字符类',
      items: [
        { c: '\\d', d: '数字 0-9' },
        { c: '\\D', d: '非数字' },
        { c: '\\w', d: '字母数字下划线' },
        { c: '\\W', d: '非单词字符' },
        { c: '\\s', d: '空白与换行' },
        { c: '\\S', d: '非空白字符' },
        { c: '.', d: '任意字符' },
        { c: '[abc]', d: '其中任一字符' },
        { c: '[^abc]', d: '排除这些字符' },
        { c: '[a-z]', d: '字符范围' },
        { c: '\\p{L}', d: 'Unicode 字母（需 u）' },
        { c: '\\p{Script=Han}', d: '汉字（需 u）' }
      ]
    },
    {
      title: '量词',
      items: [
        { c: '*', d: '0 次或多次' },
        { c: '+', d: '1 次或多次' },
        { c: '?', d: '0 次或 1 次' },
        { c: '{3}', d: '恰好 3 次' },
        { c: '{2,}', d: '至少 2 次' },
        { c: '{2,5}', d: '2 到 5 次' },
        { c: '*?', d: '懒惰：0 次或多次' },
        { c: '+?', d: '懒惰：1 次或多次' },
        { c: '??', d: '懒惰：0 次或 1 次' },
        { c: '*+', d: '占有量词（PCRE）' }
      ]
    },
    {
      title: '位置与边界',
      items: [
        { c: '^', d: '行首（m 模式下）' },
        { c: '$', d: '行尾（m 模式下）' },
        { c: '\\b', d: '单词边界' },
        { c: '\\B', d: '非单词边界' },
        { c: '\\A', d: '文本开头（PCRE）' },
        { c: '\\z', d: '文本结尾（PCRE）' }
      ]
    },
    {
      title: '分组与引用',
      items: [
        { c: '(abc)', d: '捕获组' },
        { c: '(?:abc)', d: '非捕获组' },
        { c: '(?<name>abc)', d: '命名捕获组' },
        { c: '(?P<name>abc)', d: 'Python 命名组' },
        { c: '\\1', d: '反向引用第 1 组' },
        { c: '\\k<name>', d: '引用命名组' }
      ]
    },
    {
      title: '断言',
      items: [
        { c: '(?=abc)', d: '后面必须是' },
        { c: '(?!abc)', d: '后面不能是' },
        { c: '(?<=abc)', d: '前面必须是' },
        { c: '(?<!abc)', d: '前面不能是' },
        { c: '\\K', d: '重置起点（PCRE）' }
      ]
    },
    {
      title: '转义与占位',
      items: [
        { c: '\\|', d: '转义竖线' },
        { c: '\\.', d: '转义点号' },
        { c: '\\/', d: '转义斜杠' },
        { c: '\\\\', d: '反斜杠本身' },
        { c: '\\n', d: '换行符' },
        { c: '\\t', d: '制表符' },
        { c: '\\x41', d: '十六进制字符' },
        { c: '\\u4e00', d: 'Unicode 字符' },
        { c: '\\u{1F600}', d: '码点（需 u）' }
      ]
    }
  ];

  /* ================= 元素与状态 ================= */

  const EL = {
    toast: $('#toast'),
    patternBar: $('#patternBar'),
    pattern: $('#pattern'),
    flags: $('#flags'),
    flagMenu: $('#flagMenu'),
    flagsPicker: $('#flagsPicker'),
    btnFlags: $('#btnFlags'),
    flagDesc: $('#flagDesc'),
    status: $('#status'),
    tokenBar: $('#tokenBar'),
    text: $('#text'),
    hl: $('#hl'),
    editor: $('#editor'),
    textTabs: $('#textTabs'),
    textMeta: $('#textMeta'),
    matchBadge: $('#matchBadge'),
    matchList: $('#matchList'),
    matchSummary: $('#matchSummary'),
    explainList: $('#explainList'),
    tabs: $('#tabs'),
    langSelect: $('#langSelect'),
    codeOut: $('#codeOut'),
    codeWarn: $('#codeWarn'),
    codeMeta: $('#codeMeta'),
    replInput: $('#replInput'),
    replOut: $('#replOut'),
    replMeta: $('#replMeta'),
    libList: $('#libList'),
    libModal: $('#libModal'),
    libSearch: $('#libSearch'),
    libEmpty: $('#libEmpty'),
    favSection: $('#favSection'),
    favCount: $('#favCount'),
    favList: $('#favList'),
    favEmpty: $('#favEmpty'),
    favForm: $('#favForm'),
    favName: $('#favName'),
    btnFav: $('#btnFav'),
    btnFavCancel: $('#btnFavCancel'),
    histModal: $('#histModal'),
    historyList: $('#historyList'),
    cheatWrap: $('#cheatWrap'),
    btnTheme: $('#btnTheme'),
    fileInput: $('#fileInput'),
    hlHint: $('#hlHint')
  };

  const state = {
    lang: 'js',
    tab: 'matches',
    active: -1,
    matches: [],
    regex: null,
    pattern: '',
    flags: '',
    text: '',
    truncated: false,
    slow: false,
    elapsed: 0,
    compileError: '',
    errorInfo: null,
    lastSample: '',
    atLimit: false
  };

  const STORE_STATE = 'regexlab.state.v1';
  const STORE_HISTORY = 'regexlab.history.v1';
  const STORE_THEME = 'regexlab.theme.v1';
  const STORE_FAVS = 'regexlab.favs.v1';
  const STORE_TABS = 'regexlab.texttabs.v1';
  const FAV_LIMIT = 50;
  const TEXT_TABS = 4;
  const TAB_NAME_MAX = 12;

  /* ================= 主题 ================= */

  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function effectiveTheme() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    return darkQuery && darkQuery.matches ? 'dark' : 'light';
  }

  function applyTheme(mode) {
    if (mode === 'dark' || mode === 'light') {
      document.documentElement.setAttribute('data-theme', mode);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    EL.btnTheme.textContent = effectiveTheme() === 'dark' ? '浅色模式' : '深色模式';
  }

  /* ================= 静态区块 ================= */

  function buildFlagMenu() {
    EL.flagMenu.innerHTML = FLAG_INFO.map((f) =>
      '<button class="flag-opt" type="button" role="option" data-flag="' + f.id + '" aria-selected="false">' +
      '<b>' + f.id + '</b>' +
      '<span>' + esc(f.desc) + '</span>' +
      '<i class="tick" aria-hidden="true">✓</i>' +
      '</button>'
    ).join('');
  }

  function buildTokens() {
    EL.tokenBar.innerHTML = QUICK_TOKENS.map((k) =>
      '<button class="tok-btn" type="button" data-token="' + esc(k.t) + '" title="' + esc(k.d) + '">' +
      esc(k.t) + '</button>'
    ).join('');
  }

  function buildLibrary() {
    EL.libList.innerHTML = LIBRARY.map((item, i) =>
      '<button class="lib-item" type="button" data-lib="' + i + '" title="' + esc(item.pat) + '">' +
      '<span class="lib-name">' + esc(item.name) + '</span>' +
      '<span class="lib-pat">' + esc(item.pat) + '</span>' +
      '</button>'
    ).join('');
  }

  function buildCheat() {
    EL.cheatWrap.innerHTML = CHEAT.map((sec, i) =>
      '<details' + (i < 2 ? ' open' : '') + '>' +
      '<summary>' + esc(sec.title) + '</summary>' +
      '<div class="cheat-grid">' +
      sec.items.map((it) =>
        '<button class="cheat-row" type="button" data-ins="' + esc(it.c) + '" title="插入 ' + esc(it.c) + '">' +
        '<code>' + esc(it.c) + '</code><span>' + esc(it.d) + '</span></button>'
      ).join('') +
      '</div></details>'
    ).join('');
  }

  function buildLangSelect() {
    EL.langSelect.innerHTML = LANGS.map((l) =>
      '<option value="' + l.id + '">' + esc(l.label) + '</option>'
    ).join('');
    EL.langSelect.value = state.lang;
  }

  /* ================= 测试文本分页 ================= */

  let textTabs = [];
  let activeTextTab = 0;

  function defaultTextTabs() {
    const list = [];
    for (let i = 0; i < TEXT_TABS; i++) list.push({ name: '文本 ' + (i + 1), text: '' });
    return list;
  }

  function normalizeTextTabs(raw) {
    const base = defaultTextTabs();
    if (!Array.isArray(raw)) return base;
    return base.map(function (item, i) {
      const src = raw[i];
      if (!src || typeof src !== 'object') return item;
      const name = typeof src.name === 'string' ? src.name.trim().slice(0, TAB_NAME_MAX) : '';
      return { name: name || item.name, text: typeof src.text === 'string' ? src.text : '' };
    });
  }

  function renderTextTabs() {
    EL.textTabs.innerHTML = textTabs.map(function (tab, i) {
      return '<button class="txt-tab' + (i === activeTextTab ? ' active' : '') + '" type="button" role="tab" ' +
        'data-tab-i="' + i + '" aria-selected="' + String(i === activeTextTab) + '" ' +
        'title="' + esc(tab.name) + '（双击改名）">' +
        '<span class="txt-tab-name">' + esc(tab.name) + '</span></button>';
    }).join('');
  }

  // 切换分页时先把当前输入写回，再载入目标分页并重算匹配
  function switchTextTab(i) {
    if (!(i >= 0 && i < textTabs.length) || i === activeTextTab) return;
    textTabs[activeTextTab].text = EL.text.value;
    activeTextTab = i;
    EL.text.value = textTabs[i].text;
    state.active = -1;
    state.lastSample = '';
    EL.text.scrollTop = 0;
    EL.hl.scrollTop = 0;
    renderTextTabs();
    render();
  }

  // 双击分页名内联改名：回车或失焦保存，Esc 取消
  function startRenameTab(i, nameEl) {
    const input = document.createElement('input');
    input.className = 'txt-tab-input';
    input.type = 'text';
    input.maxLength = TAB_NAME_MAX;
    input.value = textTabs[i].name;
    input.setAttribute('aria-label', '重命名测试文本分页');
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    function finish(save) {
      if (done) return;
      done = true;
      const next = input.value.trim().slice(0, TAB_NAME_MAX);
      if (save && next) textTabs[i].name = next;
      renderTextTabs();
      saveState();
    }
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', function () { finish(true); });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    input.addEventListener('dblclick', function (e) { e.stopPropagation(); });
  }

  function restoreTextTabs() {
    const saved = storageGet(STORE_TABS, null);
    textTabs = normalizeTextTabs(saved && saved.tabs);
    const idx = saved ? Number(saved.active) : 0;
    activeTextTab = idx >= 0 && idx < TEXT_TABS ? idx : 0;
    if (!(saved && Array.isArray(saved.tabs))) {
      // 旧版本只存了一份文本，迁移到第一个分页
      const old = storageGet(STORE_STATE, null);
      if (old && typeof old.t === 'string') textTabs[0].text = old.t;
    }
    EL.text.value = textTabs[activeTextTab].text;
  }

  /* ================= 标志处理 ================= */

  function validFlags(raw) {
    const seen = Object.create(null);
    let out = '';
    for (const ch of raw) {
      if (ALLOWED_FLAGS.indexOf(ch) >= 0 && !seen[ch]) {
        seen[ch] = true;
        out += ch;
      }
    }
    return out;
  }

  function invalidFlagChars(raw) {
    const bad = [];
    for (const ch of raw) {
      if (!/\s/.test(ch) && ALLOWED_FLAGS.indexOf(ch) < 0 && bad.indexOf(ch) < 0) bad.push(ch);
    }
    return bad;
  }

  function syncFlagUI() {
    const on = validFlags(EL.flags.value);
    if (EL.flags.value !== on) EL.flags.value = on;
    EL.flags.style.width = 'calc(' + (on.length || 1) + 'ch + 4px)';
    $$('.flag-opt', EL.flagMenu).forEach(function (opt) {
      const yes = on.indexOf(opt.dataset.flag) >= 0;
      opt.classList.toggle('on', yes);
      opt.setAttribute('aria-selected', String(yes));
    });
    renderFlagDesc(on);
  }

  function setFlagMenu(open) {
    EL.flagMenu.hidden = !open;
    EL.btnFlags.classList.toggle('open', open);
    EL.btnFlags.setAttribute('aria-expanded', String(open));
    EL.flags.setAttribute('aria-expanded', String(open));
  }

  // 输入框后面的 /g、/i 到底是什么意思，直接写在下面
  function renderFlagDesc(on) {
    if (!on) {
      EL.flagDesc.innerHTML = '<span class="flag-label">标志</span>' +
        '<span class="flag-item">没有启用任何标志：只返回第一个匹配，区分大小写，<code>^</code> 与 <code>$</code> 只匹配整段文本的开头与结尾。</span>';
      return;
    }
    EL.flagDesc.innerHTML = '<span class="flag-label">标志</span>' + on.split('').map(function (id) {
      const info = FLAG_INFO.filter(function (f) { return f.id === id; })[0];
      return '<span class="flag-item"><b>' + esc(id) + '</b>' + esc(info ? info.desc : '') + '</span>';
    }).join('');
  }

  function toggleFlag(id) {
    const cur = validFlags(EL.flags.value);
    const next = cur.indexOf(id) >= 0 ? cur.split(id).join('') : cur + id;
    const ordered = ALLOWED_FLAGS.split('').filter((c) => next.indexOf(c) >= 0).join('');
    EL.flags.value = ordered;
    syncFlagUI();
    render();
  }

  /* ================= 输入辅助 ================= */

  function insertIntoPattern(snippet, focusFrom, focusTo) {
    const input = EL.pattern;
    const start = input.selectionStart == null ? input.value.length : input.selectionStart;
    const end = input.selectionEnd == null ? start : input.selectionEnd;
    input.value = input.value.slice(0, start) + snippet + input.value.slice(end);
    const base = start;
    const from = base + (focusFrom == null ? snippet.length : focusFrom);
    const to = base + (focusTo == null ? (focusFrom == null ? snippet.length : focusFrom) : focusTo);
    input.focus();
    try { input.setSelectionRange(from, to); } catch (e) { /* 忽略 */ }
    render();
  }

  /* ================= 匹配引擎 ================= */

  let HAS_INDICES = false;
  try { new RegExp('', 'd'); HAS_INDICES = true; } catch (e) { HAS_INDICES = false; }

  const MATCH_LIMIT = 5000;
  const ROW_LIMIT = 300;
  const HL_TEXT_LIMIT = 300000;

  function compile(pattern, flags) {
    if (!pattern) return { regex: null, error: '' };
    const usable = flags + (HAS_INDICES && flags.indexOf('d') < 0 ? 'd' : '');
    try {
      return { regex: new RegExp(pattern, usable), error: '' };
    } catch (e) {
      // 报错时用用户原始的标志重新编译一次，避免错误信息里出现内部附加的 d
      let msg = e && e.message ? e.message : String(e);
      if (usable !== flags) {
        try {
          new RegExp(pattern, flags);
        } catch (e2) {
          if (e2 && e2.message) msg = e2.message;
        }
      }
      return { regex: null, error: msg };
    }
  }

  function advanceIndex(text, index, unicode) {
    if (index >= text.length) return text.length + 1;
    if (unicode) {
      const cp = text.codePointAt(index);
      return index + (cp > 0xffff ? 2 : 1);
    }
    return index + 1;
  }

  // 与原生 exec 语义一致：带 g / y 时循环取全部，零宽匹配手动前进一步避免死循环
  function collect(regex, text) {
    const out = [];
    let truncated = false;
    let slow = false;
    let elapsed = 0;
    if (!regex) return { list: out, truncated, slow, elapsed };

    if (!regex.global && !regex.sticky) {
      const t0 = performance.now();
      const m = regex.exec(text);
      if (m) out.push(m);
      regex.lastIndex = 0;
      return { list: out, truncated, slow, elapsed: performance.now() - t0 };
    }

    const unicode = regex.unicode || regex.unicodeSets;
    const t0 = performance.now();
    let guard = 0;
    let m;
    regex.lastIndex = 0;
    while ((m = regex.exec(text)) !== null) {
      out.push(m);
      if (m[0] === '') {
        regex.lastIndex = advanceIndex(text, regex.lastIndex, unicode);
      }
      if (regex.lastIndex > text.length) break;
      if (out.length >= MATCH_LIMIT) { truncated = true; break; }
      if ((++guard & 127) === 0 && performance.now() - t0 > 700) { slow = true; break; }
    }
    regex.lastIndex = 0;
    elapsed = performance.now() - t0;
    return { list: out, truncated, slow, elapsed };
  }

  function groupNamesOf(pattern) {
    const names = [];
    let i = 0;
    let inClass = false;
    while (i < pattern.length) {
      const ch = pattern[i];
      if (ch === '\\') { i += 2; continue; }
      if (inClass) {
        if (ch === ']') inClass = false;
        i++;
        continue;
      }
      if (ch === '[') { inClass = true; i++; continue; }
      if (ch === '(') {
        if (pattern[i + 1] !== '?') { names.push(null); i++; continue; }
        if (pattern[i + 2] === '<' && pattern[i + 3] !== '=' && pattern[i + 3] !== '!') {
          const close = pattern.indexOf('>', i + 3);
          names.push(close > 0 ? pattern.slice(i + 3, close) : null);
          i = close > 0 ? close + 1 : i + 1;
          continue;
        }
        if (pattern[i + 2] === 'P' && pattern[i + 3] === '<') {
          const close = pattern.indexOf('>', i + 4);
          names.push(close > 0 ? pattern.slice(i + 4, close) : null);
          i = close > 0 ? close + 1 : i + 1;
          continue;
        }
        i++;
        continue;
      }
      i++;
    }
    return names;
  }

  function lineIndex(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) starts.push(i + 1);
    }
    return function lineOf(pos) {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
      }
      return lo + 1;
    };
  }

  /* ================= 高亮渲染 ================= */

  // 按顺序拼接：普通文本 + 每个匹配片段（内含分组下划线），整体 O(n)
  function buildHighlightHTML(text, matches, active) {
    const parts = [];
    let pos = 0;
    const withGroups = HAS_INDICES && matches.length <= 2000;

    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const s = m.index;
      const e = s + m[0].length;
      if (e <= s) continue;
      if (s < pos) continue;
      if (s > pos) parts.push(esc(text.slice(pos, s)));
      parts.push(
        '<span class="m c' + (i % 4) + (i === active ? ' active' : '') + '">' +
        matchInner(text, m, withGroups) +
        '</span>'
      );
      pos = e;
    }
    if (pos < text.length) parts.push(esc(text.slice(pos)));
    return parts.join('');
  }

  // 单个匹配内部：按分组边界切片，叠加下划线类名
  function matchInner(text, m, withGroups) {
    const start = m.index;
    const end = start + m[0].length;
    const plain = esc(text.slice(start, end));
    if (!withGroups || !m.indices) return plain;

    const groups = [];
    const cuts = [start, end];
    for (let g = 1; g < m.indices.length; g++) {
      const seg = m.indices[g];
      if (!seg || seg[1] <= seg[0]) continue;
      groups.push({ s: seg[0], e: seg[1], cls: 'g' + (((g - 1) % 4) + 1) });
      cuts.push(seg[0], seg[1]);
    }
    if (!groups.length) return plain;

    const uniq = cuts
      .filter((n) => n >= start && n <= end)
      .sort((a, b) => a - b)
      .filter((n, i, arr) => i === 0 || n !== arr[i - 1]);

    let html = '';
    for (let k = 0; k < uniq.length - 1; k++) {
      const a = uniq[k];
      const b = uniq[k + 1];
      if (b <= a) continue;
      let cls = '';
      for (let g = 0; g < groups.length; g++) {
        if (groups[g].s <= a && groups[g].e >= b && cls.indexOf(groups[g].cls) < 0) {
          cls += ' ' + groups[g].cls;
        }
      }
      const segText = esc(text.slice(a, b));
      html += cls ? '<span class="' + cls.trim() + '">' + segText + '</span>' : segText;
    }
    return html;
  }

  function renderHighlight() {
    const text = state.text;
    if (text.length > HL_TEXT_LIMIT) {
      EL.editor.classList.add('no-highlight');
      EL.hl.textContent = '';
      EL.hlHint.textContent = '文本超过 ' + HL_TEXT_LIMIT.toLocaleString() + ' 字符，已关闭高亮';
      return;
    }
    EL.editor.classList.remove('no-highlight');
    EL.hlHint.textContent = '高亮即匹配结果，点击右侧条目可定位';
    EL.hl.innerHTML = buildHighlightHTML(text, state.matches, state.active);
    if (text.charAt(text.length - 1) === '\n') EL.hl.appendChild(document.createTextNode('\n'));
  }

  function syncScroll() {
    EL.hl.scrollTop = EL.text.scrollTop;
    EL.hl.scrollLeft = EL.text.scrollLeft;
  }

  function editorLineHeight() {
    const lh = parseFloat(getComputedStyle(EL.text).lineHeight);
    return isNaN(lh) ? 24 : lh;
  }

  function revealInEditor(pos) {
    const lh = editorLineHeight();
    const before = state.text.slice(0, pos);
    const line = before.split('\n').length - 1;
    const viewH = EL.text.clientHeight;
    EL.text.scrollTop = Math.max(0, line * lh - viewH / 2);
    syncScroll();
  }

  /* ================= 结果列表 ================= */

  function groupValue(m, index) {
    const seg = m.indices && m.indices[index] ? m.indices[index] : null;
    const pos = seg ? ' @' + seg[0] : '';
    return { value: m[index], pos: pos };
  }

  function renderMatchList() {
    const matches = state.matches;
    const summaryBits = [];
    if (state.truncated) summaryBits.push('匹配数量超过 ' + MATCH_LIMIT + ' 条，已截断');
    if (state.slow) summaryBits.push('匹配耗时过长，已中止（可能存在灾难性回溯）');

    EL.matchBadge.textContent = matches.length + (state.truncated ? '+' : '');
    EL.matchList.innerHTML = '';

    if (!state.pattern) {
      EL.matchSummary.textContent = '';
      EL.matchList.innerHTML = '<li class="empty">先在上方写一条正则表达式。<br>也可以点右上角的「常用正则库」直接插入。</li>';
      return;
    }
    if (state.compileError) {
      const info = state.errorInfo || describeError(state.compileError, state.pattern);
      EL.matchSummary.textContent = '';
      EL.matchList.innerHTML = '<li class="empty">正则存在语法错误：<br><b>' + esc(info.title) + '</b>' +
        (info.hint ? '<br>' + esc(info.hint) : '') + '</li>';
      return;
    }
    if (!matches.length) {
      EL.matchSummary.textContent = '0 个匹配';
      EL.matchList.innerHTML = '<li class="empty">没有匹配到内容。<br>检查是否需要 <code>g</code> <code>i</code> <code>m</code> 等标志，或者表达式过于严格。</li>';
      return;
    }

    const summary = ['共 ' + matches.length + ' 处匹配'];
    const groupCount = matches[0].length - 1;
    if (groupCount > 0) summary.push(groupCount + ' 个捕获组');
    if (state.elapsed > 0) summary.push(state.elapsed.toFixed(state.elapsed < 10 ? 2 : 0) + ' ms');
    if (summaryBits.length) summary.push(summaryBits.join('；'));
    EL.matchSummary.textContent = summary.join(' · ');

    const names = groupNamesOf(state.pattern);
    const lineOf = state.text.length < 1000000 ? lineIndex(state.text) : null;
    const rows = Math.min(matches.length, ROW_LIMIT);
    const frag = document.createDocumentFragment();

    for (let i = 0; i < rows; i++) {
      const m = matches[i];
      const li = document.createElement('li');
      li.className = 'match-item' + (i === state.active ? ' active' : '');
      li.dataset.i = String(i);

      const start = m.index;
      const end = start + m[0].length;
      const head = [];
      head.push('<span class="match-no">#' + (i + 1) + '</span>');
      head.push('<span>' + (m[0].length ? '位置 ' + start + '–' + end + ' · 长度 ' + m[0].length : '空匹配 · 位置 ' + start) + '</span>');
      if (lineOf) head.push('<span>第 ' + lineOf(start) + ' 行</span>');

      let groupsHTML = '';
      for (let g = 1; g < m.length; g++) {
        const info = groupValue(m, g);
        const label = names[g - 1] ? '组 ' + g + ' · ' + names[g - 1] : '组 ' + g;
        const cls = 'g' + (((g - 1) % 4) + 1);
        const val = info.value == null
          ? '<span class="group-val">（未参与匹配）</span>'
          : '<span class="group-val">' + esc(info.value) + '<span style="opacity:.6">' + esc(info.pos) + '</span></span>';
        groupsHTML += '<div class="group-line ' + cls + '"><span class="group-key">' + esc(label) + '</span>' + val + '</div>';
      }

      li.innerHTML =
        '<div class="match-head">' + head.join('') + '</div>' +
        '<div class="match-text' + (m[0].length ? '' : ' empty') + '">' + (m[0].length ? esc(m[0]) : '∅ 空匹配') + '</div>' +
        groupsHTML;
      frag.appendChild(li);
    }
    EL.matchList.appendChild(frag);

    if (matches.length > rows) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '共 ' + matches.length + ' 条，仅列出前 ' + rows + ' 条';
      EL.matchList.appendChild(li);
    }
  }

  function setActive(index) {
    state.active = index;
    $$('.match-item', EL.matchList).forEach((el) => {
      el.classList.toggle('active', Number(el.dataset.i) === index);
    });
    renderHighlight();
    if (index >= 0 && state.matches[index]) {
      revealInEditor(state.matches[index].index);
    }
  }

  /* ================= 替换 ================= */

  function renderReplace() {
    const text = state.text;
    const regex = state.regex;
    if (!regex || !text || state.compileError) {
      EL.replOut.textContent = '';
      EL.replMeta.textContent = '';
      return;
    }
    const replacement = EL.replInput.value;
    try {
      const out = text.replace(regex, replacement);
      EL.replOut.textContent = out;
      const count = state.matches.length;
      EL.replMeta.textContent = (regex.global
        ? '替换 ' + count + ' 处'
        : '未开启 g，仅替换第 1 处') + (out ? '' : '，结果为空');
    } catch (e) {
      EL.replOut.textContent = '替换失败：' + e.message;
      EL.replMeta.textContent = '';
    }
  }

  /* ================= 主流程 ================= */

  function showStatus(kind, html) {
    if (!html) {
      EL.status.className = 'status';
      EL.status.innerHTML = '';
      return;
    }
    EL.status.className = 'status show -' + kind;
    EL.status.innerHTML = html;
  }

  function render() {
    const pattern = EL.pattern.value;
    const rawFlags = EL.flags.value;
    const text = EL.text.value;

    state.pattern = pattern;
    state.text = text;
    syncFlagUI();

    const bad = invalidFlagChars(rawFlags);
    const flags = validFlags(rawFlags);
    state.flags = flags;

    const compiled = compile(pattern, flags);
    state.regex = compiled.regex;
    state.compileError = compiled.error;
    state.errorInfo = null;
    state.truncated = false;
    state.slow = false;

    if (!bad.length) {
      if (!pattern) {
        showStatus('', '');
      } else if (compiled.error) {
        const info = describeError(compiled.error, pattern);
        state.errorInfo = info;
        showStatus('err', errorHTML(info));
      } else {
        const warnings = patternWarnings(pattern, flags);
        if (warnings.length) {
          showStatus('warn', warnings.map(esc).join('<br>'));
        } else {
          showStatus('', '');
        }
      }
    } else {
      showStatus('warn', '无效的匹配标志：' + esc(bad.join(' ')) + '，仅支持 g i m s u y d v');
    }

    EL.patternBar.classList.toggle('error', Boolean(compiled.error) || bad.length > 0);

    if (compiled.regex && !compiled.error) {
      const result = collect(compiled.regex, text);
      state.matches = result.list;
      state.truncated = result.truncated;
      state.slow = result.slow;
      state.elapsed = result.elapsed;
      const msg = [];
      if (result.truncated) msg.push('匹配数超过 ' + MATCH_LIMIT + ' 条，仅处理前 ' + MATCH_LIMIT + ' 条');
      if (result.slow) msg.push('匹配耗时过长已中止，表达式可能存在灾难性回溯');
      if (msg.length) showStatus('warn', msg.join('；'));
      else if (result.elapsed > 120 && text.length > 2000) {
        showStatus('warn', '本次匹配耗时 ' + result.elapsed.toFixed(0) + ' ms，表达式在长文本上可能偏慢');
      }
    } else {
      state.matches = [];
      state.elapsed = 0;
    }

    if (state.active >= state.matches.length) state.active = -1;

    renderHighlight();
    renderMatchList();
    renderExplain();
    renderCode();
    renderReplace();
    syncScroll();
    updateTextMeta();
    saveHistory(pattern, flags);
    saveState();
  }

  function updateTextMeta() {
    const text = state.text;
    const lines = text ? text.split('\n').length : 0;
    EL.textMeta.textContent = text.length.toLocaleString() + ' 字符 · ' + lines + ' 行';
  }

  /* 表达式体检：语法合法但可能踩坑的写法 */
  function patternWarnings(pattern, flags) {
    const warn = [];
    const hasUnicode = flags.indexOf('u') >= 0 || flags.indexOf('v') >= 0;
    if (/\\[pP]\{/.test(pattern) && !hasUnicode) {
      warn.push('\\p{...} 需要 Unicode 模式，请补上 u 标志');
    }
    if (/\\[AzZG]/.test(pattern)) {
      warn.push('\\A \\z \\Z \\G 是 PCRE 专有锚点，JS 会把它们当成普通字母匹配');
    }
    if (pattern.indexOf('(?#') >= 0) {
      warn.push('注释组 (?#…) 是 PCRE 写法，JS 不支持');
    }
    return warn;
  }

  /* 编译失败时补一句人话提示 */
  function compileHint(pattern) {
    if (/(?<!\\)(?:[*+?]|\{\d+(?:,\d*)?\})\+/.test(pattern)) {
      return 'JS 不支持占有量词（*+ ++ ?+），去掉末尾的 + 试试';
    }
    if (pattern.indexOf('(?>') >= 0) return 'JS 不支持原子组 (?>…)，可改用零宽断言';
    if (/\(\?[imsxU]+[:)]/.test(pattern)) return 'JS 不支持内联标志 (?i)，请把 i / m / s 写进右侧标志栏';
    if (pattern.indexOf('(?P<') >= 0) return 'JS 的命名捕获组写作 (?<name>…)，不是 (?P<name>…)';
    const open = (pattern.match(/[([]/g) || []).length;
    const close = (pattern.match(/[)\]]/g) || []).length;
    if (open !== close) return '括号数量不成对，检查是否漏写 ) 或 ]';
    return '';
  }

  /* ================= 报错中文化 ================= */

  // 浏览器原生报错都是英文，这里按 V8 的错误类型翻译成人话；每条都带对应的修正建议
  const ERROR_MAP = [
    {
      re: /invalid decimal escape/i,
      zh: '无效的十进制转义，\\1 这类反向引用找不到对应的分组',
      hint: '只有被括号捕获过的分组才能用 \\1 引用；字符类 [ ] 里的括号不算分组。想匹配数字 1 请写 \\x31 或 [1]。'
    },
    {
      re: /invalid unicode escape/i,
      zh: 'Unicode 转义写法无效',
      hint: '\\u 后面要跟 4 位十六进制（如 \\u4e00）；\\u{...} 需要 u 标志，码点不超过 10FFFF。'
    },
    {
      re: /invalid escape/i,
      zh: '无效的转义序列',
      hint: '只有 \\d \\w \\s \\b \\n \\t 等是有效转义；要匹配反斜杠本身请连续写两个 \\\\。'
    },
    {
      re: /unterminated character class/i,
      zh: '字符类 [ ] 没有闭合',
      hint: '检查是否漏写了 ]；字符类里的 \\] 是转义，不会结束字符类。'
    },
    {
      re: /range(s)? out of order|class ranges out of order/i,
      zh: '字符类范围顺序颠倒',
      hint: '范围要从小到大写，例如 [a-z]；要匹配 - 本身请写成 [a\\-z] 或把 - 放在最后。'
    },
    {
      re: /invalid character in character class/i,
      zh: '字符类里出现了非法字符',
      hint: 'v 标志下字符类语法更严格，可以先去掉 v 标志再试。'
    },
    {
      re: /invalid character class/i,
      zh: '字符类的写法无效',
      hint: '检查 [ ] 内是否有未转义的特殊字符，例如 [a-z] 里的 - 位置。'
    },
    {
      re: /unterminated group|missing \) in regular expression/i,
      zh: '分组括号 ( 没有闭合',
      hint: '数一数左右括号是否成对；字符类 [ ] 里的括号不需要配对。'
    },
    {
      re: /unmatched ['"]?\)['"]?/i,
      zh: '多了一个右括号 )',
      hint: '检查是否多写或位置错了 )。'
    },
    {
      re: /nothing to repeat/i,
      zh: '量词前面没有可重复的内容',
      hint: '* + ? {n} 必须跟在字符、字符类或分组后面，不能写在表达式开头。'
    },
    {
      re: /lone quantifier brackets/i,
      zh: '量词的花括号 { } 不完整或位置不对',
      hint: '量词要写成 {2}、{2,}、{2,5} 这种完整形式，单独出现的 { 或 } 需要转义。'
    },
    {
      re: /numbers out of order/i,
      zh: '量词 {m,n} 的数值顺序颠倒',
      hint: '上限不能小于下限，例如 {5,2} 应改成 {2,5}。'
    },
    {
      re: /incomplete quantifier|invalid quantifier/i,
      zh: '量词写法不完整',
      hint: '常见的完整写法是 * + ? {n} {n,} {n,m}。'
    },
    {
      re: /invalid capture group name/i,
      zh: '捕获组名字不合法',
      hint: '命名分组 (?<name>…) 只能使用字母、数字、下划线或 $，且不能以数字开头。'
    },
    {
      re: /duplicate capture group name/i,
      zh: '捕获组名字重复',
      hint: '同一个表达式里命名分组不能重名，改成不同的名字即可。'
    },
    {
      re: /invalid named capture referenced|invalid named reference/i,
      zh: '引用的命名分组不存在',
      hint: '\\k<name> 里的 name 必须是前面已经定义过的 (?<name>…)。'
    },
    {
      re: /invalid (class )?property name/i,
      zh: 'Unicode 属性名无效',
      hint: '\\p{...} 里的属性名要写对，例如 \\p{L}、\\p{Script=Han}，并且需要 u 标志。'
    },
    {
      re: /invalid back reference/i,
      zh: '反向引用无效',
      hint: '反向引用的编号不能超过表达式中捕获组的数量。'
    },
    {
      re: /invalid set operation/i,
      zh: '字符类集合运算写法有误',
      hint: '集合运算（交集 &&、相减 --）只在 v 标志下可用，语法与 u 模式不同。'
    },
    {
      re: /invalid group/i,
      zh: '分组语法无效',
      hint: '(? 后面只能跟 : < = ! > 等合法字符，检查是否写错。'
    },
    {
      re: /invalid (regular expression )?flags/i,
      zh: '标志无效',
      hint: '只支持 g i m s u y d v 这八个标志，且不能重复。'
    },
    {
      re: /regular expression too large/i,
      zh: '表达式过大',
      hint: '尝试拆分或简化表达式。'
    }
  ];

  // 去掉 V8 消息里的 "/pattern/flags: " 前缀（前缀会把整条长表达式重复一遍，很长）
  function plainErrorText(msg) {
    const text = String(msg || '');
    const m = text.match(/^Invalid regular expression:?\s*\/[\s\S]*\/[a-z]*:\s*([\s\S]*)$/i);
    if (m) return m[1].trim();
    return text.replace(/^Invalid regular expression:?\s*/i, '').trim();
  }

  // 去掉字符类内容，避免 [a*+] 这种写法被当成占有量词
  function stripClasses(pattern) {
    let out = '';
    let inClass = false;
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern.charAt(i);
      if (ch === '\\') {
        if (!inClass) out += pattern.substr(i, 2);
        i++;
        continue;
      }
      if (inClass) {
        if (ch === ']') inClass = false;
        continue;
      }
      if (ch === '[') { inClass = true; continue; }
      out += ch;
    }
    return out;
  }

  // JS 引擎完全不支持的写法：V8 只会报 "Nothing to repeat" / "Invalid group"，先说清真正原因
  function unsupportedSyntax(pattern) {
    if (/(?<!\\)(?:[*+?]|\{\d+(?:,\d*)?\})\+/.test(pattern)) {
      return {
        title: 'JS 不支持占有量词（*+ ++ ?+ {n,m}+）',
        hint: '去掉量词末尾的 + 即可；浏览器正则没有不回溯的贪婪量词。'
      };
    }
    if (pattern.indexOf('(?>') >= 0) {
      return {
        title: 'JS 不支持原子组 (?>…)',
        hint: '把原子组换成零宽断言，或调整表达式结构避免回溯问题。'
      };
    }
    if (/\(\?[imsxU]+[:)]/.test(pattern)) {
      return {
        title: 'JS 不支持内联标志 (?i) 这类写法',
        hint: '把 i / m / s 写进输入框后面的标志栏，例如 /abc/i。'
      };
    }
    if (pattern.indexOf('(?P<') >= 0) {
      return {
        title: 'JS 的命名捕获组要写成 (?<name>…)，不是 (?P<name>…)',
        hint: '(?P<…) 是 Python / PHP 的写法，把 P 去掉即可。'
      };
    }
    return null;
  }

  function describeError(rawMsg, pattern) {
    const core = plainErrorText(rawMsg);
    const special = unsupportedSyntax(stripClasses(pattern));
    if (special) return { title: special.title, hint: special.hint, core: core || '未知错误' };
    const hit = ERROR_MAP.filter(function (item) { return item.re.test(core); })[0] || null;
    return {
      title: hit ? hit.zh : '表达式无法编译',
      hint: (hit && hit.hint) || compileHint(pattern) || '检查括号、方括号、量词是否完整。',
      core: core || '未知错误'
    };
  }

  function errorHTML(info) {
    return '<span class="status-msg"><b>正则语法错误：' + esc(info.title) + '</b>' +
      (info.hint ? '<br><span class="status-hint">建议：' + esc(info.hint) + '</span>' : '') +
      '<span class="raw">原始信息：' + esc(info.core) + '</span></span>';
  }

  /* ================= 关键字解释 ================= */

  const CLASS_ESCAPE = {
    d: '数字 0-9',
    D: '非数字',
    w: '字母、数字或下划线',
    W: '非单词字符',
    s: '空白字符（空格 / 制表 / 换行）',
    S: '非空白字符',
    h: '水平空白',
    H: '非水平空白',
    v: '垂直空白',
    V: '非垂直空白',
    b: '退格符',
    n: '换行符 LF',
    r: '回车符 CR',
    t: '制表符 Tab',
    f: '换页符',
    p: 'Unicode 属性',
    P: '非 Unicode 属性'
  };

  function charOf(code) {
    if (!isFinite(code) || code < 32 || code > 0x10ffff) return '';
    try { return String.fromCodePoint(code); } catch (e) { return ''; }
  }

  function readEscape(src, i) {
    const c = src.charAt(i + 1);
    if (!c) return { text: '\\', desc: '孤立的转义符，表达式可能不完整' };

    if (c === 'u') {
      if (src.charAt(i + 2) === '{') {
        const close = src.indexOf('}', i + 3);
        if (close > 0) {
          const hex = src.slice(i + 3, close);
          const code = parseInt(hex, 16);
          const ch = charOf(code);
          return { text: src.slice(i, close + 1), desc: 'Unicode 码点 U+' + hex.toUpperCase() + (ch ? '（' + ch + '）' : '') };
        }
      }
      const hex = src.substr(i + 2, 4);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { text: '\\u', desc: 'Unicode 转义需要 4 位十六进制，写法不完整' };
      const code = parseInt(hex, 16);
      const ch = charOf(code);
      return { text: '\\u' + hex, desc: 'Unicode 字符 U+' + hex.toUpperCase() + (ch ? '（' + ch + '）' : '') };
    }

    if (c === 'x') {
      const hex = src.substr(i + 2, 2);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) return { text: '\\x', desc: '十六进制转义需要 2 位，写法不完整' };
      const code = parseInt(hex, 16);
      return { text: '\\x' + hex, desc: '十六进制字符 ' + hex.toUpperCase() + '（' + charOf(code) + '）' };
    }

    if (c === 'p' || c === 'P') {
      const close = src.indexOf('}', i + 3);
      if (src.charAt(i + 2) === '{' && close > 0) {
        const prop = src.slice(i + 3, close);
        return {
          text: src.slice(i, close + 1),
          desc: (c === 'p' ? '匹配' : '不匹配') + ' Unicode 属性 <b>' + esc(prop) + '</b>（需要 u 标志）'
        };
      }
      return { text: '\\' + c, desc: 'Unicode 属性需要写成 \\p{属性名}' };
    }

    if (c === 'k') {
      const close = src.indexOf('>', i + 3);
      if (src.charAt(i + 2) === '<' && close > 0) {
        const name = src.slice(i + 3, close);
        return { text: src.slice(i, close + 1), desc: '反向引用命名分组 <b>' + esc(name) + '</b>' };
      }
      return { text: '\\k', desc: '命名反向引用需要写成 \\k<名字>' };
    }

    if (c >= '1' && c <= '9') {
      let j = i + 1;
      while (j < src.length && /[0-9]/.test(src.charAt(j))) j++;
      const num = src.slice(i + 1, j);
      return { text: src.slice(i, j), desc: '反向引用：再次匹配第 ' + num + ' 个捕获组的内容' };
    }

    if (c === '0') return { text: '\\0', desc: '空字符 NUL' };
    if (c === 'n') return { text: '\\n', desc: '换行符 LF（0x0A）' };
    if (c === 'r') return { text: '\\r', desc: '回车符 CR（0x0D）' };
    if (c === 't') return { text: '\\t', desc: '制表符 Tab' };
    if (c === 'f') return { text: '\\f', desc: '换页符' };
    if (c === 'v') return { text: '\\v', desc: '垂直制表符' };

    if (c === 'b') return { text: '\\b', desc: '单词边界（位置，不占字符）' };
    if (c === 'B') return { text: '\\B', desc: '非单词边界（位置，不占字符）' };
    if (c === 'A') return { text: '\\A', desc: '文本开头（PCRE 专有，JS 里表示字母 A）' };
    if (c === 'z') return { text: '\\z', desc: '文本结尾（PCRE 专有，JS 里表示字母 z）' };
    if (c === 'Z') return { text: '\\Z', desc: '文本结尾或末尾换行前（PCRE 专有）' };
    if (c === 'G') return { text: '\\G', desc: '上一次匹配结束的位置（PCRE 专有）' };
    if (c === 'K') return { text: '\\K', desc: '重置匹配起点（PCRE 专有）' };

    if (c === 'd' || c === 'D' || c === 'w' || c === 'W' || c === 's' || c === 'S' ||
        c === 'h' || c === 'H') {
      return { text: '\\' + c, desc: CLASS_ESCAPE[c] || '预定义字符类' };
    }

    return { text: '\\' + c, desc: '转义字符，只匹配字面量 <b>' + esc(c) + '</b>' };
  }

  function describeClassBody(body) {
    const neg = body.charAt(0) === '^';
    const s = neg ? body.slice(1) : body;
    const items = [];
    for (let i = 0; i < s.length; i++) {
      const ch = s.charAt(i);
      if (ch === '\\') {
        const next = s.charAt(i + 1);
        items.push(CLASS_ESCAPE[next] || ('字面 ' + next));
        i++;
        continue;
      }
      if (s.charAt(i + 1) === '-' && i + 2 < s.length) {
        items.push(ch + '–' + s.charAt(i + 2));
        i += 2;
        continue;
      }
      items.push(ch);
    }
    if (!items.length) return '空字符类（永远匹配不到）';
    const shown = items.slice(0, 8).join('、') + (items.length > 8 ? ' 等' : '');
    return (neg ? '排除 ' : '匹配 ') + shown + ' 中任一字符';
  }

  function readClass(src, i) {
    let j = i + 1;
    if (src.charAt(j) === '^') j++;
    if (src.charAt(j) === ']') j++;
    let closed = false;
    while (j < src.length) {
      const ch = src.charAt(j);
      if (ch === '\\') { j += 2; continue; }
      if (ch === ']') { closed = true; break; }
      j++;
    }
    const end = closed ? j + 1 : src.length;
    return {
      text: src.slice(i, end),
      desc: '字符类（' + esc(describeClassBody(src.slice(i + 1, closed ? j : src.length))) + '）'
    };
  }

  function readGroupOpen(src, i, groupNo) {
    const next = src.charAt(i + 1);
    if (next !== '?') {
      return { text: '(', desc: '第 <b>' + (groupNo + 1) + '</b> 个捕获组开始（会保存匹配内容）', open: true, capture: true };
    }
    const rest = src.slice(i + 2);

    if (rest.charAt(0) === ':') return { text: '(?:', desc: '非捕获组：只用来分组或配合量词，不保存内容', open: true };
    if (rest.charAt(0) === '=') return { text: '(?=', desc: '正向先行断言：右边必须紧跟，但不消耗字符', open: true };
    if (rest.charAt(0) === '!') return { text: '(?!', desc: '负向先行断言：右边不能是', open: true };
    if (rest.slice(0, 2) === '<=') return { text: '(?<=', desc: '正向后行断言：左边必须是', open: true };
    if (rest.slice(0, 2) === '<!') return { text: '(?<!', desc: '负向后行断言：左边不能是', open: true };
    if (rest.charAt(0) === '>') return { text: '(?>', desc: '原子组：禁止回溯（PCRE / Java 支持，JS 不支持）', open: true };
    if (rest.charAt(0) === '#') return { text: '(?#', desc: '注释组：写给人看，直到 ) 为止', open: true };
    if (rest.charAt(0) === '|') return { text: '(?|', desc: '分支重置组：每个分支都从第 1 组开始计数（PCRE）', open: true, capture: true };

    let m = /^<([A-Za-z_$][\w$]*)>/.exec(rest);
    if (m) return { text: '(?<' + m[1] + '>', desc: '命名捕获组 <b>' + esc(m[1]) + '</b> 开始', open: true, capture: true };

    m = /^P<([A-Za-z_$][\w$]*)>/.exec(rest);
    if (m) return { text: '(?P<' + m[1] + '>', desc: 'Python 风格命名捕获组 <b>' + esc(m[1]) + '</b>（JS 需写成 (?<' + esc(m[1]) + '>））', open: true, capture: true };

    m = /^[imsxUa-]+[:)]/.exec(rest);
    if (m) return { text: '(' + src.slice(i + 1, i + 2 + m[0].length - 1), desc: '内联标志 / 注释（PCRE 专有，JS 不支持）', open: true };

    return { text: '(?', desc: '特殊分组语法', open: true };
  }

  function readQuantifier(src, i) {
    const ch = src.charAt(i);
    let text = ch;
    let desc = '';

    if (ch === '*') desc = '重复 0 次或多次';
    else if (ch === '+') desc = '重复 1 次或多次';
    else if (ch === '?') desc = '重复 0 次或 1 次';
    else {
      const m = /^\{(\d+)(?:,(\d*))?\}/.exec(src.slice(i));
      if (!m) return null;
      text = m[0];
      if (m[2] === undefined) desc = '恰好重复 ' + m[1] + ' 次';
      else if (m[2] === '') desc = '至少重复 ' + m[1] + ' 次';
      else desc = '重复 ' + m[1] + ' 到 ' + m[2] + ' 次';
    }

    const next = src.charAt(i + text.length);
    if (next === '?') {
      text += '?';
      desc += '，懒惰模式（尽量少匹配）';
    } else if (next === '+') {
      text += '+';
      desc += '，占有模式（不回退，JS 不支持）';
    }
    return { text: text, desc: desc };
  }

  function explainPattern(src) {
    const out = [];
    let i = 0;
    let depth = 0;
    let groupNo = 0;
    const specials = '\\[](){}*+?|^$.';

    while (i < src.length) {
      const ch = src.charAt(i);

      if (ch === '\\') {
        const t = readEscape(src, i);
        out.push({ type: 'escape', text: t.text, desc: t.desc, depth: depth });
        i += Math.max(1, t.text.length);
        continue;
      }

      if (ch === '[') {
        const t = readClass(src, i);
        out.push({ type: 'class', text: t.text, desc: t.desc, depth: depth });
        i += Math.max(1, t.text.length);
        continue;
      }

      if (ch === '(') {
        const t = readGroupOpen(src, i, groupNo);
        out.push({ type: 'group', text: t.text, desc: t.desc, depth: depth });
        if (t.open) depth++;
        if (t.capture) groupNo++;
        i += t.text.length;
        continue;
      }

      if (ch === ')') {
        depth = Math.max(0, depth - 1);
        out.push({ type: 'group', text: ')', desc: '分组结束', depth: depth });
        i++;
        continue;
      }

      if (ch === '*' || ch === '+' || ch === '?' || ch === '{') {
        const q = readQuantifier(src, i);
        if (q) {
          const prev = out.length ? out[out.length - 1].text : '';
          out.push({
            type: 'quant',
            text: q.text,
            desc: '量词：前面的 ' + (prev ? '<b>' + esc(prev) + '</b> ' : '') + q.desc,
            depth: depth
          });
          i += q.text.length;
          continue;
        }
      }

      if (ch === '|') {
        out.push({ type: 'alt', text: '|', desc: '或：左右两边任选其一', depth: depth });
        i++;
        continue;
      }

      if (ch === '^') {
        out.push({ type: 'anchor', text: '^', desc: '开头位置（m 模式下为每行行首）', depth: depth });
        i++;
        continue;
      }

      if (ch === '$') {
        out.push({ type: 'anchor', text: '$', desc: '结尾位置（m 模式下为每行行尾）', depth: depth });
        i++;
        continue;
      }

      if (ch === '.') {
        out.push({ type: 'any', text: '.', desc: '任意字符（默认不含换行，s 模式下包含换行）', depth: depth });
        i++;
        continue;
      }

      let j = i;
      while (j < src.length && specials.indexOf(src.charAt(j)) < 0) j++;
      if (j === i) j = i + 1;
      const lit = src.slice(i, j);
      out.push({ type: 'literal', text: lit, desc: '字面量「' + esc(lit) + '」', depth: depth });
      i = j;
    }
    return out;
  }

  function renderExplain() {
    if (!state.pattern) {
      EL.explainList.innerHTML = '<li class="empty">输入正则表达式后，这里会逐段解释每个记号的含义。</li>';
      return;
    }
    const tokens = explainPattern(state.pattern);
    if (!tokens.length) {
      EL.explainList.innerHTML = '<li class="empty">表达式为空。</li>';
      return;
    }
    EL.explainList.innerHTML = tokens.map(function (t) {
      const ind = Math.min(t.depth, 8);
      return '<li class="explain-row" style="--d:' + ind + '">' +
        '<code class="t-' + t.type + '">' + esc(t.text) + '</code>' +
        '<span class="desc">' + t.desc + '</span>' +
        '</li>';
    }).join('');
  }

  /* ================= 代码生成 ================= */

  const LANGS = [
    { id: 'js', label: 'JavaScript' },
    { id: 'python', label: 'Python' },
    { id: 'java', label: 'Java' },
    { id: 'php', label: 'PHP' },
    { id: 'go', label: 'Go' },
    { id: 'cs', label: 'C#' },
    { id: 'rust', label: 'Rust' },
    { id: 'ruby', label: 'Ruby' },
    { id: 'grep', label: '命令行 grep' }
  ];

  const SYNTAX = {
    js: { kw: ['const', 'let', 'var', 'for', 'of', 'in', 'if', 'else', 'return', 'new', 'function', 'null', 'undefined'], hash: false },
    python: { kw: ['import', 'from', 'as', 'for', 'in', 'if', 'else', 'return', 'def', 'print', 'None', 'True', 'False'], hash: true },
    java: { kw: ['import', 'public', 'class', 'static', 'void', 'new', 'if', 'else', 'while', 'return', 'String', 'System', 'out', 'println', 'Pattern', 'Matcher'], hash: false },
    php: { kw: ['preg_match_all', 'preg_match', 'print_r', 'foreach', 'as', 'function', 'echo', 'array'], hash: false },
    go: { kw: ['package', 'import', 'func', 'main', 'for', 'range', 'var', 'return', 'string', 'fmt', 'regexp'], hash: false },
    cs: { kw: ['using', 'var', 'new', 'foreach', 'in', 'if', 'return', 'string', 'Console', 'WriteLine', 'Regex', 'RegexOptions', 'Match'], hash: false },
    rust: { kw: ['use', 'fn', 'main', 'let', 'for', 'in', 'mut', 'println', 'Regex'], hash: false },
    ruby: { kw: ['require', 'each', 'do', 'end', 'puts', 'scan', 'new'], hash: true },
    grep: { kw: ['grep', 'printf', 'echo'], hash: true }
  };

  const CODE_TOKEN_RE = /("(?:[^"\x5c]|\x5c.)*"|'(?:[^'\x5c]|\x5c.)*'|`(?:[^`\x5c]|\x5c.)*`)|(\/\/.*|\/\*[\s\S]*?\*\/|#.*)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;

  function highlightCode(code, lang) {
    const cfg = SYNTAX[lang] || { kw: [], hash: false };
    const kw = Object.create(null);
    cfg.kw.forEach(function (w) { kw[w] = true; });
    let out = '';
    let last = 0;
    let m;
    CODE_TOKEN_RE.lastIndex = 0;
    while ((m = CODE_TOKEN_RE.exec(code)) !== null) {
      if (m.index > last) out += esc(code.slice(last, m.index));
      const raw = m[0];
      if (m[1]) {
        out += '<span class="s">' + esc(raw) + '</span>';
      } else if (m[2]) {
        out += '<span class="c">' + esc(raw) + '</span>';
      } else if (m[3]) {
        out += '<span class="n">' + esc(raw) + '</span>';
      } else {
        const isFunc = code.charAt(m.index - 1) === '.';
        if (isFunc) out += '<span class="f">' + esc(raw) + '</span>';
        else if (kw[raw]) out += '<span class="k">' + esc(raw) + '</span>';
        else out += esc(raw);
      }
      last = m.index + raw.length;
    }
    if (last < code.length) out += esc(code.slice(last));
    return out;
  }

  function sampleForCode(text) {
    const t = (text || '').trim();
    if (!t) return '';
    return t.length > 280 ? t.slice(0, 280) + '…' : t;
  }

  // C 风格双引号字符串内容转义
  function dq(s) {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      .replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
  }

  // JS 正则字面量：只转义未转义的斜杠；含换行时返回 null（改用 RegExp 构造）
  function jsLiteralSource(src) {
    let out = '';
    for (let i = 0; i < src.length; i++) {
      const ch = src.charAt(i);
      if (ch === '\\') { out += ch + src.charAt(i + 1); i++; continue; }
      if (ch === '/' ) { out += '\\/'; continue; }
      if (ch === '\n' || ch === '\r') return null;
      out += ch;
    }
    return out;
  }

  // Python 字符串：优先原始字符串，含换行时用三引号
  function pyString(s) {
    const tail = /\\+$/.exec(s);
    const trailingBackslash = tail && tail[0].length % 2 === 1;
    if (trailingBackslash) return '"' + dq(s) + '"';
    const multiline = s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0;
    if (!multiline) {
      if (s.indexOf("'") < 0) return "r'" + s + "'";
      if (s.indexOf('"') < 0) return 'r"' + s + '"';
    }
    if (s.indexOf("'''") < 0) return "r'''" + s + "'''";
    if (s.indexOf('"""') < 0) return 'r"""' + s + '"""';
    return '"' + dq(s) + '"';
  }

  function goString(s) {
    if (s.indexOf('`') < 0) return '`' + s + '`';
    return '"' + dq(s) + '"';
  }

  function inlineFlags(flags, supported) {
    let out = '';
    for (const ch of supported) {
      if (flags.indexOf(ch) >= 0) out += ch;
    }
    return out ? '(?' + out + ')' : '';
  }

  function buildCode(lang) {
    const p = state.pattern;
    const flags = state.flags;
    const sample = sampleForCode(state.text);
    const warns = compatWarnings(p, flags, lang);
    let code = '';
    let note = '';

    switch (lang) {
      case 'js': {
        const src = jsLiteralSource(p);
        const textVal = JSON.stringify(sample);
        const tail = flags.indexOf('g') >= 0
          ? 'for (const m of text.matchAll(regex)) {\n  console.log(m[0], m.index, m.groups ?? {});\n}'
          : 'const m = regex.exec(text);\nif (m) console.log(m[0], m.index, m.groups ?? {});';
        if (src === null) {
          note = '表达式含换行，已改用 RegExp 构造函数';
          code = 'const regex = new RegExp(' + JSON.stringify(p) + ', ' + JSON.stringify(flags) + ');\n' +
            'const text = ' + textVal + ';\n\n' + tail;
        } else {
          code = 'const regex = /' + src + '/' + flags + ';\nconst text = ' + textVal + ';\n\n' + tail;
        }
        break;
      }
      case 'python': {
        const opts = [];
        if (flags.indexOf('i') >= 0) opts.push('re.IGNORECASE');
        if (flags.indexOf('m') >= 0) opts.push('re.MULTILINE');
        if (flags.indexOf('s') >= 0) opts.push('re.DOTALL');
        let pat = p;
        if (flags.indexOf('x') >= 0) opts.push('re.VERBOSE');
        const line = 'pattern = re.compile(' + pyString(pat) + (opts.length ? ', ' + opts.join(' | ') : '') + ')';
        code = 'import re\n\n' + line + '\n' +
          (sample ? 'text = ' + pyString(sample) + '\n' : 'text = ""\n') + '\n' +
          'for m in pattern.finditer(text):\n' +
          '    print(m.group(0), m.start(), m.groupdict())';
        break;
      }
      case 'java': {
        const opts = [];
        if (flags.indexOf('i') >= 0) opts.push('Pattern.CASE_INSENSITIVE');
        if (flags.indexOf('m') >= 0) opts.push('Pattern.MULTILINE');
        if (flags.indexOf('s') >= 0) opts.push('Pattern.DOTALL');
        code = 'import java.util.regex.*;\n\n' +
          'String text = "' + dq(sample) + '";\n' +
          'Pattern p = Pattern.compile("' + dq(p) + '"' + (opts.length ? ', ' + opts.join(' | ') : '') + ');\n' +
          'Matcher m = p.matcher(text);\n' +
          'while (m.find()) {\n' +
          '    System.out.println(m.group() + " @" + m.start());\n' +
          '}';
        break;
      }
      case 'php': {
        let phpFlags = '';
        ['i', 'm', 's', 'x', 'u'].forEach(function (f) { if (flags.indexOf(f) >= 0) phpFlags += f; });
        // 选一个表达式里不存在的分隔符，省去转义麻烦
        const delim = p.indexOf('/') < 0 ? '/' : (p.indexOf('#') < 0 ? '#' : '~');
        const sq = function (s) {
          return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
        };
        const all = flags.indexOf('g') >= 0;
        code = '$pattern = ' + sq(delim + p + delim + phpFlags) + ';\n' +
          '$text = "' + dq(sample).replace(/\$/g, '\\$') + '";\n\n' +
          (all
            ? 'preg_match_all($pattern, $text, $matches, PREG_SET_ORDER);\nprint_r($matches);'
            : 'if (preg_match($pattern, $text, $m)) {\n    print_r($m);\n}');
        break;
      }
      case 'go': {
        const pre = inlineFlags(flags, 'ims');
        code = 'package main\n\nimport (\n\t"fmt"\n\t"regexp"\n)\n\n' +
          'func main() {\n' +
          '\tre := regexp.MustCompile(' + goString(pre + p) + ')\n' +
          '\ttext := ' + goString(sample || '') + '\n' +
          '\tfor _, m := range re.FindAllStringSubmatch(text, -1) {\n' +
          '\t\tfmt.Println(m)\n\t}\n}';
        break;
      }
      case 'cs': {
        const opts = [];
        if (flags.indexOf('i') >= 0) opts.push('RegexOptions.IgnoreCase');
        if (flags.indexOf('m') >= 0) opts.push('RegexOptions.Multiline');
        if (flags.indexOf('s') >= 0) opts.push('RegexOptions.Singleline');
        code = 'using System.Text.RegularExpressions;\n\n' +
          'var text = "' + dq(sample) + '";\n' +
          'var regex = new Regex(@"' + p.replace(/"/g, '""') + '"' + (opts.length ? ', ' + opts.join(' | ') : '') + ');\n\n' +
          'foreach (Match m in regex.Matches(text))\n{\n    Console.WriteLine($"{m.Value} @{m.Index}");\n}';
        break;
      }
      case 'rust': {
        const pre = inlineFlags(flags, 'ims');
        const pat = pre + p;
        const patVal = pat.indexOf('"#') >= 0 ? '"' + dq(pat) + '"' : 'r#"' + pat + '"#';
        const textVal = sample.indexOf('"#') >= 0 ? '"' + dq(sample) + '"' : 'r#"' + sample + '"#';
        code = 'use regex::Regex;\n\nfn main() {\n' +
          '    let re = Regex::new(' + patVal + ').unwrap();\n' +
          '    let text = ' + textVal + ';\n\n' +
          '    for cap in re.captures_iter(text) {\n        println!("{:?}", &cap[0]);\n    }\n}';
        break;
      }
      case 'ruby': {
        const body = jsLiteralSource(p);
        const rubyFlags = ['i', 'm', 'x'].filter(function (f) { return flags.indexOf(f) >= 0; }).join('');
        const textVal = sample ? '"' + dq(sample) + '"' : '""';
        const tail = flags.indexOf('g') >= 0
          ? 'text.scan(pattern) { |m| puts m.inspect }'
          : 'if (md = pattern.match(text))\n  puts md[0]\nend';
        code = 'pattern = /' + (body === null ? p : body) + '/' + rubyFlags + '\n' +
          'text = ' + textVal + '\n\n' + tail;
        break;
      }
      case 'grep':
      default: {
        const grepFlags = 'Po' + (flags.indexOf('i') >= 0 ? 'i' : '');
        const shq = function (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };
        const cmd = 'grep -' + grepFlags + ' ' + shq(p) + ' 文件.txt';
        const demo = 'printf ' + shq('%s') + ' ' + shq(sample) + ' | grep -' + grepFlags + ' ' + shq(p);
        code = '# 需要 GNU grep 的 -P（PCRE）支持\n' + cmd + '\n\n# 直接测试一段文本\n' + demo;
        break;
      }
    }

    return { code: code, warns: warns, note: note || (LANGS.filter(function (l) { return l.id === lang; })[0] || {}).label };
  }

  function compatWarnings(pattern, flags, lang) {
    const has = function (re) { return re.test(pattern); };
    const lookahead = has(/\(\?[=!]/);
    const lookbehind = has(/\(\?<[=!]/);
    const backref = has(/\\[1-9]/);
    const namedAngle = has(/\(\?<[A-Za-z_$][\w$]*>/);
    const namedPy = has(/\(\?P</);
    const atomic = has(/\(\?>/);
    const possessive = has(/(?<!\\)(?:[*+?]|\{\d+(?:,\d*)?\})\+/);
    const unicodeProp = has(/\\[pP]\{/);
    const kRef = has(/\\k</);
    const w = [];

    if (lang === 'js') {
      if (atomic) w.push('JS 不支持原子组 (?>…)，可改用零宽断言或调整结构');
      if (possessive) w.push('JS 不支持占有量词 *+ ++ ?+ {n,m}+');
      if (namedPy) w.push('JS 的命名捕获组写作 (?<name>…)，不是 (?P<name>…)');
      if (unicodeProp && flags.indexOf('u') < 0 && flags.indexOf('v') < 0) w.push('\\p{…} 在 JS 中需要 u 标志');
      if (has(/\\[AzZGK]/)) w.push('\\A \\z \\Z \\G \\K 是 PCRE 专有写法，JS 里会被当成普通字母');
    } else if (lang === 'go' || lang === 'rust') {
      if (lookahead || lookbehind) w.push('RE2 引擎不支持前瞻 / 后顾断言，这两种语言里需要改写逻辑');
      if (backref) w.push('RE2 引擎不支持反向引用 \\1');
      if (lang === 'rust' && namedAngle) w.push('Rust 的命名捕获组写作 (?P<name>…)');
      if (lang === 'go' && namedAngle) w.push('Go 可用 (?P<name>…)，1.22 起也支持 (?<name>…)');
      if (has(/\\[pP]\{/)) w.push('Unicode 属性支持有限，只有部分 \\p{…} 可用');
    } else if (lang === 'python') {
      if (namedAngle) w.push('Python 的命名捕获组写作 (?P<name>…)，(?<name>…) 会报错');
      if (kRef) w.push('Python 引用命名组写作 (?P=name)');
      if (lookbehind) w.push('Python 的后行断言必须定长，不能用 * 或 +');
    } else if (lang === 'java') {
      if (namedPy) w.push('Java 的命名捕获组写作 (?<name>…)');
      if (has(/\\[zZ]/)) w.push('Java 用 \\z 表示文本结尾，\\Z 表示结尾前的换行位置');
      if (lookbehind && has(/\(\?<=[^)]*[*+]/)) w.push('Java 的后行断言长度必须有限，不能使用 * 或 +');
    } else if (lang === 'php') {
      if (namedAngle && !namedPy) w.push('PHP（PCRE）两种命名组语法都支持，但建议统一用 (?P<name>…)');
      if (has(/\(\?<?[=!][^)]*[*+]/)) w.push('后行断言在旧版 PCRE 中要求定长');
    } else if (lang === 'cs') {
      if (namedPy) w.push('C# 的命名捕获组写作 (?<name>…)');
      if (atomic || possessive) w.push('C# 不支持原子组与占有量词');
    } else if (lang === 'ruby') {
      if (namedAngle && !namedPy) w.push('Ruby 的命名捕获组写作 (?<name>…) 或 (?P<name>…)，两者等价');
      if (lookbehind) w.push('Ruby 的后行断言必须定长');
    } else if (lang === 'grep') {
      w.push('grep -P 依赖 PCRE，macOS / BSD 自带 grep 不支持，可改用 pcre2grep');
      if (lookbehind) w.push('旧版 PCRE 要求后行断言定长');
    }

    if (flags.indexOf('y') >= 0) w.push('粘性标志 y 是 JS 专有，其他语言的示例代码已忽略它');
    if (flags.indexOf('v') >= 0) w.push('Unicode 集合标志 v 是较新的 JS 特性，其他语言没有对应写法');
    return w;
  }

  function renderCode() {
    if (!state.pattern) {
      EL.codeWarn.hidden = true;
      EL.codeMeta.textContent = '';
      EL.codeOut.textContent = '// 输入正则表达式后，这里会生成对应语言的示例代码';
      return;
    }
    const built = buildCode(state.lang);
    EL.codeOut.innerHTML = highlightCode(built.code, state.lang);
    const warns = built.warns.slice();
    if (state.compileError) warns.unshift('当前表达式在 JS 中无法编译，生成的代码仅供参考');
    EL.codeWarn.hidden = warns.length === 0;
    EL.codeWarn.innerHTML = warns.length
      ? '<span>⚠</span><ul>' + warns.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
      : '';
    EL.codeMeta.textContent = built.note || '';
  }

  /* ================= 交互与持久化 ================= */

  let renderTimer = 0;
  let saveTimer = 0;
  let historyTimer = 0;
  let historyLoaded = [];

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 20);
  }

  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      textTabs[activeTextTab].text = EL.text.value;
      storageSet(STORE_TABS, {
        active: activeTextTab,
        tabs: textTabs.map(function (tab) {
          return { name: tab.name, text: tab.text.length > 100000 ? '' : tab.text };
        })
      });
      storageSet(STORE_STATE, {
        p: EL.pattern.value,
        f: EL.flags.value,
        lang: state.lang,
        r: EL.replInput.value
      });
    }, 420);
  }

  function saveHistory(pattern, flags) {
    if (!pattern) return;
    clearTimeout(historyTimer);
    historyTimer = setTimeout(function () {
      const list = storageGet(STORE_HISTORY, []);
      const key = pattern + '\u0000' + flags;
      const next = [{ p: pattern, f: flags }].concat(
        Array.isArray(list) ? list.filter(function (it) { return it && (it.p + '\u0000' + it.f) !== key; }) : []
      ).slice(0, 12);
      storageSet(STORE_HISTORY, next);
      historyLoaded = next;
      renderHistory();
    }, 1400);
  }

  function renderHistory() {
    const list = historyLoaded;
    if (!list.length) {
      EL.historyList.innerHTML = '<span class="hint">还没有记录，写过的正则会自动存在本机</span>';
      return;
    }
    EL.historyList.innerHTML = list.map(function (it, i) {
      const label = '/' + (it.p.length > 46 ? it.p.slice(0, 46) + '…' : it.p) + '/' + it.f;
      return '<button class="hchip" type="button" data-hist="' + i + '" title="' + esc(it.p) + '">' + esc(label) + '</button>';
    }).join('');
  }

  function loadPattern(pattern, flags, sample) {
    EL.pattern.value = pattern;
    EL.flags.value = flags == null ? EL.flags.value : flags;
    if (sample != null) {
      const cur = EL.text.value;
      if (!cur.trim() || cur === state.lastSample) {
        EL.text.value = sample;
        state.lastSample = sample;
      }
    }
    state.active = -1;
    render();
  }

  function applyDefaults() {
    EL.pattern.value = DEFAULT_PATTERN;
    EL.flags.value = 'g';
    EL.text.value = DEFAULT_TEXT;
    textTabs[activeTextTab].text = DEFAULT_TEXT;
    EL.replInput.value = '$<user> → $<domain>';
    state.lastSample = DEFAULT_TEXT;
  }

  function restoreState() {
    restoreTextTabs();
    const saved = storageGet(STORE_STATE, null);
    if (!saved) return false;
    EL.pattern.value = saved.p || '';
    EL.flags.value = saved.f || '';
    if (saved.r != null) EL.replInput.value = saved.r;
    if (saved.lang) state.lang = saved.lang;
    return true;
  }

  function readHash() {
    const raw = location.hash.replace(/^#/, '');
    if (!raw) return null;
    const q = new URLSearchParams(raw);
    if (!q.has('p')) return null;
    return { p: q.get('p') || '', f: q.get('f') || '', t: q.get('t') || '' };
  }

  function applyHash() {
    const data = readHash();
    if (!data) return false;
    EL.pattern.value = data.p;
    EL.flags.value = data.f;
    if (data.t) EL.text.value = data.t;
    render();
    return true;
  }

  function shareLink() {
    const hash = '#p=' + encodeURIComponent(EL.pattern.value) +
      '&f=' + encodeURIComponent(EL.flags.value) +
      '&t=' + encodeURIComponent(EL.text.value.slice(0, 4000));
    const url = location.href.split('#')[0] + hash;
    try { history.replaceState(null, '', hash); } catch (e) { /* file:// 下忽略 */ }
    copyText(url);
  }

  function switchTab(name) {
    state.tab = name;
    $$('.tab', EL.tabs).forEach(function (t) {
      const active = t.dataset.tab === name;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
    });
    ['matches', 'explain', 'code'].forEach(function (k) {
      const panel = document.getElementById('panel-' + k);
      if (panel) panel.hidden = k !== name;
    });
  }

  function importFile(file) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      toast('文件超过 4MB，换个小一点的吧');
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      EL.text.value = String(reader.result || '');
      state.active = -1;
      render();
      toast('已导入 ' + file.name);
    };
    reader.onerror = function () { toast('读取失败'); };
    reader.readAsText(file, 'utf-8');
  }

  /* ================= 我的收藏 ================= */

  let favs = [];

  function favKey(pat, flags) {
    return pat + '\u0000' + flags;
  }

  function loadFavs() {
    const raw = storageGet(STORE_FAVS, []);
    favs = Array.isArray(raw) ? raw.filter(function (it) {
      return it && typeof it.id === 'string' && typeof it.pat === 'string';
    }).slice(0, FAV_LIMIT) : [];
  }

  function saveFavs() {
    storageSet(STORE_FAVS, favs);
  }

  function nextFavName() {
    const used = favs.map(function (f) { return f.name; });
    let n = favs.length + 1;
    while (used.indexOf('我的正则 ' + n) >= 0) n++;
    return '我的正则 ' + n;
  }

  // 同一条表达式重复收藏当作更新，列表里不会出现两条一模一样的
  function addFav(name) {
    const pat = EL.pattern.value;
    if (!pat) {
      toast('先写一条正则再收藏');
      return;
    }
    const flags = validFlags(EL.flags.value);
    const label = String(name || '').trim().slice(0, 30) || nextFavName();
    const key = favKey(pat, flags);
    const at = favs.map(function (f) { return favKey(f.pat, f.flags); }).indexOf(key);
    const entry = {
      id: at >= 0 ? favs[at].id : 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: label,
      pat: pat,
      flags: flags,
      sample: EL.text.value.slice(0, 2000),
      ts: Date.now()
    };
    if (at >= 0) {
      favs[at] = entry;
    } else {
      favs.unshift(entry);
      favs = favs.slice(0, FAV_LIMIT);
    }
    saveFavs();
    renderFavs();
    toast(at >= 0 ? '已更新收藏：' + label : '已收藏：' + label);
  }

  function removeFav(id) {
    const hit = favs.filter(function (f) { return f.id === id; })[0];
    if (!hit) return;
    favs = favs.filter(function (f) { return f.id !== id; });
    saveFavs();
    renderFavs();
    toast('已删除收藏：' + hit.name);
  }

  function renderFavs() {
    const q = EL.libSearch.value.trim().toLowerCase();
    const shown = favs.filter(function (f) {
      if (!q) return true;
      return (f.name + ' ' + f.pat + ' ' + (f.sample || '')).toLowerCase().indexOf(q) >= 0;
    });
    EL.favCount.textContent = favs.length ? '共 ' + favs.length + ' 条' : '';
    EL.favList.innerHTML = shown.map(function (f) {
      const pat = f.pat.length > 68 ? f.pat.slice(0, 68) + '…' : f.pat;
      return '<div class="fav-item">' +
        '<button class="lib-item" type="button" data-fav="' + esc(f.id) + '" title="' + esc('/' + f.pat + '/' + f.flags) + '">' +
        '<span class="lib-name">' + esc(f.name) + '</span>' +
        '<span class="lib-pat">/' + esc(pat) + '/' + esc(f.flags) + '</span>' +
        '</button>' +
        '<button class="fav-del" type="button" data-fav-del="' + esc(f.id) + '" title="删除这条收藏" aria-label="删除这条收藏">×</button>' +
        '</div>';
    }).join('');
    EL.favList.hidden = shown.length === 0;
    EL.favEmpty.hidden = favs.length > 0;
    // 搜索时收藏全被过滤掉就整段收起，不要只剩一个空标题
    EL.favSection.hidden = favs.length > 0 && shown.length === 0 && !!q;
  }

  function openFavForm() {
    if (!EL.pattern.value) {
      toast('先写一条正则再收藏');
      return;
    }
    EL.favForm.hidden = false;
    EL.favName.value = nextFavName();
    EL.favName.focus();
    EL.favName.select();
  }

  function closeFavForm() {
    EL.favForm.hidden = true;
  }

  function loadFav(id) {
    const item = favs.filter(function (f) { return f.id === id; })[0];
    if (!item) return;
    EL.pattern.value = item.pat;
    EL.flags.value = item.flags || '';
    if (item.sample) {
      EL.text.value = item.sample;
      state.lastSample = item.sample;
    }
    state.active = -1;
    render();
    toast('已载入：' + item.name);
    closeModal(EL.libModal);
  }

  /* ================= 弹窗（正则库 / 最近使用） ================= */

  function anyModalOpen() {
    return !EL.libModal.hidden || !EL.histModal.hidden;
  }

  function openModal(modal) {
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    const target = modal.querySelector('.modal-search') || modal.querySelector('.modal-card');
    if (target && target.focus) target.focus();
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    if (!anyModalOpen()) document.body.classList.remove('modal-open');
  }

  // 搜索按名称、表达式、示例文本三段匹配，输入 \d 之类也能命中
  function filterLibrary() {
    const q = EL.libSearch.value.trim().toLowerCase();
    let shown = 0;
    $$('.lib-item', EL.libList).forEach(function (btn) {
      const item = LIBRARY[Number(btn.dataset.lib)];
      if (!item) return;
      const hay = (item.name + ' ' + item.pat + ' ' + (item.sample || '')).toLowerCase();
      const hit = !q || hay.indexOf(q) >= 0;
      btn.hidden = !hit;
      if (hit) shown++;
    });
    EL.libEmpty.hidden = shown > 0;
    renderFavs();
  }

  function bindEvents() {
    EL.pattern.addEventListener('input', scheduleRender);
    EL.pattern.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); render(); }
    });

    EL.flags.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFlagMenu(true);
      }
    });

    EL.flagsPicker.addEventListener('click', function (e) {
      const opt = e.target.closest('.flag-opt');
      if (opt) {
        toggleFlag(opt.dataset.flag);
        return;
      }
      setFlagMenu(EL.flagMenu.hidden);
    });

    EL.tokenBar.addEventListener('click', function (e) {
      const btn = e.target.closest('.tok-btn');
      if (!btn) return;
      const meta = QUICK_TOKENS.filter(function (k) { return k.t === btn.dataset.token; })[0];
      const focus = meta && meta.focus ? meta.focus : null;
      insertIntoPattern(btn.dataset.token, focus ? focus[0] : null, focus ? focus[1] : null);
    });

    EL.cheatWrap.addEventListener('click', function (e) {
      const row = e.target.closest('.cheat-row');
      if (!row) return;
      insertIntoPattern(row.dataset.ins);
    });

    EL.text.addEventListener('input', scheduleRender);
    EL.text.addEventListener('scroll', syncScroll);
    EL.text.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const start = EL.text.selectionStart;
        const end = EL.text.selectionEnd;
        EL.text.setRangeText('  ', start, end, 'end');
        render();
      }
    });

    const composing = function (on) {
      EL.editor.classList.toggle('composing', on);
    };
    EL.text.addEventListener('compositionstart', function () { composing(true); });
    EL.text.addEventListener('compositionend', function () {
      composing(false);
      render();
    });
    EL.text.addEventListener('blur', function () { composing(false); });

    EL.tabs.addEventListener('click', function (e) {
      const tab = e.target.closest('.tab');
      if (tab) switchTab(tab.dataset.tab);
    });

    EL.matchList.addEventListener('click', function (e) {
      const item = e.target.closest('.match-item');
      if (!item) return;
      const idx = Number(item.dataset.i);
      setActive(state.active === idx ? -1 : idx);
    });

    EL.langSelect.addEventListener('change', function () {
      state.lang = EL.langSelect.value;
      renderCode();
      saveState();
    });

    EL.textTabs.addEventListener('click', function (e) {
      if (e.target.closest('.txt-tab-input')) return;
      const tab = e.target.closest('.txt-tab');
      if (tab) switchTextTab(Number(tab.dataset.tabI));
    });

    EL.textTabs.addEventListener('dblclick', function (e) {
      const tab = e.target.closest('.txt-tab');
      if (!tab) return;
      const nameEl = tab.querySelector('.txt-tab-name');
      if (nameEl) startRenameTab(Number(tab.dataset.tabI), nameEl);
    });

    $('#btnSample').addEventListener('click', function () {
      EL.text.value = DEFAULT_TEXT;
      textTabs[activeTextTab].text = DEFAULT_TEXT;
      state.lastSample = DEFAULT_TEXT;
      state.active = -1;
      render();
    });

    $('#btnClearText').addEventListener('click', function () {
      EL.text.value = '';
      textTabs[activeTextTab].text = '';
      state.active = -1;
      render();
    });

    $('#btnClearPattern').addEventListener('click', function () {
      EL.pattern.value = '';
      EL.flags.value = 'g';
      state.active = -1;
      render();
      EL.pattern.focus();
    });

    EL.fileInput.addEventListener('change', function () {
      importFile(EL.fileInput.files && EL.fileInput.files[0]);
      EL.fileInput.value = '';
    });

    EL.replInput.addEventListener('input', renderReplace);

    EL.libList.addEventListener('click', function (e) {
      const btn = e.target.closest('.lib-item');
      if (!btn) return;
      const item = LIBRARY[Number(btn.dataset.lib)];
      if (!item) return;
      loadPattern(item.pat, item.flags, item.sample);
      toast('已载入：' + item.name);
      closeModal(EL.libModal);
    });

    EL.historyList.addEventListener('click', function (e) {
      const chip = e.target.closest('.hchip');
      if (!chip) return;
      const item = historyLoaded[Number(chip.dataset.hist)];
      if (item) {
        loadPattern(item.p, item.f);
        closeModal(EL.histModal);
      }
    });

    EL.btnFav.addEventListener('click', openFavForm);

    EL.favForm.addEventListener('submit', function (e) {
      e.preventDefault();
      addFav(EL.favName.value);
      closeFavForm();
    });

    EL.btnFavCancel.addEventListener('click', function () {
      closeFavForm();
      EL.btnFav.focus();
    });

    EL.favList.addEventListener('click', function (e) {
      const del = e.target.closest('.fav-del');
      if (del) {
        removeFav(del.dataset.favDel);
        return;
      }
      const btn = e.target.closest('.lib-item');
      if (btn) loadFav(btn.dataset.fav);
    });

    $('#btnLib').addEventListener('click', function () {
      EL.libSearch.value = '';
      closeFavForm();
      filterLibrary();
      openModal(EL.libModal);
    });

    $('#btnHist').addEventListener('click', function () {
      openModal(EL.histModal);
    });

    EL.libSearch.addEventListener('input', filterLibrary);

    document.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;
      if (!EL.flagMenu.hidden && !e.target.closest('#flagsPicker')) setFlagMenu(false);
      const closer = e.target.closest('[data-modal-close]');
      if (closer) closeModal(document.getElementById(closer.dataset.modalClose));
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!EL.flagMenu.hidden) { setFlagMenu(false); return; }
      if (!anyModalOpen()) return;
      closeModal(EL.libModal);
      closeModal(EL.histModal);
    });

    $('#btnClearHistory').addEventListener('click', function () {
      storageSet(STORE_HISTORY, []);
      historyLoaded = [];
      renderHistory();
      toast('已清空记录');
    });

    $('#btnCopyCode').addEventListener('click', function () {
      const code = buildCode(state.lang).code;
      copyText(code);
    });

    $('#btnCopyRepl').addEventListener('click', function () {
      copyText(EL.replOut.textContent || '');
    });

    $('#btnShare').addEventListener('click', shareLink);

    EL.btnTheme.addEventListener('click', function () {
      const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      storageSet(STORE_THEME, next);
    });

    window.addEventListener('hashchange', function () {
      if (readHash()) applyHash();
    });

    window.addEventListener('resize', syncScroll);
  }

  /* ================= 启动 ================= */

  function init() {
    applyTheme(storageGet(STORE_THEME, null));
    buildFlagMenu();
    buildTokens();
    buildLibrary();
    buildCheat();
    buildLangSelect();
    historyLoaded = storageGet(STORE_HISTORY, []);
    if (!Array.isArray(historyLoaded)) historyLoaded = [];
    restoreState();
    renderTextTabs();
    if (!EL.pattern.value && !EL.text.value) applyDefaults();
    bindEvents();
    loadFavs();
    renderFavs();
    renderHistory();
    applyHash();
    EL.langSelect.value = state.lang;
    render();
  }

  init();
})();
