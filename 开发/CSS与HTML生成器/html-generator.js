const htmlCategories = [
  { id: "input", title: "输入" },
  { id: "media", title: "媒体" },
  { id: "text", title: "文本" },
  { id: "other", title: "其他" }
];

const imagePlaceholder = svgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs>
      <linearGradient id="g" x1="0%" x2="100%" y1="0%" y2="100%">
        <stop offset="0%" stop-color="#2d65ff"/>
        <stop offset="100%" stop-color="#1bb9a4"/>
      </linearGradient>
    </defs>
    <rect width="640" height="360" rx="28" fill="url(#g)"/>
    <text x="50%" y="46%" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" font-size="42" font-family="Segoe UI, Microsoft YaHei, sans-serif">图片占位</text>
    <text x="50%" y="58%" text-anchor="middle" dominant-baseline="middle" fill="#d8e8ff" font-size="20" font-family="Segoe UI, Microsoft YaHei, sans-serif">webcode.tools 中文版</text>
  </svg>
`);

const htmlTools = [
  {
    id: "inputButton",
    category: "input",
    title: "按钮输入",
    desc: "生成 <input type=\"button\">。",
    defaults: { value: "打开面板", name: "openPanel", disabled: false },
    fields: [
      textField("value", "按钮文字", true),
      textField("name", "name 属性"),
      checkboxField("disabled", "禁用按钮", true)
    ],
    render(state) {
      return `<input type="button"${attr("name", state.name)}${attr("value", state.value)}${boolAttr("disabled", state.disabled)}>`;
    }
  },
  {
    id: "checkboxRadio",
    category: "input",
    title: "复选框与单选框",
    desc: "同时生成复选框和单选框。",
    defaults: {
      checkboxLabel: "接受协议",
      radioLabelA: "方案 A",
      radioLabelB: "方案 B",
      checked: true,
      radioChecked: "A",
      radioName: "plan"
    },
    fields: [
      textField("checkboxLabel", "复选框文字", true),
      textField("radioLabelA", "单选项 A"),
      textField("radioLabelB", "单选项 B"),
      textField("radioName", "单选组 name"),
      checkboxField("checked", "默认勾选复选框", true),
      selectField("radioChecked", "默认选中项", ["A", "B"])
    ],
    render(state) {
      return `
<label><input type="checkbox"${boolAttr("checked", state.checked)}> ${escapeHtml(state.checkboxLabel)}</label>
<br>
<label><input type="radio"${attr("name", state.radioName)}${state.radioChecked === "A" ? " checked" : ""}> ${escapeHtml(state.radioLabelA)}</label>
<label style="margin-left:16px;"><input type="radio"${attr("name", state.radioName)}${state.radioChecked === "B" ? " checked" : ""}> ${escapeHtml(state.radioLabelB)}</label>`.trim();
    }
  },
  {
    id: "colorInput",
    category: "input",
    title: "颜色输入",
    desc: "生成颜色选择器。",
    defaults: { name: "themeColor", value: "#2d65ff" },
    fields: [textField("name", "name 属性"), colorField("value", "默认颜色", true)],
    render(state) {
      return `<input type="color"${attr("name", state.name)}${attr("value", state.value)}>`;
    }
  },
  {
    id: "dateTimeInput",
    category: "input",
    title: "日期与时间输入",
    desc: "把日期时间类输入框合并到一个生成器中。",
    defaults: { subtype: "datetime-local", name: "scheduleAt", value: "2026-04-22T10:30", min: "", max: "" },
    fields: [
      selectField("subtype", "输入类型", ["date", "time", "datetime-local", "month", "week"], true),
      textField("name", "name 属性"),
      textField("value", "默认值", true),
      textField("min", "最小值"),
      textField("max", "最大值")
    ],
    render(state) {
      return `<input${attr("type", state.subtype)}${attr("name", state.name)}${attr("value", state.value)}${attr("min", state.min)}${attr("max", state.max)}>`;
    }
  },
  {
    id: "emailInput",
    category: "input",
    title: "邮箱输入",
    desc: "生成邮箱输入框。",
    defaults: { name: "email", placeholder: "name@example.com", value: "", required: false },
    fields: [
      textField("name", "name 属性"),
      textField("placeholder", "占位提示", true),
      textField("value", "默认值", true),
      checkboxField("required", "必填", true)
    ],
    render(state) {
      return `<input type="email"${attr("name", state.name)}${attr("placeholder", state.placeholder)}${attr("value", state.value)}${boolAttr("required", state.required)}>`;
    }
  },
  {
    id: "fileInput",
    category: "input",
    title: "文件输入",
    desc: "生成文件上传控件。",
    defaults: { name: "attachment", accept: ".png,.jpg,.pdf", multiple: false },
    fields: [
      textField("name", "name 属性"),
      textField("accept", "accept 属性", true),
      checkboxField("multiple", "允许多选", true)
    ],
    render(state) {
      return `<input type="file"${attr("name", state.name)}${attr("accept", state.accept)}${boolAttr("multiple", state.multiple)}>`;
    }
  },
  {
    id: "imageInput",
    category: "input",
    title: "图片输入",
    desc: "生成 <input type=\"image\">。",
    defaults: { src: imagePlaceholder, alt: "图像按钮", width: 160, height: 90 },
    fields: [
      textareaField("src", "图片地址", true),
      textField("alt", "alt 文本", true),
      numberField("width", "宽度", 40, 640, 1, "", false),
      numberField("height", "高度", 40, 360, 1, "", false)
    ],
    render(state) {
      return `<input type="image"${attr("src", state.src)}${attr("alt", state.alt)}${attr("width", state.width)}${attr("height", state.height)}>`;
    }
  },
  {
    id: "numberInput",
    category: "input",
    title: "数字输入",
    desc: "生成数字输入框。",
    defaults: { name: "quantity", min: 1, max: 99, step: 1, value: 3 },
    fields: [
      textField("name", "name 属性"),
      numberField("min", "最小值", -9999, 9999, 1),
      numberField("max", "最大值", -9999, 9999, 1),
      numberField("step", "步进值", 1, 100, 1),
      numberField("value", "默认值", -9999, 9999, 1, "", true)
    ],
    render(state) {
      return `<input type="number"${attr("name", state.name)}${attr("min", state.min)}${attr("max", state.max)}${attr("step", state.step)}${attr("value", state.value)}>`;
    }
  },
  {
    id: "passwordInput",
    category: "input",
    title: "密码输入",
    desc: "生成密码输入框。",
    defaults: { name: "password", placeholder: "请输入密码", minlength: 6, maxlength: 20, required: true },
    fields: [
      textField("name", "name 属性"),
      textField("placeholder", "占位提示", true),
      numberField("minlength", "最短长度", 1, 100, 1),
      numberField("maxlength", "最长长度", 1, 200, 1),
      checkboxField("required", "必填", true)
    ],
    render(state) {
      return `<input type="password"${attr("name", state.name)}${attr("placeholder", state.placeholder)}${attr("minlength", state.minlength)}${attr("maxlength", state.maxlength)}${boolAttr("required", state.required)}>`;
    }
  },
  {
    id: "rangeInput",
    category: "input",
    title: "范围输入",
    desc: "生成滑块输入控件。",
    defaults: { name: "volume", min: 0, max: 100, step: 1, value: 68 },
    fields: [
      textField("name", "name 属性"),
      numberField("min", "最小值", -1000, 1000, 1),
      numberField("max", "最大值", -1000, 1000, 1),
      numberField("step", "步进值", 1, 100, 1),
      numberField("value", "默认值", -1000, 1000, 1, "", true)
    ],
    render(state) {
      return `<input type="range"${attr("name", state.name)}${attr("min", state.min)}${attr("max", state.max)}${attr("step", state.step)}${attr("value", state.value)}>`;
    }
  },
  {
    id: "searchInput",
    category: "input",
    title: "搜索输入",
    desc: "生成搜索输入框。",
    defaults: { name: "keyword", placeholder: "搜索关键词", value: "" },
    fields: [
      textField("name", "name 属性"),
      textField("placeholder", "占位提示", true),
      textField("value", "默认值", true)
    ],
    render(state) {
      return `<input type="search"${attr("name", state.name)}${attr("placeholder", state.placeholder)}${attr("value", state.value)}>`;
    }
  },
  {
    id: "submitInput",
    category: "input",
    title: "提交输入",
    desc: "生成提交按钮输入框。",
    defaults: { value: "提交表单", disabled: false },
    fields: [
      textField("value", "按钮文字", true),
      checkboxField("disabled", "禁用按钮", true)
    ],
    render(state) {
      return `<input type="submit"${attr("value", state.value)}${boolAttr("disabled", state.disabled)}>`;
    }
  },
  {
    id: "telephoneInput",
    category: "input",
    title: "电话输入",
    desc: "生成电话输入框。",
    defaults: { name: "mobile", placeholder: "13800000000", value: "", pattern: "[0-9]{11}" },
    fields: [
      textField("name", "name 属性"),
      textField("placeholder", "占位提示", true),
      textField("value", "默认值"),
      textField("pattern", "pattern 规则", true)
    ],
    render(state) {
      return `<input type="tel"${attr("name", state.name)}${attr("placeholder", state.placeholder)}${attr("value", state.value)}${attr("pattern", state.pattern)}>`;
    }
  },
  {
    id: "textInput",
    category: "input",
    title: "文本输入",
    desc: "生成文本输入框。",
    defaults: { name: "username", placeholder: "请输入用户名", value: "", maxlength: 30, required: false },
    fields: [
      textField("name", "name 属性"),
      textField("placeholder", "占位提示", true),
      textField("value", "默认值", true),
      numberField("maxlength", "最大长度", 1, 200, 1),
      checkboxField("required", "必填", true)
    ],
    render(state) {
      return `<input type="text"${attr("name", state.name)}${attr("placeholder", state.placeholder)}${attr("value", state.value)}${attr("maxlength", state.maxlength)}${boolAttr("required", state.required)}>`;
    }
  },
  {
    id: "textarea",
    category: "input",
    title: "文本域",
    desc: "生成 textarea。",
    defaults: { name: "message", rows: 5, cols: 40, placeholder: "请输入多行内容", content: "这里是默认文本", required: false },
    fields: [
      textField("name", "name 属性"),
      numberField("rows", "行数", 2, 20, 1),
      numberField("cols", "列数", 10, 80, 1),
      textField("placeholder", "占位提示", true),
      textareaField("content", "默认文本", true),
      checkboxField("required", "必填", true)
    ],
    render(state) {
      return `<textarea${attr("name", state.name)}${attr("rows", state.rows)}${attr("cols", state.cols)}${attr("placeholder", state.placeholder)}${boolAttr("required", state.required)}>${escapeHtml(state.content)}</textarea>`;
    }
  },
  {
    id: "urlInput",
    category: "input",
    title: "网址输入",
    desc: "生成网址输入框。",
    defaults: { name: "website", placeholder: "https://example.com", value: "", required: false },
    fields: [
      textField("name", "name 属性"),
      textField("placeholder", "占位提示", true),
      textField("value", "默认值", true),
      checkboxField("required", "必填", true)
    ],
    render(state) {
      return `<input type="url"${attr("name", state.name)}${attr("placeholder", state.placeholder)}${attr("value", state.value)}${boolAttr("required", state.required)}>`;
    }
  },
  {
    id: "audioPlayer",
    category: "media",
    title: "音频播放器",
    desc: "生成带 controls 的 audio 标签。",
    defaults: { src: "", controls: true, autoplay: false, loop: false },
    fields: [
      textField("src", "音频地址", true),
      checkboxField("controls", "显示控制条", true),
      checkboxField("autoplay", "自动播放", true),
      checkboxField("loop", "循环播放", true)
    ],
    render(state) {
      return `<audio${attr("src", state.src)}${boolAttr("controls", state.controls)}${boolAttr("autoplay", state.autoplay)}${boolAttr("loop", state.loop)}></audio>`;
    }
  },
  {
    id: "image",
    category: "media",
    title: "图片",
    desc: "生成 img 标签。",
    defaults: { src: imagePlaceholder, alt: "示例图片", width: 320, height: 180, loading: "lazy" },
    fields: [
      textareaField("src", "图片地址", true),
      textField("alt", "alt 文本", true),
      numberField("width", "宽度", 40, 1200, 1),
      numberField("height", "高度", 40, 900, 1),
      selectField("loading", "加载方式", ["lazy", "eager"])
    ],
    render(state) {
      return `<img${attr("src", state.src)}${attr("alt", state.alt)}${attr("width", state.width)}${attr("height", state.height)}${attr("loading", state.loading)}>`;
    }
  },
  {
    id: "videoPlayer",
    category: "media",
    title: "视频播放器",
    desc: "生成 video 标签。",
    defaults: { src: "", poster: imagePlaceholder, width: 420, height: 236, controls: true, loop: false, muted: false },
    fields: [
      textField("src", "视频地址", true),
      textareaField("poster", "海报图地址", true),
      numberField("width", "宽度", 100, 1200, 1),
      numberField("height", "高度", 80, 900, 1),
      checkboxField("controls", "显示控制条", true),
      checkboxField("loop", "循环播放", true),
      checkboxField("muted", "静音", true)
    ],
    render(state) {
      return `<video${attr("src", state.src)}${attr("poster", state.poster)}${attr("width", state.width)}${attr("height", state.height)}${boolAttr("controls", state.controls)}${boolAttr("loop", state.loop)}${boolAttr("muted", state.muted)}></video>`;
    }
  },
  {
    id: "bdo",
    category: "text",
    title: "双向文本覆盖",
    desc: "生成 bdo 标签。",
    defaults: { dir: "rtl", text: "abc 123 你好" },
    fields: [selectField("dir", "文本方向", ["rtl", "ltr"]), textField("text", "文字内容", true)],
    render(state) {
      return `<bdo${attr("dir", state.dir)}>${escapeHtml(state.text)}</bdo>`;
    }
  },
  {
    id: "bold",
    category: "text",
    title: "粗体",
    desc: "生成 <b> 标签。",
    defaults: { text: "加粗文本" },
    fields: [textField("text", "文字内容", true)],
    render(state) {
      return `<b>${escapeHtml(state.text)}</b>`;
    }
  },
  {
    id: "cite",
    category: "text",
    title: "引用来源",
    desc: "生成 cite 标签。",
    defaults: { text: "《设计中的设计》" },
    fields: [textField("text", "引用名称", true)],
    render(state) {
      return `<cite>${escapeHtml(state.text)}</cite>`;
    }
  },
  {
    id: "code",
    category: "text",
    title: "代码",
    desc: "生成 code 标签。",
    defaults: { text: "const total = price * count;" },
    fields: [textareaField("text", "代码内容", true)],
    render(state) {
      return `<code>${escapeHtml(state.text)}</code>`;
    }
  },
  {
    id: "italic",
    category: "text",
    title: "斜体",
    desc: "生成 <i> 标签。",
    defaults: { text: "斜体文本" },
    fields: [textField("text", "文字内容", true)],
    render(state) {
      return `<i>${escapeHtml(state.text)}</i>`;
    }
  },
  {
    id: "mark",
    category: "text",
    title: "高亮标记",
    desc: "生成 mark 标签。",
    defaults: { text: "重点高亮内容" },
    fields: [textField("text", "高亮文本", true)],
    render(state) {
      return `<mark>${escapeHtml(state.text)}</mark>`;
    }
  },
  {
    id: "quoteBlockquote",
    category: "text",
    title: "行内引用与块引用",
    desc: "同时生成 q 与 blockquote。",
    defaults: { inlineQuote: "简短引用", blockQuote: "真正重要的不是你拥有多少，而是你能创造什么。", cite: "https://example.com" },
    fields: [
      textField("inlineQuote", "行内引用", true),
      textareaField("blockQuote", "块级引用", true),
      textField("cite", "cite 地址", true)
    ],
    render(state) {
      return `
<p><q>${escapeHtml(state.inlineQuote)}</q></p>
<blockquote${attr("cite", state.cite)}>${escapeHtml(state.blockQuote)}</blockquote>`.trim();
    }
  },
  {
    id: "strikethrough",
    category: "text",
    title: "删除线",
    desc: "生成 s 标签。",
    defaults: { text: "原价 ¥399" },
    fields: [textField("text", "文字内容", true)],
    render(state) {
      return `<s>${escapeHtml(state.text)}</s>`;
    }
  },
  {
    id: "superscriptSubscript",
    category: "text",
    title: "上标与下标",
    desc: "同时生成 sup 和 sub。",
    defaults: { normal: "H2O 与 x2", sup: "2", sub: "2" },
    fields: [
      textField("normal", "基础文本", true),
      textField("sup", "上标内容"),
      textField("sub", "下标内容")
    ],
    render(state) {
      return `<div>${escapeHtml(state.normal)}<sup>${escapeHtml(state.sup)}</sup> / H<sub>${escapeHtml(state.sub)}</sub>O</div>`;
    }
  },
  {
    id: "underline",
    category: "text",
    title: "下划线",
    desc: "生成 u 标签。",
    defaults: { text: "带下划线的文本" },
    fields: [textField("text", "文字内容", true)],
    render(state) {
      return `<u>${escapeHtml(state.text)}</u>`;
    }
  },
  {
    id: "details",
    category: "other",
    title: "详情折叠",
    desc: "生成 details + summary。",
    defaults: { summary: "点击展开更多内容", content: "这里是展开区域的正文内容。", open: false },
    fields: [
      textField("summary", "摘要标题", true),
      textareaField("content", "正文内容", true),
      checkboxField("open", "默认展开", true)
    ],
    render(state) {
      return `<details${boolAttr("open", state.open)}><summary>${escapeHtml(state.summary)}</summary><p>${escapeHtml(state.content)}</p></details>`;
    }
  },
  {
    id: "dialog",
    category: "other",
    title: "对话框",
    desc: "生成 dialog 标签。",
    defaults: { title: "提示信息", content: "这是一段对话框正文。", open: true },
    fields: [
      textField("title", "标题", true),
      textareaField("content", "正文内容", true),
      checkboxField("open", "默认显示", true)
    ],
    render(state) {
      return `<dialog${boolAttr("open", state.open)}><strong>${escapeHtml(state.title)}</strong><p>${escapeHtml(state.content)}</p></dialog>`;
    }
  },
  {
    id: "hyperlink",
    category: "other",
    title: "超链接",
    desc: "生成 a 标签。",
    defaults: { href: "https://example.com", text: "访问示例网站", title: "示例链接", newTab: true },
    fields: [
      textField("href", "链接地址", true),
      textField("text", "显示文字"),
      textField("title", "title 属性"),
      checkboxField("newTab", "新窗口打开", true)
    ],
    render(state) {
      return `<a${attr("href", state.href)}${attr("title", state.title)}${state.newTab ? ' target="_blank" rel="noreferrer noopener"' : ""}>${escapeHtml(state.text)}</a>`;
    }
  },
  {
    id: "iframe",
    category: "other",
    title: "内联框架",
    desc: "生成 iframe 标签。",
    defaults: { src: "about:blank", title: "内嵌页面", width: 420, height: 240, loading: "lazy", allowFullscreen: false },
    fields: [
      textField("src", "页面地址", true),
      textField("title", "title 属性", true),
      numberField("width", "宽度", 120, 1400, 1),
      numberField("height", "高度", 80, 1000, 1),
      selectField("loading", "加载方式", ["lazy", "eager"]),
      checkboxField("allowFullscreen", "允许全屏", true)
    ],
    render(state) {
      return `<iframe${attr("src", state.src)}${attr("title", state.title)}${attr("width", state.width)}${attr("height", state.height)}${attr("loading", state.loading)}${boolAttr("allowfullscreen", state.allowFullscreen)}></iframe>`;
    }
  },
  {
    id: "meter",
    category: "other",
    title: "仪表值",
    desc: "生成 meter 标签。",
    defaults: { value: 0.68, min: 0, max: 1, low: 0.35, high: 0.8, optimum: 0.9 },
    fields: [
      numberField("value", "当前值", 0, 1000, 0.01),
      numberField("min", "最小值", 0, 1000, 0.01),
      numberField("max", "最大值", 0, 1000, 0.01),
      numberField("low", "low", 0, 1000, 0.01),
      numberField("high", "high", 0, 1000, 0.01),
      numberField("optimum", "optimum", 0, 1000, 0.01)
    ],
    render(state) {
      return `<meter${attr("value", state.value)}${attr("min", state.min)}${attr("max", state.max)}${attr("low", state.low)}${attr("high", state.high)}${attr("optimum", state.optimum)}>${escapeHtml(String(state.value))}</meter>`;
    }
  },
  {
    id: "progress",
    category: "other",
    title: "进度条",
    desc: "生成 progress 标签。",
    defaults: { value: 68, max: 100 },
    fields: [
      numberField("value", "当前值", 0, 10000, 1),
      numberField("max", "最大值", 1, 10000, 1)
    ],
    render(state) {
      return `<progress${attr("value", state.value)}${attr("max", state.max)}>${escapeHtml(String(state.value))}</progress>`;
    }
  },
  {
    id: "metaTags",
    category: "other",
    title: "Meta 标签",
    desc: "一次生成常用页面元信息标签。",
    defaults: {
      title: "webcode.tools 中文版",
      description: "一个带中文说明的 HTML/CSS 代码生成器页面。",
      keywords: "html generator, css generator, 中文代码生成器",
      viewport: "width=device-width, initial-scale=1.0",
      robots: "index, follow"
    },
    fields: [
      textField("title", "页面标题", true),
      textareaField("description", "页面描述", true),
      textareaField("keywords", "关键词", true),
      textField("viewport", "viewport 内容", true),
      textField("robots", "robots 内容", true)
    ],
    render(state) {
      return {
        code: [
          `<title>${escapeHtml(state.title)}</title>`,
          `<meta name="description" content="${escapeAttr(state.description)}">`,
          `<meta name="keywords" content="${escapeAttr(state.keywords)}">`,
          `<meta name="viewport" content="${escapeAttr(state.viewport)}">`,
          `<meta name="robots" content="${escapeAttr(state.robots)}">`
        ].join("\n"),
        previewHtml: `
          <div class="demo-html-card">
            <h3 style="margin-top:0;">页面元信息预览</h3>
            <p><strong>Title：</strong>${escapeHtml(state.title)}</p>
            <p><strong>Description：</strong>${escapeHtml(state.description)}</p>
            <p><strong>Keywords：</strong>${escapeHtml(state.keywords)}</p>
            <p><strong>Viewport：</strong><code>${escapeHtml(state.viewport)}</code></p>
            <p><strong>Robots：</strong><code>${escapeHtml(state.robots)}</code></p>
          </div>
        `
      };
    }
  }
];

const htmlState = Object.fromEntries(htmlTools.map((tool) => [tool.id, { ...tool.defaults }]));
let currentToolId = "inputButton";

const categoryNavEl = document.getElementById("categoryNav");
const fieldGridEl = document.getElementById("fieldGrid");
const toolTitleEl = document.getElementById("toolTitle");
const toolDescEl = document.getElementById("toolDesc");
const previewWrapEl = document.getElementById("previewWrap");
const codeBlockEl = document.getElementById("codeBlock");
const copyButtonEl = document.getElementById("copyButton");
const copyMessageEl = document.getElementById("copyMessage");

renderApp();

copyButtonEl.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(codeBlockEl.textContent);
    copyMessageEl.textContent = "HTML 已复制到剪贴板。";
  } catch (error) {
    copyMessageEl.textContent = "当前环境不支持直接复制，请手动选中代码。";
  }
});

function renderApp() {
  renderSidebar();
  renderToolPanel();
  renderPreview();
}

function currentTool() {
  return htmlTools.find((tool) => tool.id === currentToolId);
}

function renderSidebar() {
  categoryNavEl.innerHTML = htmlCategories.map((category) => {
    const items = htmlTools.filter((tool) => tool.category === category.id);
    return `
      <section class="menu-group">
        <h3 class="menu-title">${category.title}</h3>
        <div class="menu-items">
          ${items.map((tool) => `
            <button class="menu-item${tool.id === currentToolId ? " active" : ""}" type="button" data-id="${tool.id}">
              ${tool.title}
            </button>
          `).join("")}
        </div>
      </section>
    `;
  }).join("");

  categoryNavEl.querySelectorAll(".menu-item").forEach((button) => {
    button.addEventListener("click", () => {
      currentToolId = button.dataset.id;
      copyMessageEl.textContent = "复制后可直接粘贴进页面模板、组件或文档里。";
      renderApp();
    });
  });
}

function renderToolPanel() {
  const tool = currentTool();
  const state = htmlState[tool.id];
  toolTitleEl.textContent = tool.title;
  toolDescEl.textContent = tool.desc;
  fieldGridEl.innerHTML = tool.fields.map((field) => renderField(field, state[field.key])).join("");

  fieldGridEl.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const field = tool.fields.find((item) => item.key === event.target.dataset.field);
      if (!field) return;
      updateState(field, state, event.target);
      renderPreview();
    });
  });
}

function renderPreview() {
  const tool = currentTool();
  const result = tool.render(htmlState[tool.id]);
  if (typeof result === "string") {
    previewWrapEl.innerHTML = `<div class="demo-html-card">${result}</div>`;
    codeBlockEl.textContent = result;
    return;
  }
  previewWrapEl.innerHTML = result.previewHtml;
  codeBlockEl.textContent = result.code;
}

function renderField(field, value) {
  if (field.type === "checkbox") {
    return `
      <div class="field full">
        <label>${field.label}</label>
        <div class="checkbox-line">
          <input id="field-${field.key}" data-field="${field.key}" type="checkbox" ${value ? "checked" : ""}>
          <label for="field-${field.key}">${field.label}</label>
        </div>
      </div>
    `;
  }

  if (field.type === "color") {
    return `
      <div class="field ${field.full ? "full" : ""}">
        <label for="field-${field.key}">${field.label}</label>
        <input id="field-${field.key}" data-field="${field.key}" type="color" value="${escapeAttr(value)}">
      </div>
    `;
  }

  if (field.type === "select") {
    return `
      <div class="field ${field.full ? "full" : ""}">
        <label for="field-${field.key}">${field.label}</label>
        <select id="field-${field.key}" data-field="${field.key}">
          ${field.options.map((option) => `<option value="${escapeAttr(option)}" ${String(option) === String(value) ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
        </select>
      </div>
    `;
  }

  if (field.type === "textarea") {
    return `
      <div class="field ${field.full ? "full" : ""}">
        <label for="field-${field.key}">${field.label}</label>
        <textarea id="field-${field.key}" data-field="${field.key}">${escapeHtml(value)}</textarea>
      </div>
    `;
  }

  return `
    <div class="field ${field.full ? "full" : ""}">
      <label for="field-${field.key}">${field.label}</label>
      <input
        id="field-${field.key}"
        data-field="${field.key}"
        type="${field.type}"
        ${field.min !== undefined ? `min="${field.min}"` : ""}
        ${field.max !== undefined ? `max="${field.max}"` : ""}
        ${field.step !== undefined ? `step="${field.step}"` : ""}
        value="${escapeAttr(value)}"
      >
    </div>
  `;
}

function updateState(field, state, input) {
  if (field.type === "checkbox") {
    state[field.key] = input.checked;
    return;
  }
  if (field.type === "number" || field.type === "range") {
    state[field.key] = Number(input.value);
    return;
  }
  state[field.key] = input.value;
}

function textField(key, label, full = false) {
  return { key, label, type: "text", full };
}

function textareaField(key, label, full = false) {
  return { key, label, type: "textarea", full };
}

function numberField(key, label, min, max, step = 1, unit = "", full = false) {
  return { key, label, type: "number", min, max, step, unit, full };
}

function colorField(key, label, full = false) {
  return { key, label, type: "color", full };
}

function selectField(key, label, options, full = false) {
  return { key, label, type: "select", options, full };
}

function checkboxField(key, label, full = false) {
  return { key, label, type: "checkbox", full };
}

function attr(name, value) {
  if (value === "" || value === null || value === undefined) {
    return "";
  }
  return ` ${name}="${escapeAttr(value)}"`;
}

function boolAttr(name, enabled) {
  return enabled ? ` ${name}` : "";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\n/g, "&#10;");
}

function svgDataUri(svg) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}
