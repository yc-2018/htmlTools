(function () {
  "use strict";

  const {
    attrs,
    escapeHtml: esc,
    indentBlock,
    text,
    textarea,
    number,
    radio,
    checkbox,
    color,
    select
  } = window.Gen;

  const preloadOptions = [
    ["auto", "自动加载"],
    ["metadata", "只加载元数据"],
    ["none", "不预加载"]
  ];

  const referrerOptions = [
    ["no-referrer-when-downgrade", "默认（同协议时发送来源）"],
    ["no-referrer", "不发送来源"],
    ["origin", "只发送来源域名"],
    ["origin-when-cross-origin", "跨域时只发送域名"],
    ["same-origin", "同源时发送来源"],
    ["strict-origin", "只发送来源域名（降级时不发）"],
    ["strict-origin-when-cross-origin", "跨域时只发送域名（降级时不发）"],
    ["unsafe-url", "始终发送完整来源"]
  ];

  const linkTypeOptions = [
    ["url", "普通网址"],
    ["email", "电子邮件"],
    ["tel", "电话号码"],
    ["sms", "短信"]
  ];

  const targetOptions = [
    ["_self", "当前窗口（_self）"],
    ["_blank", "新窗口（_blank）"],
    ["_parent", "父窗口（_parent）"],
    ["_top", "顶层窗口（_top）"]
  ];

  function simpleTextGenerator(id, name, desc, tag, defaultText) {
    return {
      id,
      name,
      desc,
      fields: [
        textarea("text", "文字内容", defaultText, { rows: 2 })
      ],
      build(values) {
        return `<${tag}>${esc(values.text)}</${tag}>`;
      }
    };
  }

  const inputGroup = {
    id: "inputs",
    name: "表单输入",
    items: [
      {
        id: "input-text",
        name: "文本输入框",
        desc: "生成单行文本输入框 input[type=\"text\"]，可设置名称、占位提示与宽度。",
        fields: [
          text("name", "名称（name）", "myInput", { hint: "表单提交和脚本读取时使用的字段名。" }),
          text("placeholder", "占位文字", "请输入内容…"),
          number("size", "可见宽度（size）", 30, { min: 0, step: 1, hint: "以字符数为单位，留空则不生成该属性。" }),
          checkbox("spellcheck", "启用拼写检查", false),
          checkbox("required", "必填", true)
        ],
        build(values) {
          return `<input type="text"${attrs({
            name: values.name,
            placeholder: values.placeholder,
            size: values.size,
            spellcheck: values.spellcheck ? "true" : "",
            required: values.required
          })}>`;
        }
      },
      {
        id: "input-email",
        name: "邮箱输入框",
        desc: "生成邮箱输入框 input[type=\"email\"]，浏览器会自动校验邮箱格式。",
        fields: [
          text("name", "名称（name）", "myEmail"),
          text("placeholder", "占位文字", "you@example.com"),
          number("size", "可见宽度（size）", 30, { min: 0, step: 1 }),
          checkbox("spellcheck", "启用拼写检查", false),
          checkbox("required", "必填", true)
        ],
        build(values) {
          return `<input type="email"${attrs({
            name: values.name,
            placeholder: values.placeholder,
            size: values.size,
            spellcheck: values.spellcheck ? "true" : "",
            required: values.required
          })}>`;
        }
      },
      {
        id: "input-password",
        name: "密码输入框",
        desc: "生成密码输入框 input[type=\"password\"]，输入内容会以掩码显示。",
        fields: [
          text("name", "名称（name）", "myPassword"),
          text("placeholder", "占位文字", "请输入密码"),
          number("size", "可见宽度（size）", 20, { min: 0, step: 1 }),
          checkbox("required", "必填", true)
        ],
        build(values) {
          return `<input type="password"${attrs({
            name: values.name,
            placeholder: values.placeholder,
            size: values.size,
            required: values.required
          })}>`;
        }
      },
      {
        id: "input-search",
        name: "搜索框",
        desc: "生成搜索输入框 input[type=\"search\"]，部分浏览器会显示清除按钮。",
        fields: [
          text("name", "名称（name）", "mySearch"),
          text("placeholder", "占位文字", "搜索…"),
          number("size", "可见宽度（size）", 30, { min: 0, step: 1 }),
          checkbox("spellcheck", "启用拼写检查", false),
          checkbox("required", "必填", true)
        ],
        build(values) {
          return `<input type="search"${attrs({
            name: values.name,
            placeholder: values.placeholder,
            size: values.size,
            spellcheck: values.spellcheck ? "true" : "",
            required: values.required
          })}>`;
        }
      },
      {
        id: "input-url",
        name: "网址输入框",
        desc: "生成网址输入框 input[type=\"url\"]，可配合 pattern 限制网址格式。",
        fields: [
          text("name", "名称（name）", "myUrl"),
          text("placeholder", "占位文字", "https://example.com"),
          text("pattern", "格式规则（pattern）", "https://.*", { hint: "使用 JavaScript 正则表达式，留空则不限制。" }),
          number("size", "可见宽度（size）", 20, { min: 0, step: 1 }),
          checkbox("required", "必填", true)
        ],
        build(values) {
          return `<input type="url"${attrs({
            name: values.name,
            placeholder: values.placeholder,
            pattern: values.pattern,
            size: values.size,
            required: values.required
          })}>`;
        }
      },
      {
        id: "input-telephone",
        name: "电话输入框",
        desc: "生成电话号码输入框 input[type=\"tel\"]，适合手机号或座机号码。",
        fields: [
          text("name", "名称（name）", "myPhone"),
          text("placeholder", "占位文字", "请输入电话号码"),
          number("size", "可见宽度（size）", 20, { min: 0, step: 1 }),
          checkbox("required", "必填", true)
        ],
        build(values) {
          return `<input type="tel"${attrs({
            name: values.name,
            placeholder: values.placeholder,
            size: values.size,
            required: values.required
          })}>`;
        }
      },
      {
        id: "input-number",
        name: "数字输入框",
        desc: "生成数字输入框 input[type=\"number\"]，可设置范围、步长与默认值。",
        fields: [
          text("name", "名称（name）", "myNumber"),
          text("placeholder", "占位文字", ""),
          number("step", "步长（step）", 1, { step: 1 }),
          number("value", "默认值（value）", 1),
          number("min", "最小值（min）", 0),
          number("max", "最大值（max）", 100),
          checkbox("required", "必填", true)
        ],
        build(values) {
          return `<input type="number"${attrs({
            name: values.name,
            placeholder: values.placeholder,
            step: values.step,
            value: values.value,
            min: values.min,
            max: values.max,
            required: values.required
          })}>`;
        }
      },
      {
        id: "input-range",
        name: "范围滑块",
        desc: "生成范围滑块 input[type=\"range\"]，适合调节数值。",
        fields: [
          text("name", "名称（name）", "myRange"),
          number("min", "最小值（min）", 0),
          number("max", "最大值（max）", 100),
          number("step", "步长（step）", 1, { step: 1 }),
          number("value", "默认值（value）", 50)
        ],
        build(values) {
          return `<input type="range"${attrs({
            name: values.name,
            min: values.min,
            max: values.max,
            step: values.step,
            value: values.value
          })}>`;
        }
      },
      {
        id: "input-date-time",
        name: "日期与时间",
        desc: "生成日期、时间、月份或周选择器，默认值会自动匹配所选类型。",
        fields: [
          select("type", "控件类型", "date", [
            ["date", "日期"],
            ["datetime-local", "日期与时间"],
            ["month", "月份"],
            ["week", "周"],
            ["time", "时间"]
          ]),
          text("name", "名称（name）", "myDate"),
          text("value", "默认值", "", { hint: "例如：2026-10-20、2026-10-20T14:30、14:30。留空则不设置。" })
        ],
        build(values) {
          return `<input type="${values.type}"${attrs({
            name: values.name,
            value: values.value
          })}>`;
        }
      },
      {
        id: "input-color",
        name: "颜色选择器",
        desc: "生成颜色选择器 input[type=\"color\"]，返回十六进制颜色值。",
        fields: [
          text("name", "名称（name）", "myColor"),
          color("value", "默认颜色", "#4f46e5")
        ],
        build(values) {
          return `<input type="color"${attrs({
            name: values.name,
            value: values.value
          })}>`;
        }
      },
      {
        id: "input-file",
        name: "文件上传",
        desc: "生成文件选择控件，可限制文件类型并允许选择多个文件。",
        fields: [
          text("name", "名称（name）", "myFile"),
          text("accept", "可接受的文件类型（accept）", "image/*, .pdf", { hint: "多个类型用英文逗号分隔，例如 image/png, .pdf。" }),
          checkbox("multiple", "允许多选", false),
          checkbox("required", "必填", true)
        ],
        build(values) {
          return `<input type="file"${attrs({
            name: values.name,
            accept: values.accept,
            multiple: values.multiple,
            required: values.required
          })}>`;
        }
      },
      {
        id: "input-checkbox-radio",
        name: "复选框 / 单选框",
        desc: "生成带文字标签的复选框或单选框，可选择默认选中。",
        fields: [
          select("type", "控件类型", "checkbox", [
            ["checkbox", "复选框"],
            ["radio", "单选框"]
          ]),
          text("label", "标签文字", "请选择我"),
          text("name", "名称（name）", "myChoice"),
          checkbox("checked", "默认选中", false)
        ],
        build(values) {
          return `<label>\n  <input type="${values.type}"${attrs({
            name: values.name,
            checked: values.checked
          })}>\n  ${esc(values.label)}\n</label>`;
        }
      },
      {
        id: "input-button",
        name: "按钮",
        desc: "生成普通按钮或重置按钮 input[type=\"button|reset\"]。",
        fields: [
          select("type", "按钮类型", "button", [
            ["button", "普通按钮"],
            ["reset", "重置按钮"]
          ]),
          text("text", "按钮文字", "点击我"),
          text("name", "名称（name）", "myButton"),
          checkbox("autofocus", "自动聚焦", false),
          checkbox("disabled", "禁用", false)
        ],
        build(values) {
          return `<input type="${values.type}"${attrs({
            name: values.name,
            value: values.text,
            autofocus: values.autofocus,
            disabled: values.disabled
          })}>`;
        }
      },
      {
        id: "input-submit",
        name: "提交按钮",
        desc: "生成表单提交按钮 input[type=\"submit\"]。",
        fields: [
          text("value", "按钮文字", "提交"),
          text("name", "名称（name）", "mySubmit"),
          checkbox("autofocus", "自动聚焦", false),
          checkbox("disabled", "禁用", false)
        ],
        build(values) {
          return `<input type="submit"${attrs({
            name: values.name,
            value: values.value,
            autofocus: values.autofocus,
            disabled: values.disabled
          })}>`;
        }
      },
      {
        id: "input-image",
        name: "图像按钮",
        desc: "生成图像提交按钮 input[type=\"image\"]，可设置图片、替代文字与尺寸。",
        fields: [
          text("src", "图片地址", "./assets/sample.svg", {
            hint: "默认使用示例图片；也可选择本地图片，生成代码会使用文件名。",
            filePicker: { accept: "image/*", label: "选择文件" }
          }),
          text("alt", "替代文字（alt）", "提交按钮"),
          text("name", "名称（name）", "myButton"),
          number("width", "宽度（width）", 115, { min: 0 }),
          number("height", "高度（height）", 38, { min: 0 }),
          checkbox("disabled", "禁用", false)
        ],
        build(values) {
          return `<input type="image"${attrs({
            src: values.src,
            alt: values.alt,
            name: values.name,
            width: values.width,
            height: values.height,
            disabled: values.disabled
          })}>`;
        }
      },
      {
        id: "textarea",
        name: "多行文本框",
        desc: "生成多行文本输入区域 textarea，可限制字符数量和行列数。",
        fields: [
          text("name", "名称（name）", "myTextarea"),
          text("placeholder", "占位文字", "请输入内容…"),
          textarea("value", "默认内容", "", { rows: 2 }),
          number("cols", "列数（cols）", 20, { min: 0, step: 1 }),
          number("rows", "行数（rows）", 10, { min: 0, step: 1 }),
          number("minlength", "最少字符数", 10, { min: 0, step: 1 }),
          number("maxlength", "最多字符数", 500, { min: 0, step: 1 }),
          checkbox("spellcheck", "启用拼写检查", false),
          checkbox("required", "必填", true)
        ],
        build(values) {
          return `<textarea${attrs({
            name: values.name,
            placeholder: values.placeholder,
            cols: values.cols,
            rows: values.rows,
            minlength: values.minlength,
            maxlength: values.maxlength,
            spellcheck: values.spellcheck ? "true" : "",
            required: values.required
          })}>${esc(values.value)}</textarea>`;
        }
      }
    ]
  };

  const mediaGroup = {
    id: "media",
    name: "媒体",
    items: [
      {
        id: "audio",
        name: "音频播放器",
        desc: "生成带多个音源与备用提示的 audio 播放器。",
        fields: [
          text("ogg", "OGG 音频地址", "", {
            placeholder: "例如：media/sound.ogg",
            hint: "留空则不生成对应的 source 标签；也可选择本地 .ogg 文件试听。",
            filePicker: { accept: ".ogg,.oga,audio/ogg", label: "选择文件" }
          }),
          text("mp3", "MP3 音频地址", "", {
            placeholder: "例如：media/sound.mp3",
            hint: "选择本地文件后会填入文件名，发布时请将音频放在网页同一目录。",
            filePicker: { accept: ".mp3,audio/mpeg", label: "选择文件" }
          }),
          select("preload", "预加载方式（preload）", "auto", preloadOptions),
          checkbox("controls", "显示播放控件", true),
          checkbox("autoplay", "自动播放", false, { hint: "浏览器通常要求静音后才允许自动播放。" }),
          checkbox("loop", "循环播放", false),
          checkbox("muted", "默认静音", false)
        ],
        build(values) {
          const sources = [];
          if (values.ogg) {
            sources.push(`  <source src="${esc(values.ogg)}" type="audio/ogg">`);
          }
          if (values.mp3) {
            sources.push(`  <source src="${esc(values.mp3)}" type="audio/mpeg">`);
          }
          const opening = `<audio${attrs({
            preload: values.preload,
            controls: values.controls,
            autoplay: values.autoplay,
            loop: values.loop,
            muted: values.muted
          })}>`;
          const fallback = "  您的浏览器不支持音频播放。";
          return sources.length
            ? `${opening}\n${sources.join("\n")}\n${fallback}\n</audio>`
            : `${opening}\n${fallback}\n</audio>`;
        }
      },
      {
        id: "image",
        name: "图片",
        desc: "生成 img 图片标签，可设置来源、替代文字与宽高。",
        fields: [
          text("src", "图片地址", "./assets/sample.svg", {
            hint: "默认使用示例图片；也可选择本地图片，生成代码会使用文件名。",
            filePicker: { accept: "image/*", label: "选择文件" }
          }),
          text("alt", "替代文字（alt）", "示例图片"),
          number("width", "宽度（width）", 400, { min: 0 }),
          number("height", "高度（height）", "", { min: 0, hint: "留空则按图片原始比例显示。" })
        ],
        build(values) {
          return `<img${attrs({
            src: values.src,
            alt: values.alt,
            width: values.width,
            height: values.height
          })}>`;
        }
      },
      {
        id: "video",
        name: "视频播放器",
        desc: "生成带 MP4 / WebM 音源、封面与备用提示的 video 播放器。",
        fields: [
          text("mp4", "MP4 视频地址", "", {
            placeholder: "例如：media/video.mp4",
            hint: "留空则不生成对应的 source 标签；也可选择本地 .mp4 文件预览。",
            filePicker: { accept: ".mp4,video/mp4", label: "选择文件" }
          }),
          text("webm", "WebM 视频地址", "", {
            placeholder: "例如：media/video.webm",
            hint: "选择本地文件后会填入文件名，发布时请将视频放在网页同一目录。",
            filePicker: { accept: ".webm,video/webm", label: "选择文件" }
          }),
          text("poster", "封面图片", "./assets/sample.svg", {
            hint: "默认使用示例图片；也可选择本地图片作为封面。",
            filePicker: { accept: "image/*", label: "选择文件" }
          }),
          number("width", "宽度（width）", 390, { min: 0 }),
          number("height", "高度（height）", 220, { min: 0 }),
          select("preload", "预加载方式（preload）", "metadata", preloadOptions),
          checkbox("controls", "显示播放控件", true),
          checkbox("autoplay", "自动播放", false, { hint: "浏览器通常要求静音后才允许自动播放。" }),
          checkbox("loop", "循环播放", false),
          checkbox("muted", "默认静音", false),
          checkbox("playsinline", "移动端内联播放", true)
        ],
        build(values) {
          const sources = [];
          if (values.mp4) {
            sources.push(`  <source src="${esc(values.mp4)}" type="video/mp4">`);
          }
          if (values.webm) {
            sources.push(`  <source src="${esc(values.webm)}" type="video/webm">`);
          }
          const opening = `<video${attrs({
            width: values.width,
            height: values.height,
            poster: values.poster,
            preload: values.preload,
            controls: values.controls,
            autoplay: values.autoplay,
            loop: values.loop,
            muted: values.muted,
            playsinline: values.playsinline
          })}>`;
          const fallback = "  您的浏览器不支持视频播放。";
          return sources.length
            ? `${opening}\n${sources.join("\n")}\n${fallback}\n</video>`
            : `${opening}\n${fallback}\n</video>`;
        }
      }
    ]
  };

  const textGroup = {
    id: "text",
    name: "文本",
    items: [
      simpleTextGenerator("strong", "重要文字", "生成 strong 标签，表示内容非常重要。", "strong", "这段文字很重要。"),
      simpleTextGenerator("emphasize", "强调文字", "生成 em 标签，表示需要强调的内容。", "em", "请重点注意这段文字。"),
      simpleTextGenerator("mark", "高亮标记", "生成 mark 标签，为文字添加高亮背景。", "mark", "需要高亮的文字"),
      simpleTextGenerator("strikethrough", "删除线", "生成 s 标签，表示内容已不再准确或有效。", "s", "这条信息已经过期。"),
      simpleTextGenerator("unarticulated", "下划线", "生成 u 标签，为文字添加下划线。", "u", "需要强调的文字"),
      simpleTextGenerator("cite", "作品引用", "生成 cite 标签，用于标记作品、书籍或文章名称。", "cite", "《论语》"),
      {
        ...simpleTextGenerator("code", "行内代码", "生成 code 标签，用于展示一小段代码。", "code", "const message = \"你好\";"),
        fields: [
          textarea("text", "代码内容", "const message = \"你好\";", { rows: 2 })
        ]
      },
      {
        id: "bdi",
        name: "双向文本隔离",
        desc: "生成 bdi 标签，使文字方向与周围内容隔离，常用于混合语言。",
        fields: [
          radio("dir", "文字方向", "auto", [
            ["auto", "自动判断"],
            ["ltr", "从左到右"],
            ["rtl", "从右到左"]
          ]),
          textarea("text", "文字内容", "Hello 世界", { rows: 2 })
        ],
        build(values) {
          return `<bdi dir="${values.dir}">${esc(values.text)}</bdi>`;
        }
      },
      {
        id: "quote-blockquote",
        name: "引用与块引用",
        desc: "生成短引用 q 或块引用 blockquote，可附上引用来源。",
        fields: [
          select("type", "引用类型", "q", [
            ["q", "短引用（q）"],
            ["blockquote", "块引用（blockquote）"]
          ]),
          textarea("text", "引用内容", "想象力比知识更重要。", { rows: 3 }),
          text("cite", "引用来源（cite）", "", { placeholder: "例如：https://example.com/source" })
        ],
        build(values) {
          if (values.type === "q") {
            return `<q${attrs({ cite: values.cite })}>${esc(values.text)}</q>`;
          }
          return `<blockquote${attrs({ cite: values.cite })}>\n${indentBlock(esc(values.text))}\n</blockquote>`;
        }
      },
      {
        id: "superscript-subscript",
        name: "上标 / 下标",
        desc: "生成上标 sup 或下标 sub，适合数学公式、脚注和化学式。",
        fields: [
          select("type", "类型", "sup", [
            ["sup", "上标（sup）"],
            ["sub", "下标（sub）"]
          ]),
          textarea("text", "文字内容", "示例文字", { rows: 2 })
        ],
        build(values) {
          const tag = values.type === "sub" ? "sub" : "sup";
          return `<${tag}>${esc(values.text)}</${tag}>`;
        }
      }
    ]
  };

  const otherGroup = {
    id: "other",
    name: "其他",
    items: [
      {
        id: "details",
        name: "可展开详情",
        desc: "生成 details 折叠面板，点击摘要即可展开或收起内容。",
        fields: [
          text("summary", "摘要文字", "点击查看详情"),
          textarea("content", "展开内容", "这里是可以展开和收起的内容。", { rows: 3 }),
          checkbox("open", "默认展开", false)
        ],
        build(values) {
          const content = esc(values.content).replace(/\n/g, "<br>");
          return `<details${attrs({ open: values.open })}>\n  <summary>${esc(values.summary)}</summary>\n  <p>${content}</p>\n</details>`;
        }
      },
      {
        id: "dialog",
        name: "对话框",
        desc: "生成 dialog 对话框元素；默认展开时无需脚本就能看到效果。",
        fields: [
          textarea("content", "对话框内容", "你好，世界！", { rows: 3 }),
          checkbox("open", "默认展开", true)
        ],
        build(values) {
          const content = esc(values.content).replace(/\n/g, "<br>");
          return `<dialog${attrs({ open: values.open })}>\n  <p>${content}</p>\n</dialog>`;
        }
      },
      {
        id: "hyperlink",
        name: "超链接",
        desc: "生成 a 链接，可设置目标窗口、下载属性与各种 rel 关系。",
        fields: [
          select("type", "链接类型", "url", linkTypeOptions),
          text("url", "链接地址", "https://example.com", { hint: "电子邮件、电话和短信类型只需填写地址部分，工具会自动补全协议。" }),
          text("text", "链接文字", "点击这里"),
          select("target", "打开方式", "_self", targetOptions),
          checkbox("download", "作为文件下载", false),
          checkbox("nofollow", "不传递权重（nofollow）", false),
          checkbox("noreferrer", "不发送来源（noreferrer）", false),
          checkbox("external", "标记为外部链接（external）", false),
          checkbox("help", "标记为帮助链接（help）", false)
        ],
        build(values) {
          let href = values.url.trim() || "#";
          if (values.type === "email") {
            href = `mailto:${values.url}`;
          } else if (values.type === "tel") {
            href = `tel:${values.url}`;
          } else if (values.type === "sms") {
            href = `sms:${values.url}`;
          }
          const rel = [
            values.nofollow ? "nofollow" : "",
            values.noreferrer ? "noreferrer" : "",
            values.external ? "external" : "",
            values.help ? "help" : ""
          ].filter(Boolean).join(" ");
          return `<a${attrs({
            href,
            target: values.target === "_self" ? "" : values.target,
            rel,
            download: values.download
          })}>${esc(values.text)}</a>`;
        }
      },
      {
        id: "iframe",
        name: "内嵌框架",
        desc: "生成 iframe，可设置来源、加载方式、尺寸与来源策略。",
        fields: [
          text("src", "页面地址（src）", "https://example.com"),
          text("name", "名称（name）", "myIFrame"),
          text("title", "标题（title）", "嵌入内容", { hint: "为屏幕阅读器提供说明，建议保留。" }),
          select("loading", "加载方式（loading）", "lazy", [
            ["lazy", "延迟加载"],
            ["eager", "立即加载"]
          ]),
          select("referrerpolicy", "来源策略（referrerpolicy）", "no-referrer-when-downgrade", referrerOptions),
          number("width", "宽度（width）", 360, { min: 0 }),
          number("height", "高度（height）", 220, { min: 0 })
        ],
        build(values) {
          return `<iframe${attrs({
            src: values.src,
            name: values.name,
            title: values.title,
            loading: values.loading,
            referrerpolicy: values.referrerpolicy,
            width: values.width,
            height: values.height
          })}></iframe>`;
        }
      },
      {
        id: "meter",
        name: "度量条",
        desc: "生成 meter 度量条，适合展示磁盘占用、评分等已知范围的数值。",
        fields: [
          number("min", "最小值（min）", 0, { slider: { min: 0, max: 100, step: 1 } }),
          number("max", "最大值（max）", 100, { slider: { min: 0, max: 100, step: 1 } }),
          number("low", "低值界限（low）", 33, { slider: { min: 0, max: 100, step: 1 } }),
          number("high", "高值界限（high）", 66, { slider: { min: 0, max: 100, step: 1 } }),
          number("optimum", "最佳值（optimum）", 80, { slider: { min: 0, max: 100, step: 1 } }),
          number("value", "当前值（value）", 40, { slider: { min: 0, max: 100, step: 1 } })
        ],
        build(values) {
          return `<meter${attrs({
            min: values.min,
            max: values.max,
            low: values.low,
            high: values.high,
            optimum: values.optimum,
            value: values.value
          })}>当前值 ${esc(values.value)}，满分 ${esc(values.max)}</meter>`;
        }
      },
      {
        id: "progress",
        name: "进度条",
        desc: "生成 progress 进度条，用于表示任务完成进度。",
        fields: [
          number("max", "最大值（max）", 100, { slider: { min: 0, max: 100, step: 1 } }),
          number("value", "当前值（value）", 40, { slider: { min: 0, max: 100, step: 1 } })
        ],
        build(values) {
          return `<progress${attrs({
            max: values.max,
            value: values.value
          })}>${esc(values.value)} / ${esc(values.max)}</progress>`;
        }
      }
    ]
  };

  window.HTML_GENERATOR_GROUPS = [inputGroup, mediaGroup, textGroup, otherGroup];
})();
