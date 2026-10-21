(function () {
  "use strict";

  const Gen = window.Gen;
  const esc = Gen.escapeHtml;

  const groupsByMode = {
    html: window.HTML_GENERATOR_GROUPS,
    css: window.CSS_GENERATOR_GROUPS
  };

  const modeLabels = {
    html: "HTML 生成器",
    css: "CSS 生成器"
  };

  const codeLabels = {
    html: "HTML",
    css: "CSS"
  };

  function flattenGroups(mode) {
    return groupsByMode[mode].flatMap((group) => group.items);
  }

  const allItems = {
    html: flattenGroups("html"),
    css: flattenGroups("css")
  };

  const appState = {
    mode: "html",
    selected: {
      html: allItems.html[0].id,
      css: allItems.css[0].id
    },
    values: new Map(),
    query: ""
  };

  const localMediaSources = new Map();

  const elements = {
    tabs: Array.from(document.querySelectorAll(".mode-tab")),
    sidebar: document.querySelector(".sidebar"),
    search: document.getElementById("generator-search"),
    nav: document.getElementById("generator-nav"),
    navToggles: Array.from(document.querySelectorAll("[data-action='toggle-nav-expand']")),
    navCount: document.getElementById("nav-count"),
    mobileSelect: document.getElementById("mobile-generator"),
    category: document.getElementById("tool-category"),
    title: document.getElementById("tool-title"),
    desc: document.getElementById("tool-desc"),
    reset: document.getElementById("reset-button"),
    form: document.getElementById("options-form"),
    optionsCount: document.getElementById("options-count"),
    preview: document.getElementById("preview-frame"),
    codeOutput: document.getElementById("code-output"),
    codeLang: document.getElementById("code-lang"),
    copy: document.getElementById("copy-button"),
    toast: document.getElementById("toast"),
    toolHeader: document.querySelector(".tool-header")
  };

  const htmlPreviewBase = `
    *, *::before, *::after { box-sizing: border-box; }
    html { color-scheme: light; }
    body {
      margin: 0;
      padding: 22px;
      color: #0f172a;
      background: #ffffff;
      font-family: "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif;
      font-size: 15px;
      line-height: 1.65;
    }
    .demo { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; }
    .demo > * { max-width: 100%; }
    .preview-form { width: 100%; margin: 0; }
    .preview-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-top: 18px;
      padding-top: 12px;
      border-top: 1px dashed #e2e8f0;
    }
    .preview-submit {
      padding: 7px 14px;
      border: 1px solid #a5b4fc;
      border-radius: 8px;
      color: #4338ca;
      background: #eef2ff;
      font: inherit;
      cursor: pointer;
    }
    .preview-submit:hover { background: #e0e7ff; }
    .preview-status { color: #64748b; font-size: 13px; line-height: 1.5; }
    .preview-status[data-state="invalid"] { color: #b91c1c; }
    .preview-status[data-state="valid"] { color: #047857; }
    .baseline-demo {
      width: 100%;
      margin: 0;
      padding: 16px 18px;
      border: 1px dashed #cbd5e1;
      border-radius: 14px;
      background: #fff;
      color: #334155;
      font-size: 22px;
      line-height: 2.1;
    }
    .baseline-row { margin: 0; }
    .baseline-row + .baseline-row { margin-top: 2px; }
    .baseline-label {
      display: inline-block;
      width: 46px;
      color: #94a3b8;
      font-size: 12px;
    }
    .baseline-demo .baseline-text { color: #64748b; }
    .baseline-demo .baseline-sample,
    .baseline-demo .inline-mark {
      color: #1d4ed8;
      font-weight: 600;
    }
    .baseline-demo .inline-mark {
      padding: 0 3px;
      border-radius: 4px;
      background: #eff6ff;
    }
    .preview-note { margin: 0; color: #64748b; font-size: 13px; line-height: 1.7; }
    .dialog-stage {
      position: relative;
      width: 100%;
      min-height: 240px;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      background: #f8fafc;
      overflow: hidden;
    }
    .dialog-page { min-height: 238px; }
    .dialog-page-head {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 14px;
      border-bottom: 1px solid #e2e8f0;
      background: #fff;
    }
    .dialog-dot { width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; }
    .dialog-page-title { margin-left: 8px; color: #94a3b8; font-size: 12px; }
    .dialog-state {
      margin-left: auto;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
    }
    .dialog-state[data-open="true"] { color: #047857; background: #ecfdf5; }
    .dialog-state[data-open="false"] { color: #64748b; background: #f1f5f9; }
    .dialog-page-body { padding: 18px; }
    .dialog-page-body h3 { margin: 0 0 6px; color: #0f172a; font-size: 16px; }
    .dialog-page-body > p { margin: 0 0 14px; color: #64748b; font-size: 13px; line-height: 1.7; }
    .dialog-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 10px;
    }
    .dialog-card {
      padding: 12px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #fff;
    }
    .dialog-card strong { display: block; color: #334155; font-size: 13px; }
    .dialog-card span { display: block; margin-top: 2px; color: #94a3b8; font-size: 12px; line-height: 1.5; }
    .dialog-stage > dialog[open] {
      position: absolute;
      inset: 0;
      z-index: 2;
      width: min(320px, calc(100% - 36px));
      height: fit-content;
      max-height: calc(100% - 36px);
      margin: auto;
      padding: 18px;
      overflow: auto;
      border: 1px solid #cbd5e1;
      border-radius: 14px;
      background: #fff;
      color: #0f172a;
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
    }
    .dialog-stage > dialog[open] p { margin: 0; line-height: 1.7; }
    .bdi-demo {
      width: 100%;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      background: #fff;
      overflow: hidden;
    }
    .bdi-demo-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 9px 16px;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
    }
    .bdi-demo-title { color: #334155; font-size: 14px; font-weight: 600; }
    .bdi-badge {
      margin-left: auto;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
    }
    .bdi-badge[data-dir="ltr"] { color: #047857; background: #ecfdf5; }
    .bdi-badge[data-dir="rtl"] { color: #6d28d9; background: #f5f3ff; }
    .bdi-badge[data-dir="auto"] { color: #1d4ed8; background: #eff6ff; }
    .bdi-sentence {
      margin: 0;
      padding: 10px 16px;
      color: #475569;
      font-size: 15px;
      line-height: 1.8;
    }
    .bdi-sentence-label {
      display: inline-block;
      margin-right: 6px;
      padding: 1px 8px;
      border-radius: 999px;
      background: #f1f5f9;
      color: #64748b;
      font-size: 12px;
    }
    .bdi-current {
      padding: 1px 4px;
      border-radius: 4px;
      background: #fef9c3;
      box-shadow: inset 0 0 0 1px #fde68a;
    }
    .bdi-compare {
      padding: 9px 16px 12px;
      border-top: 1px dashed #e2e8f0;
    }
    .bdi-compare-title { margin: 0 0 8px; color: #94a3b8; font-size: 12px; }
    .bdi-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 10px;
    }
    .bdi-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #fff;
    }
    .bdi-card.is-current {
      border-color: #a5b4fc;
      background: #eef2ff;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.12);
    }
    .bdi-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      color: #475569;
      font-size: 12px;
      font-weight: 600;
    }
    .bdi-card-arrow { color: #818cf8; font-size: 14px; }
    .bdi-card-sample {
      display: block;
      padding: 4px 8px;
      border: 1px solid #e2e8f0;
      border-radius: 7px;
      background: #f8fafc;
      font-size: 17px;
      line-height: 1.6;
    }
    .bdi-card-note { color: #94a3b8; font-size: 12px; line-height: 1.5; }
    .preview-form :is(input, textarea, select):user-invalid {
      border-color: #ef4444 !important;
      outline: 2px solid rgba(239, 68, 68, 0.35);
      outline-offset: 1px;
      background-color: #fef2f2;
    }
    .demo img, .demo video, .demo iframe { max-width: 100%; }
    .demo iframe { border: 1px solid #e2e8f0; border-radius: 10px; }
    .demo audio { width: min(100%, 360px); }
    .demo label { display: inline-flex; align-items: center; gap: 6px; }
    .demo input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="image"]),
    .demo textarea {
      padding: 7px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font: inherit;
    }
    .demo input[type="color"] {
      width: 52px;
      height: 34px;
      padding: 2px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #fff;
    }
    .demo input[type="file"] { font: inherit; }
    .demo button,
    .demo input[type="button"],
    .demo input[type="submit"],
    .demo input[type="reset"] {
      padding: 7px 14px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      color: #0f172a;
      background: #f8fafc;
      font: inherit;
      cursor: pointer;
    }
    .demo input[type="checkbox"],
    .demo input[type="radio"],
    .demo input[type="range"] { accent-color: #4f46e5; }
    .demo input[type="range"] { width: min(100%, 320px); }
    .demo details {
      width: 100%;
      max-width: 380px;
      padding: 10px 14px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
    }
    .demo summary { cursor: pointer; font-weight: 600; }
    .demo dialog {
      border: 0;
      border-radius: 14px;
      padding: 22px 26px;
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.25);
    }
    .demo dialog::backdrop { background: rgba(15, 23, 42, 0.3); }
    .demo blockquote {
      margin: 0;
      padding-left: 14px;
      border-left: 3px solid #c7d2fe;
      color: #475569;
    }
    .demo code {
      padding: 2px 6px;
      border-radius: 5px;
      background: #f1f5f9;
      font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
      font-size: 0.92em;
    }
    .demo mark { background: #fde68a; }
    .demo meter, .demo progress { width: 240px; max-width: 100%; }
  `;

  const cssBase = `
    *, *::before, *::after { box-sizing: border-box; }
    html { color-scheme: light; }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background-color: #f8fafc;
      background-image: radial-gradient(#dbe3ee 1px, transparent 1px);
      background-size: 16px 16px;
      font-family: "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif;
    }
    .stage { width: min(100%, 420px); }
    .stage > .selector { margin-left: auto; margin-right: auto; }
    .stage-note {
      margin: 14px 0 0;
      color: #64748b;
      font-size: 12.5px;
      line-height: 1.6;
      text-align: center;
    }
  `;

  const cssSamples = {
    box: {
      markup: '<div class="selector"></div>',
      css: '.selector { width: 260px; height: 170px; border-radius: 14px; background: #dbeafe; }'
    },
    opacity: {
      markup: '<div class="selector">不透明度预览</div>',
      css: '.selector { display: grid; place-items: center; width: 260px; height: 170px; border-radius: 14px; background: #dbeafe; color: #1e3a8a; font-size: 18px; }'
    },
    display: {
      markup: `<div class="display-demo">
        <p class="display-copy"><span class="copy-text">文字在前</span> <span class="selector"><span class="chip">1</span><span class="chip">22</span><span class="chip">333</span></span> <span class="copy-text">文字在后</span></p>
      </div>
      <p class="stage-note">观察元素在文字中的位置，以及三个方块的宽度与排列<br>行内类值与前后文字同排，表格类值需配合表格结构查看行列</p>`,
      css: `.display-demo {
        padding: 16px;
        border: 1px dashed #cbd5e1;
        border-radius: 16px;
        background: #fff;
      }
      .display-copy {
        margin: 0;
        color: #64748b;
        font-size: 15px;
        line-height: 2;
      }
      .copy-text {
        white-space: nowrap;
      }
      .selector {
        width: 180px;
        padding: 8px;
        border: 1px solid #93c5fd;
        border-radius: 12px;
        background: #dbeafe;
        vertical-align: middle;
        grid-template-columns: repeat(3, 1fr);
        justify-content: center;
        gap: 8px;
      }
      .chip {
        display: inline-grid;
        place-items: center;
        height: 28px;
        padding: 0 10px;
        margin: 2px;
        border-radius: 8px;
        background: #fff;
        color: #1d4ed8;
        font-size: 14px;
        font-weight: 600;
      }`
    },
    visibility: {
      markup: `<div class="visibility-demo">
        <table class="visibility-table">
          <tbody>
            <tr>
              <th>第 1 行</th>
              <td>固定显示</td>
            </tr>
            <tr class="selector">
              <th>第 2 行</th>
              <td>可见性预览</td>
            </tr>
            <tr>
              <th>第 3 行</th>
              <td>固定显示</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="stage-note">隐藏：第 2 行保留空白，第 3 行不动<br>折叠：第 2 行移出表格，第 3 行上移</p>`,
      css: `.visibility-demo {
        display: grid;
        place-items: center;
        padding: 12px;
        border: 1px dashed #cbd5e1;
        border-radius: 16px;
        background: #fff;
      }
      .visibility-table {
        width: min(100%, 280px);
        border-collapse: separate;
        border-spacing: 0 8px;
        font-size: 14px;
      }
      .visibility-table th,
      .visibility-table td {
        padding: 11px 14px;
        text-align: left;
      }
      .visibility-table th {
        width: 96px;
        border-radius: 10px 0 0 10px;
        background: #e2e8f0;
        color: #475569;
        font-weight: 600;
      }
      .visibility-table td {
        border-radius: 0 10px 10px 0;
        background: #eff6ff;
        color: #1e3a8a;
      }
      .visibility-table .selector th {
        background: #bfdbfe;
        color: #1e3a8a;
      }
      .visibility-table .selector td {
        background: #dbeafe;
        color: #1e3a8a;
        font-weight: 600;
      }`
    },
    transform: {
      markup: '<div class="selector"><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed feugiat, elit eu eleifend blandit.</p><p>海内存知己，天涯若比邻。</p></div>',
      css: `.selector {
        width: min(220px, 68vh);
        aspect-ratio: 1;
        padding: 18px;
        overflow: hidden;
        border-radius: 4px;
        background: #b6bfce;
        color: #0f172a;
        font-family: "DM Sans", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: clamp(12px, 4vh, 14px);
        line-height: 1.7;
      }
      .selector p { margin: 0 0 8px; }
      .selector p:last-child { margin-bottom: 0; }`
    },
    image: {
      markup: '<img class="selector" src="./assets/sample.svg" alt="示例图片">',
      css: '.selector { display: block; width: 100%; max-width: 360px; height: auto; border-radius: 14px; }'
    },
    text: {
      markup: '<div class="selector"><p>这段文字用于演示排版与装饰效果。The quick brown fox jumps over the lazy dog。</p><p>海内存知己，天涯若比邻。调整参数可以观察行高、字距和对齐方式的变化。</p></div>',
      css: '.selector { width: 100%; color: #1f2937; font-size: 19px; line-height: 1.8; } .selector p { margin: 0; } .selector p + p { margin-top: 10px; }'
    },
    list: {
      markup: '<ul class="selector"><li>列表项一</li><li>列表项二</li><li>列表项三</li></ul>',
      css: '.selector { margin: 0; padding-left: 1.6em; color: #1f2937; font-size: 18px; line-height: 1.9; }'
    },
    cursor: {
      markup: '<div class="selector">把鼠标移到这里</div>',
      css: '.selector { display: grid; place-items: center; width: 300px; height: 170px; border: 1px dashed #a5b4fc; border-radius: 14px; background: #eef2ff; color: #4338ca; font-size: 16px; }'
    },
    resize: {
      markup: '<div class="selector">拖动右下角调整大小</div>',
      css: '.selector { width: 260px; min-width: 140px; height: 150px; min-height: 90px; padding: 14px; overflow: hidden; border: 1px solid #c7d2fe; border-radius: 12px; background: #eef2ff; color: #3730a3; font-size: 15px; }'
    },
    overflow: {
      markup: '<div class="selector">这是一段故意写得比较长的内容，用来观察溢出效果。当内容超过容器尺寸时，overflow 属性决定它是显示、裁剪还是滚动。<br><br>继续添加一些内容，确保纵向和横向都能产生溢出。海内存知己，天涯若比邻。</div>',
      css: '.selector { width: 280px; height: 160px; padding: 12px; border: 1px solid #c7d2fe; border-radius: 12px; background: #eef2ff; color: #3730a3; font-size: 15px; }'
    },
    transition: {
      markup: '<div class="selector">悬停查看过渡效果</div><p class="stage-note">把鼠标移到方块上，移开可恢复。</p>',
      css: '.selector { display: grid; place-items: center; width: 280px; height: 160px; border-radius: 16px; background: #dbeafe; color: #1e3a8a; font-size: 16px; cursor: pointer; }'
    },
    animation: {
      markup: '<div class="selector">动画预览</div><p class="stage-note">修改任意参数可重新播放动画。</p>',
      css: '.selector { display: grid; place-items: center; width: 230px; height: 150px; border-radius: 18px; background: linear-gradient(135deg, #6366f1, #d946ef); color: #fff; font-size: 16px; }'
    },
    whitespace: {
      markup: '<div class="selector">第一行    这里有多个空格\n第二行仍然属于同一段文字\n    第四行开头有缩进</div>',
      css: '.selector { width: 300px; padding: 14px; border: 1px dashed #cbd5e1; border-radius: 12px; color: #1f2937; font-size: 15px; line-height: 1.7; }'
    },
    wordbreak: {
      markup: '<div class="selector">超长单词示例：Supercalifragilisticexpialidocious，以及一个很长的网址：https://example.com/very/long/path/that/keeps/going/on/forever</div>',
      css: '.selector { width: 300px; padding: 14px; border: 1px dashed #cbd5e1; border-radius: 12px; color: #1f2937; font-size: 15px; line-height: 1.7; word-break: normal; overflow-wrap: normal; }'
    },
    tab: {
      markup: '<pre class="selector">第一层\n\t第二层\n\t\t第三层\n\t\t\t第四层</pre>',
      css: '.selector { width: 320px; margin: 0; padding: 16px; overflow: auto; border-radius: 12px; background: #0f172a; color: #e2e8f0; font: 14px/1.8 ui-monospace, "Cascadia Code", Consolas, monospace; }'
    },
    columns: {
      markup: '<div class="selector"><p>这是一段用于演示多栏排版的长文本。多栏布局会把内容自动分配到不同列中，适合阅读型页面。</p><p>海内存知己，天涯若比邻。随着内容增加，浏览器会尽量平衡每一栏的高度。</p><p>继续补充一些文字，方便观察两栏、三栏之间的差异。</p></div>',
      css: '.selector { width: 360px; color: #1f2937; font-size: 15px; line-height: 1.8; } .selector p { margin: 0 0 10px; }'
    },
    perspective: {
      markup: `<div class="selector-parent">
        <div class="selector">
          <div>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed feugiat, elit eu eleifend blandit, enim sem porta ex, sit amet porttitor ex felis a lacus. Vivamus ornare at libero sed vestibulum.</div>
          <div>海内存知己，天涯若比邻。</div>
        </div>
      </div>`,
      css: `body { padding: 16px; overflow: hidden; background: #ffffff; }
        .selector-parent {
          width: min(250px, 100%);
          height: min(250px, calc(100vh - 32px));
          margin: 0 auto;
          padding: 12px;
          border-radius: 4px;
          background: #b5b5b5;
          color: #000000;
          font-family: "DM Sans", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
          font-size: 16px;
          line-height: 1.5;
        }
        .selector { transform-style: preserve-3d; }
        @media (max-width: 430px) {
          .selector-parent { transform: scale(0.8); }
        }
        @media (max-width: 340px) {
          .selector-parent { transform: scale(0.66); }
        }
        @media (max-width: 290px) {
          .selector-parent { transform: scale(0.58); }
        }`
    }
  };

  let toastTimer = 0;
  let lastCode = "";
  let lastSections = null;
  let previewToken = 0;
  let navExpanded = false;
  let navExpandTrigger = null;
  const copyResetTimers = new WeakMap();
  const previewState = {
    mode: "",
    itemId: "",
    ready: false,
    token: 0,
    pendingCode: null
  };

  function locate(mode, id) {
    for (const group of groupsByMode[mode]) {
      const item = group.items.find((entry) => entry.id === id);
      if (item) {
        return { item, group };
      }
    }
    return null;
  }

  function currentLocation() {
    const mode = appState.mode;
    const found = locate(mode, appState.selected[mode]);
    if (found) {
      return found;
    }
    const fallback = locate(mode, allItems[mode][0].id);
    appState.selected[mode] = fallback.item.id;
    return fallback;
  }

  function stateKey(item) {
    return `${appState.mode}:${item.id}`;
  }

  function getValues(item) {
    const key = stateKey(item);
    if (!appState.values.has(key)) {
      appState.values.set(key, Gen.createState(item));
    }
    return appState.values.get(key);
  }

  function normalizeHexColor(value) {
    const text = String(value || "").trim();
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
    if (short) {
      return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
    }
    if (/^#[0-9a-f]{6}$/i.test(text)) {
      return text.toLowerCase();
    }
    return "";
  }

  function isVisible(fieldConfig, values) {
    return !fieldConfig.showIf || fieldConfig.showIf(values);
  }

  function hintMarkup(fieldConfig) {
    return fieldConfig.hint ? `<p class="field-hint">${esc(fieldConfig.hint)}</p>` : "";
  }

  function renderOptions(fieldConfig, value) {
    const renderOption = (option) => {
      const selected = String(option.value) === String(value) ? " selected" : "";
      return `<option value="${esc(option.value)}"${selected}>${esc(option.label)}</option>`;
    };
    if (fieldConfig.groups && fieldConfig.groups.length) {
      return fieldConfig.groups.map((group) => {
        return `<optgroup label="${esc(group.label)}">${group.options.map(renderOption).join("")}</optgroup>`;
      }).join("");
    }
    return fieldConfig.options.map(renderOption).join("");
  }

  function fieldId(item, fieldConfig) {
    return `field-${item.id}-${fieldConfig.key}`;
  }

  function renderRadioGroup(fieldConfig, value, id) {
    return `<div class="field-label">${esc(fieldConfig.label)}</div>
      <div class="radio-group${fieldConfig.layout === "stacked" ? " is-stacked" : ""}" role="radiogroup" aria-label="${esc(fieldConfig.label)}">
        ${fieldConfig.options.map((option) => `<label class="radio-option">
          <input type="radio" name="${id}" value="${esc(option.value)}" data-field="${fieldConfig.key}"${String(option.value) === String(value) ? " checked" : ""}>
          <span>${esc(option.label)}</span>
        </label>`).join("")}
      </div>
      ${hintMarkup(fieldConfig)}`;
  }

  const shadowNumberRanges = {
    x: [-50, 50],
    y: [-50, 50],
    blur: [0, 50],
    spread: [-50, 50]
  };

  function renderShadowList(item, fieldConfig, values) {
    const kind = fieldConfig.kind || "box";
    const shadows = values[fieldConfig.key];
    const cards = shadows.map((shadow, index) => {
      const insetControl = kind === "box"
        ? `<label class="mini-checkbox"><input type="checkbox" data-shadow-prop="inset"${shadow.inset ? " checked" : ""}> 内阴影</label>`
        : "";
      const numberFields = [
        ["x", "X 偏移（px）"],
        ["y", "Y 偏移（px）"],
        ["blur", "模糊（px）"]
      ];
      if (kind === "box") {
        numberFields.push(["spread", "扩展（px）"]);
      }
      const numberControls = numberFields.map(([prop, label]) => {
        const [min, max] = shadowNumberRanges[prop];
        const sliderValue = Math.min(max, Math.max(min, Number(shadow[prop]) || 0));
        return `<div class="field shadow-number-field">
          <span class="mini-label">${label}</span>
          <input class="mini-input" type="number" min="${min}" max="${max}" step="1" data-shadow-prop="${prop}" data-role="shadow-number" value="${esc(shadow[prop])}" aria-label="第 ${index + 1} 层阴影${label}">
          <input class="mini-range" type="range" min="${min}" max="${max}" step="1" data-shadow-prop="${prop}" data-role="shadow-range" value="${sliderValue}" aria-label="第 ${index + 1} 层阴影${label}滑动条">
        </div>`;
      }).join("");
      return `<div class="repeater-card" data-shadow-index="${index}">
        <div class="repeater-head">
          <span class="repeater-title">阴影 #${index + 1}</span>
          <button class="icon-button" type="button" data-action="remove-shadow" data-index="${index}" title="删除这层阴影"${shadows.length <= 1 ? " disabled" : ""}>×</button>
        </div>
        ${insetControl}
        <div class="repeater-grid">
          <label class="field">
            <span class="mini-label">颜色</span>
            <input class="stop-swatch" type="color" data-shadow-prop="color" value="${esc(normalizeHexColor(shadow.color) || "#000000")}" aria-label="第 ${index + 1} 层阴影颜色">
          </label>
          ${numberControls}
        </div>
      </div>`;
    }).join("");

    return `<div class="field" data-field-wrap="${fieldConfig.key}">
      <div class="field-label">${esc(fieldConfig.label)}</div>
      <div class="repeater">
        ${cards}
        <button class="add-button" type="button" data-action="add-shadow">＋ 添加一层阴影</button>
      </div>
      ${hintMarkup(fieldConfig)}
    </div>`;
  }

  function renderColorStops(item, fieldConfig, values) {
    const stops = values[fieldConfig.key];
    const rows = stops.map((stop, index) => {
      return `<div class="stop-row" data-stop-index="${index}">
        <input class="stop-swatch" type="color" data-stop-prop="color" data-role="stop-swatch" value="${esc(normalizeHexColor(stop.color) || "#000000")}" aria-label="第 ${index + 1} 个颜色节点">
        <input class="mini-input" type="text" data-stop-prop="color" data-role="stop-text" value="${esc(stop.color)}" aria-label="第 ${index + 1} 个颜色节点的颜色值">
        <div class="stop-position-wrap">
          <input class="stop-position" type="number" min="0" max="100" step="1" data-stop-prop="position" value="${esc(stop.position)}" aria-label="第 ${index + 1} 个颜色节点的位置">
          <span class="stop-unit">%</span>
        </div>
        <button class="icon-button" type="button" data-action="remove-stop" data-index="${index}" title="删除这个颜色节点"${stops.length <= 2 ? " disabled" : ""}>×</button>
      </div>`;
    }).join("");

    return `<div class="field" data-field-wrap="${fieldConfig.key}">
      <div class="field-label">${esc(fieldConfig.label)}</div>
      <div class="repeater">
        ${rows}
        <button class="add-button" type="button" data-action="add-stop">＋ 添加颜色节点</button>
      </div>
      <p class="field-hint">至少保留两个颜色节点，位置范围为 0% 到 100%。</p>
    </div>`;
  }

  function rememberLocalMedia(item, key, file) {
    const id = `${appState.mode}:${item.id}:${key}`;
    const previous = localMediaSources.get(id);
    if (previous) {
      URL.revokeObjectURL(previous.url);
    }
    localMediaSources.set(id, {
      itemId: item.id,
      key,
      name: file.name,
      url: URL.createObjectURL(file)
    });
  }

  function clearLocalMedia(item) {
    localMediaSources.forEach((entry, id) => {
      if (entry.itemId !== item.id) {
        return;
      }
      URL.revokeObjectURL(entry.url);
      localMediaSources.delete(id);
    });
  }

  function withLocalMediaPreview(item, values) {
    let preview = values;
    localMediaSources.forEach((entry) => {
      if (entry.itemId !== item.id || values[entry.key] !== entry.name) {
        return;
      }
      if (preview === values) {
        preview = { ...values };
      }
      preview[entry.key] = entry.url;
    });
    return preview;
  }

  function renderField(item, fieldConfig, values) {
    const value = values[fieldConfig.key];
    const id = fieldId(item, fieldConfig);
    const hidden = isVisible(fieldConfig, values) ? "" : " hidden";
    let content = "";

    if (fieldConfig.type === "checkbox") {
      content = `<label class="checkbox-field">
        <input type="checkbox" data-field="${fieldConfig.key}"${value ? " checked" : ""}>
        <span class="checkbox-text">
          <strong>${esc(fieldConfig.label)}</strong>
          ${fieldConfig.hint ? `<small>${esc(fieldConfig.hint)}</small>` : ""}
        </span>
      </label>`;
      return `<div class="field" data-field-wrap="${fieldConfig.key}"${hidden}>${content}</div>`;
    }

    if (fieldConfig.type === "shadow-list") {
      return renderShadowList(item, fieldConfig, values).replace(
        `<div class="field" data-field-wrap="${fieldConfig.key}"`,
        `<div class="field" data-field-wrap="${fieldConfig.key}"${hidden}`
      );
    }

    if (fieldConfig.type === "color-stops") {
      return renderColorStops(item, fieldConfig, values).replace(
        `<div class="field" data-field-wrap="${fieldConfig.key}"`,
        `<div class="field" data-field-wrap="${fieldConfig.key}"${hidden}`
      );
    }

    if (fieldConfig.type === "color") {
      const swatchValue = normalizeHexColor(value) || "#000000";
      content = `<label class="field-label" for="${id}-text">${esc(fieldConfig.label)}</label>
        <div class="color-field">
          <input class="color-swatch" type="color" data-field="${fieldConfig.key}" data-role="color-swatch" value="${esc(swatchValue)}" aria-label="${esc(fieldConfig.label)}">
          <input class="input color-text" id="${id}-text" type="text" data-field="${fieldConfig.key}" data-role="color-text" value="${esc(value)}">
        </div>
        ${hintMarkup(fieldConfig)}`;
    } else if (fieldConfig.type === "range") {
      const attrs = [
        `min="${fieldConfig.min}"`,
        `max="${fieldConfig.max}"`,
        `step="${fieldConfig.step}"`
      ].join(" ");
      const units = Array.isArray(fieldConfig.units) ? fieldConfig.units : [];
      const activeUnit = units.length
        ? values[`${fieldConfig.key}Unit`] || fieldConfig.defaultUnit || units[0]
        : fieldConfig.unit;
      const unitMarkup = units.length
        ? `<button class="range-unit is-toggle" type="button" data-action="cycle-unit" data-field="${fieldConfig.key}" title="点击切换单位" aria-label="${esc(fieldConfig.label)}单位，当前为 ${esc(activeUnit)}，点击切换">${esc(activeUnit)}</button>`
        : activeUnit
          ? `<span class="range-unit">${esc(activeUnit)}</span>`
          : "";
      content = `<label class="field-label" for="${id}">${esc(fieldConfig.label)}</label>
        <div class="range-field">
          <input type="range" ${attrs} value="${esc(value)}" data-field="${fieldConfig.key}" data-role="range" aria-label="${esc(fieldConfig.label)}">
          <div class="range-number-wrap${units.length ? " has-unit-toggle" : ""}">
            <input class="range-number" id="${id}" type="number" ${attrs} value="${esc(value)}" data-field="${fieldConfig.key}" data-role="range-number" aria-label="${esc(fieldConfig.label)}数值">
            ${unitMarkup}
          </div>
        </div>
        ${hintMarkup(fieldConfig)}`;
    } else if (fieldConfig.type === "radio" || (fieldConfig.type === "select" && !fieldConfig.groups && fieldConfig.options.length === 2)) {
      content = renderRadioGroup(fieldConfig, value, id);
    } else if (fieldConfig.type === "select") {
      content = `<label class="field-label" for="${id}">${esc(fieldConfig.label)}</label>
        <select class="select" id="${id}" data-field="${fieldConfig.key}">
          ${renderOptions(fieldConfig, value)}
        </select>
        ${hintMarkup(fieldConfig)}`;
    } else if (fieldConfig.type === "textarea") {
      content = `<label class="field-label" for="${id}">${esc(fieldConfig.label)}</label>
        <textarea class="textarea" id="${id}" rows="${fieldConfig.rows || 3}" data-field="${fieldConfig.key}" placeholder="${esc(fieldConfig.placeholder || "")}">${esc(value)}</textarea>
        ${hintMarkup(fieldConfig)}`;
    } else {
      const inputType = fieldConfig.type === "number" ? "number" : "text";
      const limits = [];
      if (fieldConfig.min !== undefined) {
        limits.push(`min="${fieldConfig.min}"`);
      }
      if (fieldConfig.max !== undefined) {
        limits.push(`max="${fieldConfig.max}"`);
      }
      if (fieldConfig.step !== undefined) {
        limits.push(`step="${fieldConfig.step}"`);
      }
      const slider = fieldConfig.slider;
      const sliderMarkup = slider
        ? `<input type="range" min="${slider.min}" max="${slider.max}" step="${slider.step || 1}" value="${esc(value)}" data-field="${fieldConfig.key}" data-role="range" aria-label="${esc(fieldConfig.label)}拖动条">`
        : "";
      const inputMarkup = `<input class="${slider ? "range-number" : "input"}" id="${id}" type="${inputType}" ${limits.join(" ")} value="${esc(value)}" data-field="${fieldConfig.key}"${slider ? ' data-role="range-number"' : ""} placeholder="${esc(fieldConfig.placeholder || "")}">`;
      const picker = fieldConfig.filePicker
        ? `<label class="media-pick" title="选择本地音频文件，自动填入文件名并在预览中试听">
            <input class="sr-only" type="file" accept="${esc(fieldConfig.filePicker.accept || "")}" data-field="${fieldConfig.key}" data-role="media-file">
            <span>${esc(fieldConfig.filePicker.label || "选择文件")}</span>
          </label>`
        : "";
      content = `<label class="field-label" for="${id}">${esc(fieldConfig.label)}</label>
        ${slider
          ? `<div class="range-field">${sliderMarkup}<div class="range-number-wrap">${inputMarkup}</div></div>`
          : picker ? `<div class="media-input-row">${inputMarkup}${picker}</div>` : inputMarkup}
        ${hintMarkup(fieldConfig)}`;
    }

    return `<div class="field" data-field-wrap="${fieldConfig.key}"${hidden}>${content}</div>`;
  }

  function renderForm(item) {
    const values = getValues(item);
    elements.form.innerHTML = item.fields.map((fieldConfig) => renderField(item, fieldConfig, values)).join("");
    applyConditionalVisibility(item, values);
    updateOptionsCount(item, values);
    elements.form.scrollTop = 0;
  }

  function applyConditionalVisibility(item, values) {
    item.fields.forEach((fieldConfig) => {
      const wrapper = elements.form.querySelector(`[data-field-wrap="${fieldConfig.key}"]`);
      if (wrapper) {
        wrapper.hidden = !isVisible(fieldConfig, values);
      }
    });
  }

  function updateOptionsCount(item, values) {
    const count = item.fields.filter((fieldConfig) => isVisible(fieldConfig, values)).length;
    elements.optionsCount.textContent = `${count} 项参数`;
  }

  function generateOutput(item, values) {
    let code = "";
    try {
      code = String(item.build(values));
    } catch (error) {
      console.error(error);
      code = `代码生成失败：${error.message}`;
    }

    let sections = null;
    if (typeof item.sections === "function") {
      try {
        sections = item.sections(values).map((section) => ({
          label: String(section.label || ""),
          code: String(section.code ?? "")
        }));
      } catch (error) {
        console.error(error);
        sections = null;
      }
    }
    return { code, sections };
  }

  function copyIdleLabel() {
    return lastSections && lastSections.length ? "复制全部" : "复制代码";
  }

  function renderCode() {
    if (lastSections && lastSections.length) {
      elements.codeOutput.classList.add("has-sections");
      elements.codeOutput.innerHTML = lastSections.map((section, index) => {
        return `<section class="code-section">
          <header class="code-section-head">
            <span class="code-section-label">${esc(section.label)}</span>
            <button class="code-copy" type="button" data-copy-section="${index}">复制</button>
          </header>
          <pre class="code-block" tabindex="0"><code>${esc(section.code)}</code></pre>
        </section>`;
      }).join("");
    } else {
      elements.codeOutput.classList.remove("has-sections");
      elements.codeOutput.innerHTML = `<pre class="code-block" tabindex="0"><code>${esc(lastCode)}</code></pre>`;
    }
    elements.copy.textContent = copyIdleLabel();
  }

  function safeStyleCode(code) {
    return code.replace(/<\/style/gi, "<\\/style");
  }

  function refreshOutput(item, values) {
    const output = generateOutput(item, values);
    lastCode = output.code;
    lastSections = output.sections;
    renderCode();
    elements.codeLang.textContent = codeLabels[appState.mode];
    const previewValues = withLocalMediaPreview(item, values);
    const previewCode = previewValues === values ? output.code : generateOutput(item, previewValues).code;
    updatePreview(item, previewCode);
  }

  function usesFormPreview(item) {
    if (appState.mode !== "html") {
      return false;
    }
    const found = locate("html", item.id);
    return Boolean(found && found.group.id === "inputs");
  }

  function detectBdiDirection(content) {
    const plain = content
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
    const rtlPattern = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
    const ltrPattern = /[A-Za-z\u00C0-\u02AF\u0370-\u058F\u0900-\u1FFF\u2C00-\uD7FF\uF900-\uFAFF]/;
    for (const char of plain) {
      if (rtlPattern.test(char)) return "rtl";
      if (ltrPattern.test(char)) return "ltr";
    }
    return "ltr";
  }

  function decorateHtmlPreview(item, code) {
    if (item.id === "bdi") {
      const match = code.match(/^<bdi dir="(auto|ltr|rtl)">([\s\S]*)<\/bdi>$/);
      const dir = match ? match[1] : "auto";
      const content = match ? match[2] : "";
      const detected = detectBdiDirection(content);
      const detectedLabel = detected === "rtl" ? "从右到左" : "从左到右";
      const badge = dir === "auto"
        ? `自动判断 · 检测为${detectedLabel}`
        : dir === "rtl" ? "强制从右到左（RTL）" : "强制从左到右（LTR）";
      const cards = [
        ["ltr", "从左到右", "→", "强制 LTR"],
        ["rtl", "从右到左", "←", "强制 RTL"],
        ["auto", "自动判断", "↔", "按内容首字符判断"]
      ].map(([cardDir, label, arrow, note]) => `<div class="bdi-card${cardDir === dir ? " is-current" : ""}">
        <div class="bdi-card-head"><span>${label}</span><span class="bdi-card-arrow">${arrow}</span></div>
        <span class="bdi-card-sample"><bdi dir="${cardDir}">Hello إيان</bdi></span>
        <span class="bdi-card-note">${note}${cardDir === dir ? " · 当前" : ""}</span>
      </div>`).join("");
      return `<div class="bdi-demo">
        <div class="bdi-demo-head">
          <span class="bdi-demo-title">双向文本隔离演示</span>
          <span class="bdi-badge" data-dir="${dir}">${badge}</span>
        </div>
        <p class="bdi-sentence"><span class="bdi-sentence-label">当前输出</span>用户 <span class="bdi-current">${code}</span> 完成。</p>
        <div class="bdi-compare">
          <p class="bdi-compare-title">方向对照 · 示例文字「Hello إيان」包含阿拉伯文</p>
          <div class="bdi-cards">${cards}</div>
        </div>
      </div>
      <p class="preview-note">${dir === "auto"
        ? `自动判断会按内容中的第一个强方向字符决定方向，当前检测为${detectedLabel}。切换上方单选即可对比强制方向的效果。`
        : `当前强制为${dir === "rtl" ? "从右到左" : "从左到右"}，黄色高亮为生成结果；下方对照卡展示另外两种设置下的排列差异。`}</p>`;
    }
    if (item.id === "dialog") {
      const isOpen = /<dialog[^>]*\sopen(?:\s|>)/.test(code);
      return `<div class="dialog-stage">
        <div class="dialog-page">
          <div class="dialog-page-head">
            <span class="dialog-dot"></span><span class="dialog-dot"></span><span class="dialog-dot"></span>
            <span class="dialog-page-title">示例页面 · 内容预览</span>
            <span class="dialog-state" data-open="${isOpen}">对话框：${isOpen ? "已展开" : "已关闭"}</span>
          </div>
          <div class="dialog-page-body">
            <h3>对话框背后的页面</h3>
            <p>展开对话框后，它会浮在这块内容上方；关闭时页面内容保持可见。</p>
            <div class="dialog-cards">
              <div class="dialog-card"><strong>卡片一</strong><span>普通页面内容，用于观察对话框的层级</span></div>
              <div class="dialog-card"><strong>卡片二</strong><span>对比展开与关闭时的页面状态</span></div>
            </div>
          </div>
        </div>
        ${code}
      </div>
      <p class="preview-note">${isOpen
        ? "对话框已展开并浮在页面内容上方。直接使用 open 属性展开时不会出现遮罩层，也不会锁定页面滚动。"
        : "对话框当前关闭，dialog 默认不显示；勾选“默认展开”即可看到它浮在页面上方。"}</p>`;
    }
    if (item.id !== "superscript-subscript") {
      return code;
    }
    const match = code.match(/^<(sup|sub)>([\s\S]*)<\/\1>$/);
    const label = match && match[1] === "sub" ? "下标" : "上标";
    const content = match ? match[2] : "";
    return `<div class="baseline-demo">
      <p class="baseline-row"><span class="baseline-label">正常</span><span class="baseline-text">正常文字</span> <span class="baseline-sample">${content}</span> <span class="baseline-text">正常文字</span></p>
      <p class="baseline-row"><span class="baseline-label">${label}</span><span class="baseline-text">正常文字</span> <span class="inline-mark">${code}</span> <span class="baseline-text">正常文字</span></p>
    </div>
    <p class="preview-note">上一行是普通文本，下一行是生成的${label}；对比中间文字的高度即可看出位置变化。</p>`;
  }

  function renderPreview(item, code) {
    const baseHref = document.baseURI.split("#")[0];
    previewToken += 1;
    previewState.mode = appState.mode;
    previewState.itemId = item.id;
    previewState.ready = false;
    previewState.token = previewToken;
    previewState.pendingCode = code;

    let doc;
    if (appState.mode === "css") {
      const sample = cssSamples[item.sample] || cssSamples.box;
      doc = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="light">
  <base href="${esc(baseHref)}">
  <style>${cssBase}</style>
  <style>${sample.css}</style>
  <style id="generated-style">${safeStyleCode(code)}</style>
</head>
<body data-preview-token="${previewToken}">
  <div class="stage">${sample.markup}</div>
</body>
</html>`;
    } else {
      const demo = `<div class="demo">${decorateHtmlPreview(item, code)}</div>`;
      const body = usesFormPreview(item)
        ? `<form class="preview-form" id="preview-form">
  ${demo}
  <div class="preview-actions">
    <button class="preview-submit" type="submit">测试提交</button>
    <span class="preview-status" role="status" data-state="">填写后点击“测试提交”，查看浏览器内置校验效果</span>
  </div>
</form>`
        : demo;
      doc = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="light">
  <base href="${esc(baseHref)}">
  <style>${htmlPreviewBase}</style>
</head>
<body data-preview-token="${previewToken}">
  ${body}
</body>
</html>`;
    }
    elements.preview.srcdoc = doc;
    elements.preview.title = `${item.name}实时预览`;
  }

  function applyPreview(code) {
    const doc = elements.preview.contentDocument;
    if (!doc) {
      return false;
    }
    if (previewState.mode === "css") {
      const style = doc.getElementById("generated-style");
      if (!style) {
        return false;
      }
      style.textContent = safeStyleCode(code);
      return true;
    }
    const demo = doc.querySelector(".demo");
    if (!demo) {
      return false;
    }
    const found = locate("html", previewState.itemId);
    demo.innerHTML = found ? decorateHtmlPreview(found.item, code) : code;
    const status = doc.querySelector(".preview-status");
    if (status) {
      status.textContent = "填写后点击“测试提交”，查看浏览器内置校验效果";
      status.dataset.state = "";
    }
    return true;
  }

  function updatePreview(item, code) {
    if (previewState.mode !== appState.mode || previewState.itemId !== item.id) {
      renderPreview(item, code);
      return;
    }
    if (!previewState.ready) {
      previewState.pendingCode = code;
      return;
    }
    if (!applyPreview(code)) {
      renderPreview(item, code);
      return;
    }
    previewState.pendingCode = code;
  }

  function bindPreviewForm(doc) {
    const form = doc.getElementById("preview-form");
    if (!form || form.dataset.bound === "true") {
      return;
    }
    form.dataset.bound = "true";
    const status = form.querySelector(".preview-status");
    const setStatus = (text, state) => {
      status.textContent = text;
      status.dataset.state = state;
    };
    form.addEventListener("invalid", () => {
      setStatus("有字段未通过校验，请按浏览器提示修改后再提交。", "invalid");
    }, true);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      setStatus("校验通过：表单数据有效，预览中不会真正发送。", "valid");
    });
    form.addEventListener("input", () => {
      if (status.dataset.state === "invalid") {
        setStatus("修改后可以再次点击“测试提交”。", "");
      }
    }, true);
  }

  function handlePreviewLoad() {
    const doc = elements.preview.contentDocument;
    if (!doc || !previewState.token) {
      return;
    }
    const token = Number(doc.body && doc.body.dataset.previewToken);
    if (token !== previewState.token) {
      return;
    }
    previewState.ready = true;
    if (previewState.pendingCode !== null) {
      applyPreview(previewState.pendingCode);
    }
    bindPreviewForm(doc);
  }

  function renderTabs() {
    elements.tabs.forEach((tab) => {
      const active = tab.dataset.mode === appState.mode;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
  }

  function matchesQuery(item, group, query) {
    if (!query) {
      return true;
    }
    const haystack = `${item.name} ${item.desc} ${item.id} ${group.name}`.toLowerCase();
    return haystack.includes(query);
  }

  function renderNav() {
    const query = appState.query.trim().toLowerCase();
    const groups = groupsByMode[appState.mode];
    const currentId = appState.selected[appState.mode];
    const parts = [];
    let visibleCount = 0;

    groups.forEach((group) => {
      const items = group.items.filter((item) => matchesQuery(item, group, query));
      if (!items.length) {
        return;
      }
      visibleCount += items.length;
      parts.push(`<section class="nav-group">
        <h2>${esc(group.name)}<span>${items.length}</span></h2>
        ${items.map((item) => {
          const active = item.id === currentId;
          return `<button class="nav-item${active ? " is-active" : ""}" type="button" data-generator-id="${item.id}"${active ? ' aria-current="page"' : ""}>${esc(item.name)}</button>`;
        }).join("")}
      </section>`);
    });

    elements.nav.innerHTML = parts.length
      ? parts.join("")
      : `<p class="nav-empty">没有找到“${esc(appState.query.trim())}”相关的生成器，试试其他关键词。</p>`;
    if (elements.navCount) {
      elements.navCount.textContent = query ? `匹配 ${visibleCount} 个` : `共 ${visibleCount} 个`;
    }
  }

  function setNavExpanded(expanded, { restoreFocus = true } = {}) {
    if (expanded === navExpanded) {
      return;
    }
    navExpanded = expanded;
    if (expanded) {
      const active = document.activeElement;
      navExpandTrigger = active && active.closest("[data-action='toggle-nav-expand']")
        ? active
        : elements.navToggles[0];
    }
    elements.sidebar.classList.toggle("is-fullscreen", expanded);
    document.body.classList.toggle("nav-fullscreen", expanded);
    elements.navToggles.forEach((button) => {
      button.setAttribute("aria-expanded", String(expanded));
      button.title = expanded ? "退出全屏" : "全屏查看生成器列表";
      button.setAttribute("aria-label", button.title);
      const text = button.querySelector(".nav-expand-text");
      if (text) {
        text.textContent = expanded ? "退出全屏" : "全屏";
      }
    });
    if (expanded) {
      elements.nav.scrollTop = 0;
      const target = window.matchMedia("(max-width: 960px)").matches ? elements.navToggles[0] : elements.search;
      target.focus({ preventScroll: true });
    } else if (restoreFocus && navExpandTrigger) {
      navExpandTrigger.focus({ preventScroll: true });
    }
  }

  function scrollActiveNavIntoView() {
    const active = elements.nav.querySelector(".nav-item.is-active");
    if (active) {
      active.scrollIntoView({ block: "nearest" });
    }
  }

  function renderMobileSelect() {
    const parts = groupsByMode[appState.mode].map((group) => {
      const options = group.items.map((item) => {
        const selected = item.id === appState.selected[appState.mode] ? " selected" : "";
        return `<option value="${item.id}"${selected}>${esc(item.name)}</option>`;
      }).join("");
      return `<optgroup label="${esc(group.name)}">${options}</optgroup>`;
    });
    elements.mobileSelect.innerHTML = parts.join("");
    elements.mobileSelect.value = appState.selected[appState.mode];
  }

  function renderTool() {
    const { item, group } = currentLocation();
    appState.selected[appState.mode] = item.id;
    elements.category.textContent = `${modeLabels[appState.mode]} / ${group.name}`;
    elements.title.textContent = item.name;
    elements.desc.textContent = item.desc;
    elements.codeLang.textContent = codeLabels[appState.mode];
    renderForm(item);
    const values = getValues(item);
    refreshOutput(item, values);
    document.title = `${item.name} - ${codeLabels[appState.mode]} 代码生成器 | 仰晨工具集`;
  }

  function renderAll() {
    renderTabs();
    renderNav();
    renderMobileSelect();
    renderTool();
    scrollActiveNavIntoView();
  }

  function writeHash() {
    const hash = `#${appState.mode}/${appState.selected[appState.mode]}`;
    if (window.location.hash === hash) {
      return;
    }
    try {
      window.history.replaceState(null, "", hash);
    } catch (error) {
      window.location.hash = hash;
    }
  }

  function applyHash() {
    const raw = decodeURIComponent(window.location.hash.replace(/^#\/?/, ""));
    const [modePart, idPart] = raw.split("/");
    const mode = modePart === "css" ? "css" : "html";
    appState.mode = mode;
    if (idPart && locate(mode, idPart)) {
      appState.selected[mode] = idPart;
    }
    renderAll();
    writeHash();
  }

  function switchMode(mode) {
    if (mode === appState.mode) {
      return;
    }
    appState.mode = mode;
    renderAll();
    writeHash();
    if (window.scrollY > 120) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function selectGenerator(id) {
    if (!locate(appState.mode, id)) {
      return;
    }
    appState.selected[appState.mode] = id;
    renderAll();
    writeHash();
    if (window.scrollY > 160) {
      const headerTop = elements.toolHeader.getBoundingClientRect().top + window.scrollY - 82;
      window.scrollTo({ top: Math.max(0, headerTop), behavior: "smooth" });
    }
  }

  function resetCurrent() {
    const { item } = currentLocation();
    clearLocalMedia(item);
    appState.values.set(stateKey(item), Gen.createState(item));
    renderForm(item);
    refreshOutput(item, getValues(item));
    showToast("已恢复默认参数");
  }

  function updateShadowFromControl(target, values, item) {
    const card = target.closest("[data-shadow-index]");
    if (!card) {
      return false;
    }
    const fieldConfig = item.fields.find((entry) => entry.type === "shadow-list");
    if (!fieldConfig) {
      return false;
    }
    const list = values[fieldConfig.key];
    const index = Number(card.dataset.shadowIndex);
    const shadow = list[index];
    if (!shadow) {
      return false;
    }
    const prop = target.dataset.shadowProp;
    if (prop === "inset") {
      shadow.inset = target.checked;
    } else if (prop === "color") {
      shadow.color = target.value;
    } else if (prop && shadowNumberRanges[prop]) {
      const [min, max] = shadowNumberRanges[prop];
      const isEmpty = target.value === "";
      const nextValue = isEmpty ? 0 : Math.min(max, Math.max(min, Number(target.value)));
      shadow[prop] = nextValue;
      if (!isEmpty && Number(target.value) !== nextValue) {
        target.value = String(nextValue);
      }
      const pairRole = target.dataset.role === "shadow-range" ? "shadow-number" : "shadow-range";
      const pair = card.querySelector(`[data-role="${pairRole}"][data-shadow-prop="${prop}"]`);
      if (pair) {
        pair.value = String(nextValue);
      }
    } else if (prop) {
      shadow[prop] = target.value === "" ? 0 : Number(target.value);
    }
    return true;
  }

  function updateStopFromControl(target, values, item) {
    const row = target.closest("[data-stop-index]");
    if (!row) {
      return false;
    }
    const fieldConfig = item.fields.find((entry) => entry.type === "color-stops");
    if (!fieldConfig) {
      return false;
    }
    const list = values[fieldConfig.key];
    const index = Number(row.dataset.stopIndex);
    const stop = list[index];
    if (!stop) {
      return false;
    }
    const prop = target.dataset.stopProp;
    if (prop === "color") {
      stop.color = target.value;
      const swatch = row.querySelector('[data-role="stop-swatch"]');
      const textInput = row.querySelector('[data-role="stop-text"]');
      if (target === swatch && textInput) {
        textInput.value = target.value;
      } else if (swatch) {
        const normalized = normalizeHexColor(target.value);
        if (normalized) {
          swatch.value = normalized;
        }
      }
    } else if (prop === "position") {
      stop.position = target.value === "" ? 0 : Number(target.value);
    }
    return true;
  }

  function handleFormEvent(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
      return;
    }

    const { item } = currentLocation();
    const values = getValues(item);

    if (updateShadowFromControl(target, values, item) || updateStopFromControl(target, values, item)) {
      refreshOutput(item, values);
      return;
    }

    const key = target.dataset.field;
    if (!key) {
      return;
    }

    if (target.type === "file") {
      if (event.type !== "change") {
        return;
      }
      const file = target.files && target.files[0];
      if (!file) {
        return;
      }
      rememberLocalMedia(item, key, file);
      values[key] = file.name;
      target.value = "";
      const textInput = target.closest(".field")?.querySelector(`.input[data-field="${key}"]`);
      if (textInput) {
        textInput.value = file.name;
      }
      applyConditionalVisibility(item, values);
      updateOptionsCount(item, values);
      refreshOutput(item, values);
      showToast(`已选择本地文件：${file.name}`);
      return;
    }

    const role = target.dataset.role || "";

    if (target.type === "checkbox") {
      values[key] = target.checked;
    } else if (role === "color-swatch" || role === "color-text") {
      const wrapper = target.closest(".field");
      const swatch = wrapper.querySelector('[data-role="color-swatch"]');
      const textInput = wrapper.querySelector('[data-role="color-text"]');
      values[key] = target.value;
      if (target === swatch && textInput) {
        textInput.value = target.value;
      } else if (swatch) {
        const normalized = normalizeHexColor(target.value);
        if (normalized) {
          swatch.value = normalized;
        }
      }
    } else if (role === "range" || role === "range-number") {
      const fieldConfig = item.fields.find((entry) => entry.key === key);
      const wrapper = target.closest(".field");
      const rangeInput = wrapper.querySelector('[data-role="range"]');
      const numberInput = wrapper.querySelector('[data-role="range-number"]');
      if (target === rangeInput) {
        values[key] = Number(target.value);
        if (numberInput) {
          numberInput.value = target.value;
        }
      } else {
        let nextValue = target.value === "" ? "" : Number(target.value);
        if (nextValue !== "" && fieldConfig) {
          if (fieldConfig.min !== undefined && nextValue < Number(fieldConfig.min)) {
            nextValue = Number(fieldConfig.min);
          }
          if (fieldConfig.max !== undefined && nextValue > Number(fieldConfig.max)) {
            nextValue = Number(fieldConfig.max);
          }
        }
        values[key] = nextValue;
        if (rangeInput) {
          rangeInput.value = nextValue === "" ? rangeInput.min : nextValue;
        }
        if (nextValue !== "" && String(nextValue) !== target.value) {
          target.value = nextValue;
        }
      }
    } else {
      values[key] = target.value;
    }

    applyConditionalVisibility(item, values);
    updateOptionsCount(item, values);
    refreshOutput(item, values);
  }

  function handleFormClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.action;
    const { item } = currentLocation();
    const values = getValues(item);

    if (action === "cycle-unit") {
      const fieldConfig = item.fields.find((entry) => entry.key === button.dataset.field);
      if (!fieldConfig || !Array.isArray(fieldConfig.units) || fieldConfig.units.length < 2) {
        return;
      }
      const unitKey = `${fieldConfig.key}Unit`;
      const current = values[unitKey] || fieldConfig.defaultUnit || fieldConfig.units[0];
      const nextIndex = (fieldConfig.units.indexOf(current) + 1) % fieldConfig.units.length;
      const nextUnit = fieldConfig.units[nextIndex];
      values[unitKey] = nextUnit;
      button.textContent = nextUnit;
      button.setAttribute("aria-label", `${fieldConfig.label}单位，当前为 ${nextUnit}，点击切换`);
      refreshOutput(item, values);
      return;
    }

    const scrollTop = elements.form.scrollTop;

    if (action === "add-shadow") {
      const fieldConfig = item.fields.find((entry) => entry.type === "shadow-list");
      if (!fieldConfig) {
        return;
      }
      const list = values[fieldConfig.key];
      if ((fieldConfig.kind || "box") === "text") {
        list.push({ color: "#94a3b8", x: 2, y: 2, blur: 4 });
      } else {
        list.push({ inset: false, color: "#1f2937", x: 0, y: 8, blur: 20, spread: -4 });
      }
    } else if (action === "remove-shadow") {
      const fieldConfig = item.fields.find((entry) => entry.type === "shadow-list");
      if (!fieldConfig) {
        return;
      }
      const list = values[fieldConfig.key];
      const index = Number(button.dataset.index);
      if (list.length <= 1 || !list[index]) {
        return;
      }
      list.splice(index, 1);
    } else if (action === "add-stop") {
      const fieldConfig = item.fields.find((entry) => entry.type === "color-stops");
      if (!fieldConfig) {
        return;
      }
      const list = values[fieldConfig.key];
      const palette = ["#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7"];
      list.push({ color: palette[list.length % palette.length], position: 50 });
    } else if (action === "remove-stop") {
      const fieldConfig = item.fields.find((entry) => entry.type === "color-stops");
      if (!fieldConfig) {
        return;
      }
      const list = values[fieldConfig.key];
      const index = Number(button.dataset.index);
      if (list.length <= 2 || !list[index]) {
        return;
      }
      list.splice(index, 1);
    } else {
      return;
    }

    renderForm(item);
    elements.form.scrollTop = scrollTop;
    refreshOutput(item, getValues(item));
  }

  async function writeClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        // 无焦点等场景下继续使用兼容方案
      }
    }
    fallbackCopy(text);
  }

  function flashCopyButton(button, idleLabel) {
    button.textContent = "已复制";
    window.clearTimeout(copyResetTimers.get(button));
    copyResetTimers.set(button, window.setTimeout(() => {
      button.textContent = idleLabel;
    }, 1600));
  }

  async function copyCode() {
    if (!lastCode) {
      return;
    }
    try {
      await writeClipboard(lastCode);
      flashCopyButton(elements.copy, copyIdleLabel());
      showToast(lastSections && lastSections.length ? "全部代码已复制到剪贴板" : "代码已复制到剪贴板");
    } catch (error) {
      console.error(error);
      showToast("复制失败，请手动选中代码复制");
    }
  }

  async function copySection(button) {
    const index = Number(button.dataset.copySection);
    const section = lastSections && lastSections[index];
    if (!section) {
      return;
    }
    try {
      await writeClipboard(section.code);
      flashCopyButton(button, "复制");
      showToast(`${section.label}代码已复制`);
    } catch (error) {
      console.error(error);
      showToast("复制失败，请手动选中代码复制");
    }
  }

  function fallbackCopy(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) {
      throw new Error("copy command failed");
    }
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, 1700);
  }

  function bindEvents() {
    elements.navToggles.forEach((button) => {
      button.addEventListener("click", () => {
        setNavExpanded(!navExpanded);
      });
    });

    elements.tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => {
        switchMode(tab.dataset.mode);
      });
      tab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
          return;
        }
        event.preventDefault();
        const offset = event.key === "ArrowRight" ? 1 : -1;
        const nextTab = elements.tabs[(index + offset + elements.tabs.length) % elements.tabs.length];
        switchMode(nextTab.dataset.mode);
        nextTab.focus();
      });
    });

    elements.search.addEventListener("input", () => {
      appState.query = elements.search.value;
      renderNav();
    });

    elements.search.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && elements.search.value) {
        event.stopPropagation();
        elements.search.value = "";
        appState.query = "";
        renderNav();
      }
    });

    elements.nav.addEventListener("click", (event) => {
      const button = event.target.closest("[data-generator-id]");
      if (button) {
        if (navExpanded) {
          setNavExpanded(false);
        }
        selectGenerator(button.dataset.generatorId);
      }
    });

    elements.mobileSelect.addEventListener("change", () => {
      selectGenerator(elements.mobileSelect.value);
    });

    elements.form.addEventListener("input", handleFormEvent);
    elements.form.addEventListener("change", handleFormEvent);
    elements.form.addEventListener("click", handleFormClick);
    elements.form.addEventListener("submit", (event) => event.preventDefault());

    elements.reset.addEventListener("click", resetCurrent);
    elements.copy.addEventListener("click", copyCode);
    elements.codeOutput.addEventListener("click", (event) => {
      const button = event.target.closest("[data-copy-section]");
      if (button) {
        copySection(button);
      }
    });
    elements.preview.addEventListener("load", handlePreviewLoad);

    window.addEventListener("hashchange", () => {
      if (navExpanded) {
        setNavExpanded(false, { restoreFocus: false });
      }
      applyHash();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && navExpanded) {
        event.preventDefault();
        setNavExpanded(false);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        if (window.matchMedia("(max-width: 960px)").matches) {
          return;
        }
        event.preventDefault();
        elements.search.focus();
        elements.search.select();
      }
    });
  }

  bindEvents();
  applyHash();
})();
