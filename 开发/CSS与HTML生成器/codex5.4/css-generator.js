const cssCategories = [
  { id: "animation", title: "动画" },
  { id: "background", title: "背景" },
  { id: "box", title: "盒模型" },
  { id: "color", title: "颜色" },
  { id: "filter", title: "滤镜" },
  { id: "layout", title: "布局" },
  { id: "list", title: "列表" },
  { id: "misc", title: "杂项" },
  { id: "text", title: "文本" },
  { id: "transform", title: "变换" },
  { id: "transition", title: "过渡" }
];

const colorfulImage = svgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
    <defs>
      <linearGradient id="g" x1="0%" x2="100%" y1="0%" y2="100%">
        <stop offset="0%" stop-color="#2d65ff"/>
        <stop offset="100%" stop-color="#1bb9a4"/>
      </linearGradient>
    </defs>
    <rect width="480" height="320" rx="28" fill="url(#g)"/>
    <circle cx="110" cy="112" r="56" fill="#ffd166"/>
    <circle cx="360" cy="96" r="42" fill="#ffffff" opacity="0.82"/>
    <rect x="90" y="180" width="300" height="74" rx="24" fill="#ffffff" opacity="0.9"/>
    <text x="240" y="218" text-anchor="middle" dominant-baseline="middle" font-size="26" fill="#173058" font-family="Segoe UI, Microsoft YaHei, sans-serif">Filter Preview</text>
  </svg>
`);

const backgroundTexture = svgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="800" height="520" viewBox="0 0 800 520">
    <defs>
      <linearGradient id="bg" x1="0%" x2="100%" y1="0%" y2="100%">
        <stop offset="0%" stop-color="#2d65ff"/>
        <stop offset="100%" stop-color="#1bb9a4"/>
      </linearGradient>
    </defs>
    <rect width="800" height="520" fill="url(#bg)"/>
    <g fill="rgba(255,255,255,.24)">
      <circle cx="122" cy="112" r="56"/>
      <circle cx="654" cy="158" r="74"/>
      <circle cx="552" cy="420" r="42"/>
    </g>
    <path d="M120 360 Q 260 250 410 360 T 700 350" stroke="#fff" stroke-width="12" fill="none" opacity=".65"/>
  </svg>
`);

let previewCleanup = null;

const cssTools = [
  {
    id: "keyframeAnimation",
    category: "animation",
    title: "关键帧动画",
    desc: "组合位移、旋转和缩放，直接生成 @keyframes 与 animation 写法。",
    defaults: {
      name: "floatIn",
      duration: 1.8,
      timing: "ease-in-out",
      iteration: "infinite",
      direction: "alternate",
      moveX: 0,
      moveY: -24,
      rotate: 0,
      scale: 1.08
    },
    fields: [
      textField("name", "动画名称", true),
      rangeField("duration", "持续时间", 0.2, 10, 0.1, "s"),
      selectField("timing", "缓动函数", ["ease", "ease-in", "ease-out", "ease-in-out", "linear"]),
      selectField("iteration", "重复次数", ["1", "2", "3", "infinite"]),
      selectField("direction", "方向", ["normal", "alternate", "reverse", "alternate-reverse"]),
      rangeField("moveX", "X 位移", -120, 120, 1, "px"),
      rangeField("moveY", "Y 位移", -120, 120, 1, "px"),
      rangeField("rotate", "旋转角度", -180, 180, 1, "deg"),
      rangeField("scale", "缩放比例", 0.2, 2, 0.01, "")
    ],
    render(state) {
      const animationName = normalizeName(state.name) || "demoMotion";
      const keyframeName = "__preview_keyframe__";
      const code = [
        `@keyframes ${animationName} {`,
        "  0% {",
        "    transform: translate(0, 0) rotate(0deg) scale(1);",
        "  }",
        "  100% {",
        `    transform: translate(${state.moveX}px, ${state.moveY}px) rotate(${state.rotate}deg) scale(${state.scale});`,
        "  }",
        "}",
        "",
        ".target {",
        `  animation: ${animationName} ${state.duration}s ${state.timing} ${state.iteration} ${state.direction};`,
        "}"
      ].join("\n");

      const previewHtml = `
        <style>
          @keyframes ${keyframeName} {
            0% { transform: translate(0, 0) rotate(0deg) scale(1); }
            100% { transform: translate(${state.moveX}px, ${state.moveY}px) rotate(${state.rotate}deg) scale(${state.scale}); }
          }
        </style>
        <div class="demo-card" style="animation:${keyframeName} ${state.duration}s ${state.timing} ${state.iteration} ${state.direction}; background:linear-gradient(135deg,#2d65ff,#1bb9a4); color:#fff; font-weight:800;">动画预览</div>
      `;

      return { code, previewHtml };
    }
  },
  simpleTool({
    id: "backgroundColor",
    category: "background",
    title: "背景颜色",
    desc: "快速生成 background-color。",
    property: "background-color",
    defaults: { color: "#2d65ff" },
    fields: [colorField("color", "背景颜色", true)],
    value: (state) => state.color,
    previewBuilder: (value) => previewCard({ backgroundColor: value, color: contrastTextColor(value) }, "背景颜色")
  }),
  {
    id: "backgroundGradient",
    category: "background",
    title: "背景渐变",
    desc: "生成线性渐变背景，可控制角度和三个停靠点。",
    defaults: {
      angle: 135,
      colorA: "#2d65ff",
      colorB: "#1bb9a4",
      colorC: "#ffd166",
      stopA: 0,
      stopB: 58,
      stopC: 100
    },
    fields: [
      rangeField("angle", "角度", 0, 360, 1, "deg"),
      colorField("colorA", "颜色 A"),
      colorField("colorB", "颜色 B"),
      colorField("colorC", "颜色 C"),
      rangeField("stopA", "停靠点 A", 0, 100, 1, "%"),
      rangeField("stopB", "停靠点 B", 0, 100, 1, "%"),
      rangeField("stopC", "停靠点 C", 0, 100, 1, "%")
    ],
    render(state) {
      const gradient = `linear-gradient(${state.angle}deg, ${state.colorA} ${state.stopA}%, ${state.colorB} ${state.stopB}%, ${state.colorC} ${state.stopC}%)`;
      return {
        code: cssBlock([`background: ${gradient}`]),
        previewHtml: previewCard({ background: gradient, color: "#ffffff" }, "渐变背景")
      };
    }
  },
  {
    id: "backgroundImage",
    category: "background",
    title: "背景图片",
    desc: "组合 background-image、size、repeat 和 position。",
    defaults: {
      url: backgroundTexture,
      size: "cover",
      repeat: "no-repeat",
      position: "center center",
      fallback: "#0f1420"
    },
    fields: [
      textareaField("url", "图片地址", true),
      selectField("size", "背景尺寸", ["cover", "contain", "auto", "100% 100%", "160px 160px"]),
      selectField("repeat", "平铺方式", ["no-repeat", "repeat", "repeat-x", "repeat-y", "space", "round"]),
      selectField("position", "定位方式", ["center center", "left top", "right top", "left bottom", "right bottom"]),
      colorField("fallback", "兜底背景色")
    ],
    render(state) {
      const imageValue = `url("${escapeCssUrl(state.url)}")`;
      const lines = [
        `background-color: ${state.fallback}`,
        `background-image: ${imageValue}`,
        `background-size: ${state.size}`,
        `background-repeat: ${state.repeat}`,
        `background-position: ${state.position}`
      ];
      return {
        code: cssBlock(lines),
        previewHtml: previewCard({
          backgroundColor: state.fallback,
          backgroundImage: imageValue,
          backgroundSize: state.size,
          backgroundRepeat: state.repeat,
          backgroundPosition: state.position,
          color: "#ffffff"
        }, "背景图片")
      };
    }
  },
  {
    id: "border",
    category: "box",
    title: "边框",
    desc: "设置边框宽度、样式和颜色。",
    defaults: { width: 4, style: "solid", color: "#2d65ff" },
    fields: [
      rangeField("width", "边框宽度", 0, 24, 1, "px"),
      selectField("style", "边框样式", ["solid", "dashed", "dotted", "double", "groove", "ridge"]),
      colorField("color", "边框颜色", true)
    ],
    render(state) {
      const value = `${state.width}px ${state.style} ${state.color}`;
      return {
        code: cssBlock([`border: ${value}`]),
        previewHtml: previewCard({ border: value }, "Border")
      };
    }
  },
  {
    id: "borderImage",
    category: "box",
    title: "边框图片",
    desc: "用渐变作为 border-image-source，快速搭出彩色边框效果。",
    defaults: {
      width: 10,
      slice: 1,
      outset: 0,
      repeat: "stretch",
      colorA: "#2d65ff",
      colorB: "#1bb9a4"
    },
    fields: [
      rangeField("width", "边框宽度", 1, 30, 1, "px"),
      rangeField("slice", "切片值", 1, 50, 1, ""),
      rangeField("outset", "外扩值", 0, 20, 1, "px"),
      selectField("repeat", "重复方式", ["stretch", "repeat", "round", "space"]),
      colorField("colorA", "颜色 A"),
      colorField("colorB", "颜色 B")
    ],
    render(state) {
      const source = `linear-gradient(135deg, ${state.colorA}, ${state.colorB})`;
      const lines = [
        `border: ${state.width}px solid transparent`,
        `border-image: ${source} ${state.slice} / 1 / ${state.outset}px ${state.repeat}`
      ];
      return {
        code: cssBlock(lines),
        previewHtml: previewCard({
          border: `${state.width}px solid transparent`,
          borderImage: `${source} ${state.slice} / 1 / ${state.outset}px ${state.repeat}`
        }, "Border Image")
      };
    }
  },
  {
    id: "borderRadius",
    category: "box",
    title: "圆角",
    desc: "分别控制四个角的圆角半径。",
    defaults: { tl: 24, tr: 24, br: 24, bl: 24 },
    fields: [
      rangeField("tl", "左上圆角", 0, 120, 1, "px"),
      rangeField("tr", "右上圆角", 0, 120, 1, "px"),
      rangeField("br", "右下圆角", 0, 120, 1, "px"),
      rangeField("bl", "左下圆角", 0, 120, 1, "px")
    ],
    render(state) {
      const value = `${state.tl}px ${state.tr}px ${state.br}px ${state.bl}px`;
      return {
        code: cssBlock([`border-radius: ${value}`]),
        previewHtml: previewCard({ borderRadius: value }, "Border Radius")
      };
    }
  },
  {
    id: "boxResize",
    category: "box",
    title: "盒子缩放",
    desc: "生成 resize 和 overflow 组合，便于调试可拖拽尺寸的区域。",
    defaults: { resize: "both", overflow: "auto" },
    fields: [
      selectField("resize", "缩放方向", ["none", "both", "horizontal", "vertical"]),
      selectField("overflow", "溢出策略", ["auto", "hidden", "scroll", "clip"])
    ],
    render(state) {
      return {
        code: cssBlock([`resize: ${state.resize}`, `overflow: ${state.overflow}`]),
        previewHtml: `
          <textarea class="demo-pre" style="${styleText({
            resize: state.resize,
            overflow: state.overflow,
            width: "320px",
            minHeight: "180px"
          })}">这是一个可调尺寸区域。

拖拽右下角试试缩放效果。</textarea>
        `
      };
    }
  },
  {
    id: "boxShadow",
    category: "box",
    title: "盒子阴影",
    desc: "生成 box-shadow，支持内阴影和透明度控制。",
    defaults: { x: 0, y: 18, blur: 36, spread: -10, color: "#2d65ff", opacity: 18, inset: false },
    fields: [
      rangeField("x", "水平偏移", -100, 100, 1, "px"),
      rangeField("y", "垂直偏移", -100, 100, 1, "px"),
      rangeField("blur", "模糊半径", 0, 120, 1, "px"),
      rangeField("spread", "扩散半径", -80, 80, 1, "px"),
      colorField("color", "阴影颜色"),
      rangeField("opacity", "透明度", 0, 100, 1, "%"),
      checkboxField("inset", "使用内阴影", true)
    ],
    render(state) {
      const value = `${state.inset ? "inset " : ""}${state.x}px ${state.y}px ${state.blur}px ${state.spread}px ${rgba(state.color, state.opacity / 100)}`;
      return {
        code: cssBlock([`box-shadow: ${value}`]),
        previewHtml: previewCard({ boxShadow: value }, "Box Shadow")
      };
    }
  },
  simpleTool({
    id: "opacity",
    category: "box",
    title: "透明度",
    desc: "快速设置 opacity。",
    property: "opacity",
    defaults: { value: 0.82 },
    fields: [rangeField("value", "透明度", 0, 1, 0.01, "")],
    value: (state) => state.value,
    previewBuilder: (value) => previewCard({ opacity: value }, "Opacity")
  }),
  {
    id: "outline",
    category: "box",
    title: "轮廓线",
    desc: "生成 outline 与 outline-offset。",
    defaults: { width: 4, style: "dashed", color: "#ff8f53", offset: 10 },
    fields: [
      rangeField("width", "轮廓宽度", 0, 20, 1, "px"),
      selectField("style", "轮廓样式", ["solid", "dashed", "dotted", "double"]),
      colorField("color", "轮廓颜色"),
      rangeField("offset", "轮廓偏移", -20, 40, 1, "px")
    ],
    render(state) {
      return {
        code: cssBlock([`outline: ${state.width}px ${state.style} ${state.color}`, `outline-offset: ${state.offset}px`]),
        previewHtml: previewCard({
          outline: `${state.width}px ${state.style} ${state.color}`,
          outlineOffset: `${state.offset}px`
        }, "Outline")
      };
    }
  },
  {
    id: "overflow",
    category: "box",
    title: "溢出",
    desc: "分别控制 overflow-x 与 overflow-y。",
    defaults: { x: "auto", y: "hidden" },
    fields: [
      selectField("x", "overflow-x", ["visible", "hidden", "auto", "scroll", "clip"]),
      selectField("y", "overflow-y", ["visible", "hidden", "auto", "scroll", "clip"])
    ],
    render(state) {
      return {
        code: cssBlock([`overflow-x: ${state.x}`, `overflow-y: ${state.y}`]),
        previewHtml: `
          <div class="demo-paragraph" style="${styleText({
            width: "320px",
            height: "170px",
            overflowX: state.x,
            overflowY: state.y
          })}">
            这是一段故意拉得很长的文本。ThisIsAnExtremelyLongWordWithoutSpacesToTriggerOverflowBehaviorAndMakeThePreviewMoreObvious。<br><br>
            继续增加内容，让纵向溢出也更明显。继续增加内容，让纵向溢出也更明显。继续增加内容，让纵向溢出也更明显。
          </div>
        `
      };
    }
  },
  simpleTool({
    id: "textColor",
    category: "color",
    title: "文字颜色",
    desc: "生成 color。",
    property: "color",
    defaults: { color: "#2d65ff" },
    fields: [colorField("color", "文字颜色", true)],
    value: (state) => state.color,
    preview: "text",
    previewBuilder: (value) => previewText({ color: value }, "中文文本预览")
  }),
  filterTool("blur", "filter", "模糊", "filter: blur()", { value: 4 }, [rangeField("value", "模糊半径", 0, 40, 1, "px")], (state) => `blur(${state.value}px)`),
  filterTool("brightness", "filter", "亮度", "filter: brightness()", { value: 1.2 }, [rangeField("value", "亮度", 0, 3, 0.01, "")], (state) => `brightness(${state.value})`),
  filterTool("contrast", "filter", "对比度", "filter: contrast()", { value: 1.3 }, [rangeField("value", "对比度", 0, 3, 0.01, "")], (state) => `contrast(${state.value})`),
  {
    id: "dropShadow",
    category: "filter",
    title: "投影滤镜",
    desc: "生成 filter: drop-shadow()。",
    defaults: { x: 0, y: 10, blur: 18, color: "#16233d", opacity: 0.32 },
    fields: [
      rangeField("x", "水平偏移", -80, 80, 1, "px"),
      rangeField("y", "垂直偏移", -80, 80, 1, "px"),
      rangeField("blur", "模糊半径", 0, 80, 1, "px"),
      colorField("color", "阴影颜色"),
      rangeField("opacity", "透明度", 0, 1, 0.01, "")
    ],
    render(state) {
      const value = `drop-shadow(${state.x}px ${state.y}px ${state.blur}px ${rgba(state.color, state.opacity)})`;
      return {
        code: cssBlock([`filter: ${value}`]),
        previewHtml: previewImage({ filter: value })
      };
    }
  },
  filterTool("grayscale", "filter", "灰度", "filter: grayscale()", { value: 70 }, [rangeField("value", "灰度", 0, 100, 1, "%")], (state) => `grayscale(${state.value}%)`),
  filterTool("hueRotate", "filter", "色相旋转", "filter: hue-rotate()", { value: 110 }, [rangeField("value", "角度", 0, 360, 1, "deg")], (state) => `hue-rotate(${state.value}deg)`),
  filterTool("invert", "filter", "反相", "filter: invert()", { value: 85 }, [rangeField("value", "反相程度", 0, 100, 1, "%")], (state) => `invert(${state.value}%)`),
  filterTool("saturate", "filter", "饱和度", "filter: saturate()", { value: 1.8 }, [rangeField("value", "饱和度", 0, 4, 0.01, "")], (state) => `saturate(${state.value})`),
  filterTool("sepia", "filter", "棕褐色", "filter: sepia()", { value: 75 }, [rangeField("value", "程度", 0, 100, 1, "%")], (state) => `sepia(${state.value}%)`),
  {
    id: "columns",
    category: "layout",
    title: "多栏布局",
    desc: "生成 columns、column-gap 和 column-rule。",
    defaults: { count: 3, width: 160, gap: 24, ruleWidth: 1, ruleStyle: "solid", ruleColor: "#d0d8ea" },
    fields: [
      rangeField("count", "列数", 1, 6, 1, ""),
      rangeField("width", "单列宽度", 80, 320, 1, "px"),
      rangeField("gap", "列间距", 0, 80, 1, "px"),
      rangeField("ruleWidth", "分隔线宽度", 0, 8, 1, "px"),
      selectField("ruleStyle", "分隔线样式", ["solid", "dashed", "dotted", "double"]),
      colorField("ruleColor", "分隔线颜色")
    ],
    render(state) {
      const lines = [
        `columns: ${state.count} ${state.width}px`,
        `column-gap: ${state.gap}px`,
        `column-rule: ${state.ruleWidth}px ${state.ruleStyle} ${state.ruleColor}`
      ];
      return {
        code: cssBlock(lines),
        previewHtml: `
          <div class="demo-paragraph" style="${styleText({
            columns: `${state.count} ${state.width}px`,
            columnGap: `${state.gap}px`,
            columnRule: `${state.ruleWidth}px ${state.ruleStyle} ${state.ruleColor}`
          })}">
            多栏布局非常适合做文案排版、资讯摘要和说明文档。你可以通过列数、单列宽度和列间距快速摸索合适的阅读节奏。
            当容器宽度不足时，浏览器会自动重新计算最终列数和断行位置。
          </div>
        `
      };
    }
  },
  {
    id: "display",
    category: "layout",
    title: "显示方式",
    desc: "在 block、inline-block、flex、grid 和 none 之间切换，观察不同显示模型。",
    defaults: { mode: "flex", gap: 14, columns: 3 },
    fields: [
      selectField("mode", "display 值", ["block", "inline-block", "flex", "grid", "none"]),
      rangeField("gap", "间距", 0, 40, 1, "px"),
      rangeField("columns", "网格列数", 1, 6, 1, "")
    ],
    render(state) {
      const lines = [`display: ${state.mode}`];
      if (state.mode === "flex") {
        lines.push(`gap: ${state.gap}px`, "align-items: center");
      }
      if (state.mode === "grid") {
        lines.push(`gap: ${state.gap}px`, `grid-template-columns: repeat(${state.columns}, minmax(0, 1fr))`);
      }
      let contentStyle = {
        display: state.mode,
        gap: state.mode === "flex" || state.mode === "grid" ? `${state.gap}px` : undefined,
        gridTemplateColumns: state.mode === "grid" ? `repeat(${state.columns}, minmax(0, 1fr))` : undefined,
        alignItems: state.mode === "flex" ? "center" : undefined
      };
      if (state.mode === "none") {
        contentStyle = {};
      }
      return {
        code: cssBlock(lines),
        previewHtml: `
          <div class="demo-display">
            <div style="${styleText(contentStyle)}">
              <div class="item">A</div>
              <div class="item">B</div>
              <div class="item">C</div>
            </div>
          </div>
        `
      };
    }
  },
  simpleTool({
    id: "visibility",
    category: "layout",
    title: "可见性",
    desc: "生成 visibility。",
    property: "visibility",
    defaults: { value: "visible" },
    fields: [selectField("value", "可见性", ["visible", "hidden", "collapse"], true)],
    value: (state) => state.value,
    previewBuilder: (value) => previewCard({ visibility: value }, "Visibility")
  }),
  {
    id: "listStyle",
    category: "list",
    title: "列表样式",
    desc: "组合 list-style-type、position 和 image。",
    defaults: { type: "disc", position: "outside", image: "" },
    fields: [
      selectField("type", "标记类型", ["disc", "circle", "square", "decimal", "lower-alpha", "upper-roman", "none"]),
      selectField("position", "标记位置", ["outside", "inside"]),
      textField("image", "自定义 marker 图片地址", true)
    ],
    render(state) {
      const lines = [`list-style-type: ${state.type}`, `list-style-position: ${state.position}`];
      if (state.image.trim()) {
        lines.push(`list-style-image: url("${escapeCssUrl(state.image)}")`);
      }
      return {
        code: cssBlock(lines),
        previewHtml: `
          <div class="demo-list">
            <ul style="${styleText({
              listStyleType: state.type,
              listStylePosition: state.position,
              listStyleImage: state.image.trim() ? `url("${escapeCssUrl(state.image)}")` : undefined
            })}">
              <li>列表项一</li>
              <li>列表项二</li>
              <li>列表项三</li>
            </ul>
          </div>
        `
      };
    }
  },
  simpleTool({
    id: "cursor",
    category: "misc",
    title: "鼠标指针",
    desc: "快速切换 cursor 值。",
    property: "cursor",
    defaults: { value: "pointer" },
    fields: [selectField("value", "指针类型", ["default", "pointer", "grab", "move", "crosshair", "text", "help", "not-allowed", "wait"], true)],
    value: (state) => state.value,
    previewBuilder: (value) => previewCard({ cursor: value }, `cursor: ${value}`)
  }),
  simpleTool({
    id: "letterSpacing",
    category: "text",
    title: "字间距",
    desc: "生成 letter-spacing。",
    property: "letter-spacing",
    defaults: { value: 6 },
    fields: [rangeField("value", "字间距", -10, 40, 1, "px", true)],
    value: (state) => `${state.value}px`,
    preview: "text",
    previewBuilder: (value) => previewText({ letterSpacing: value }, "中文标题预览")
  }),
  simpleTool({
    id: "lineHeight",
    category: "text",
    title: "行高",
    desc: "生成 line-height。",
    property: "line-height",
    defaults: { value: 1.8 },
    fields: [rangeField("value", "行高", 0.8, 3, 0.1, "", true)],
    value: (state) => state.value,
    previewBuilder: (value) => previewParagraph({ lineHeight: value }, sampleParagraph())
  }),
  simpleTool({
    id: "overflowWrap",
    category: "text",
    title: "自动换行",
    desc: "生成 overflow-wrap。",
    property: "overflow-wrap",
    defaults: { value: "break-word" },
    fields: [selectField("value", "换行策略", ["normal", "break-word", "anywhere"], true)],
    value: (state) => state.value,
    previewBuilder: (value) => previewParagraph({ overflowWrap: value, width: "340px" }, "VeryVeryVeryVeryVeryVeryVeryLongEnglishWordWithoutAnySpacesForWrappingPreview")
  }),
  simpleTool({
    id: "tabSize",
    category: "text",
    title: "制表符宽度",
    desc: "生成 tab-size。",
    property: "tab-size",
    defaults: { value: 6 },
    fields: [rangeField("value", "制表宽度", 1, 12, 1, "", true)],
    value: (state) => state.value,
    previewBuilder: (value) => previewPre({ tabSize: value }, "姓名\t职位\t城市\n张三\t前端工程师\t杭州\n李四\t设计师\t上海")
  }),
  simpleTool({
    id: "textAlign",
    category: "text",
    title: "文本对齐",
    desc: "生成 text-align。",
    property: "text-align",
    defaults: { value: "center" },
    fields: [selectField("value", "对齐方式", ["left", "center", "right", "justify"], true)],
    value: (state) => state.value,
    previewBuilder: (value) => previewParagraph({ textAlign: value }, sampleParagraph())
  }),
  {
    id: "textDecoration",
    category: "text",
    title: "文本装饰",
    desc: "组合 text-decoration-line、style、color 和 thickness。",
    defaults: { line: "underline", style: "solid", color: "#ff8f53", thickness: 3 },
    fields: [
      selectField("line", "装饰线", ["underline", "overline", "line-through", "underline overline", "none"]),
      selectField("style", "装饰样式", ["solid", "double", "dotted", "dashed", "wavy"]),
      colorField("color", "装饰颜色"),
      rangeField("thickness", "线条厚度", 1, 8, 1, "px")
    ],
    render(state) {
      const value = `${state.line} ${state.style} ${state.color} ${state.thickness}px`;
      return {
        code: cssBlock([`text-decoration: ${value}`]),
        previewHtml: previewText({ textDecoration: value }, "文本装饰预览")
      };
    }
  },
  simpleTool({
    id: "textIndent",
    category: "text",
    title: "首行缩进",
    desc: "生成 text-indent。",
    property: "text-indent",
    defaults: { value: 32 },
    fields: [rangeField("value", "缩进距离", -40, 120, 1, "px", true)],
    value: (state) => `${state.value}px`,
    previewBuilder: (value) => previewParagraph({ textIndent: value }, sampleParagraph())
  }),
  {
    id: "textShadow",
    category: "text",
    title: "文字阴影",
    desc: "生成 text-shadow。",
    defaults: { x: 0, y: 8, blur: 24, color: "#2d65ff", opacity: 0.28 },
    fields: [
      rangeField("x", "水平偏移", -80, 80, 1, "px"),
      rangeField("y", "垂直偏移", -80, 80, 1, "px"),
      rangeField("blur", "模糊半径", 0, 80, 1, "px"),
      colorField("color", "阴影颜色"),
      rangeField("opacity", "透明度", 0, 1, 0.01, "")
    ],
    render(state) {
      const value = `${state.x}px ${state.y}px ${state.blur}px ${rgba(state.color, state.opacity)}`;
      return {
        code: cssBlock([`text-shadow: ${value}`]),
        previewHtml: previewText({ textShadow: value }, "文字阴影预览")
      };
    }
  },
  simpleTool({
    id: "textTransform",
    category: "text",
    title: "文本转换",
    desc: "生成 text-transform。",
    property: "text-transform",
    defaults: { value: "uppercase" },
    fields: [selectField("value", "转换方式", ["none", "uppercase", "lowercase", "capitalize"], true)],
    value: (state) => state.value,
    previewBuilder: (value) => previewText({ textTransform: value }, "webcode tools 中文版")
  }),
  simpleTool({
    id: "whiteSpace",
    category: "text",
    title: "空白处理",
    desc: "生成 white-space。",
    property: "white-space",
    defaults: { value: "pre-wrap" },
    fields: [selectField("value", "空白策略", ["normal", "nowrap", "pre", "pre-wrap", "pre-line", "break-spaces"], true)],
    value: (state) => state.value,
    previewBuilder: (value) => previewPre({ whiteSpace: value }, "第一行    有多个空格\n第二行\t有制表符\n第三行用于观察换行行为。")
  }),
  simpleTool({
    id: "wordBreak",
    category: "text",
    title: "单词断行",
    desc: "生成 word-break。",
    property: "word-break",
    defaults: { value: "break-all" },
    fields: [selectField("value", "断行方式", ["normal", "break-all", "keep-all", "break-word"], true)],
    value: (state) => state.value,
    previewBuilder: (value) => previewParagraph({ wordBreak: value, width: "340px" }, "SupercalifragilisticexpialidociousAndAnotherVeryLongWordWithoutSpaces")
  }),
  simpleTool({
    id: "wordSpacing",
    category: "text",
    title: "单词间距",
    desc: "生成 word-spacing。",
    property: "word-spacing",
    defaults: { value: 12 },
    fields: [rangeField("value", "单词间距", -10, 40, 1, "px", true)],
    value: (state) => `${state.value}px`,
    previewBuilder: (value) => previewText({ wordSpacing: value, fontSize: "30px" }, "Spacing between words")
  }),
  {
    id: "perspective",
    category: "transform",
    title: "透视",
    desc: "透视通常写在父级上，这里会同时给出 scene 与 target 的推荐写法。",
    defaults: { value: 800, rotateY: 28, rotateX: 8 },
    fields: [
      rangeField("value", "透视距离", 100, 1600, 10, "px"),
      rangeField("rotateY", "Y 轴旋转", -80, 80, 1, "deg"),
      rangeField("rotateX", "X 轴旋转", -80, 80, 1, "deg")
    ],
    render(state) {
      const code = [
        ".scene {",
        `  perspective: ${state.value}px;`,
        "}",
        "",
        ".target {",
        `  transform: rotateX(${state.rotateX}deg) rotateY(${state.rotateY}deg);`,
        "}"
      ].join("\n");
      return {
        code,
        previewHtml: `
          <div class="demo-scene" style="${styleText({ perspective: `${state.value}px` })}">
            <div class="demo-transform" style="${styleText({ transform: `rotateX(${state.rotateX}deg) rotateY(${state.rotateY}deg)` })}">Perspective</div>
          </div>
        `
      };
    }
  },
  simpleTool({
    id: "rotate",
    category: "transform",
    title: "旋转",
    desc: "生成 transform: rotate()。",
    property: "transform",
    defaults: { value: -12 },
    fields: [rangeField("value", "旋转角度", -180, 180, 1, "deg", true)],
    value: (state) => `rotate(${state.value}deg)`,
    previewBuilder: (value) => previewTransform(value, "Rotate")
  }),
  simpleTool({
    id: "scale",
    category: "transform",
    title: "缩放",
    desc: "生成 transform: scale()。",
    property: "transform",
    defaults: { x: 1.1, y: 1.1 },
    fields: [
      rangeField("x", "X 缩放", 0.2, 2, 0.01, ""),
      rangeField("y", "Y 缩放", 0.2, 2, 0.01, "")
    ],
    value: (state) => `scale(${state.x}, ${state.y})`,
    previewBuilder: (value) => previewTransform(value, "Scale")
  }),
  simpleTool({
    id: "skew",
    category: "transform",
    title: "倾斜",
    desc: "生成 transform: skew()。",
    property: "transform",
    defaults: { x: -12, y: 0 },
    fields: [
      rangeField("x", "X 倾斜", -80, 80, 1, "deg"),
      rangeField("y", "Y 倾斜", -80, 80, 1, "deg")
    ],
    value: (state) => `skew(${state.x}deg, ${state.y}deg)`,
    previewBuilder: (value) => previewTransform(value, "Skew")
  }),
  simpleTool({
    id: "translate",
    category: "transform",
    title: "位移",
    desc: "生成 transform: translate()。",
    property: "transform",
    defaults: { x: 18, y: -18 },
    fields: [
      rangeField("x", "X 位移", -120, 120, 1, "px"),
      rangeField("y", "Y 位移", -120, 120, 1, "px")
    ],
    value: (state) => `translate(${state.x}px, ${state.y}px)`,
    previewBuilder: (value) => previewTransform(value, "Translate")
  }),
  {
    id: "transition",
    category: "transition",
    title: "过渡",
    desc: "生成 transition，并在预览区自动来回切换状态，方便观察过渡效果。",
    defaults: { property: "transform", duration: 0.7, timing: "ease", delay: 0, scale: 1.08, lift: -14 },
    fields: [
      selectField("property", "过渡属性", ["all", "transform", "opacity", "background-color", "box-shadow"]),
      rangeField("duration", "持续时间", 0.1, 4, 0.1, "s"),
      selectField("timing", "缓动函数", ["ease", "ease-in", "ease-out", "ease-in-out", "linear"]),
      rangeField("delay", "延迟", 0, 2, 0.1, "s"),
      rangeField("scale", "激活缩放", 0.6, 1.6, 0.01, ""),
      rangeField("lift", "激活位移", -60, 60, 1, "px")
    ],
    render(state) {
      const code = [
        ".target {",
        `  transition: ${state.property} ${state.duration}s ${state.timing} ${state.delay}s;`,
        "}",
        "",
        ".target:hover {",
        `  transform: translateY(${state.lift}px) scale(${state.scale});`,
        "}"
      ].join("\n");
      const previewHtml = `
        <div class="demo-transition-box" id="transitionBox" style="${styleText({
          transition: `${state.property} ${state.duration}s ${state.timing} ${state.delay}s`
        })}">Transition</div>
      `;
      return {
        code,
        previewHtml,
        afterRender(container) {
          const box = container.querySelector("#transitionBox");
          if (!box) return null;
          let active = false;
          const timer = setInterval(() => {
            active = !active;
            box.style.transform = active ? `translateY(${state.lift}px) scale(${state.scale})` : "translateY(0) scale(1)";
            box.style.opacity = active && (state.property === "all" || state.property === "opacity") ? "0.78" : "1";
            box.style.background = active && (state.property === "all" || state.property === "background-color")
              ? "linear-gradient(135deg, #ff8f53, #ffcd73)"
              : "linear-gradient(135deg, #2d65ff, #1bb9a4)";
            box.style.boxShadow = active && (state.property === "all" || state.property === "box-shadow")
              ? "0 20px 40px rgba(255, 143, 83, 0.35)"
              : "0 10px 24px rgba(45, 101, 255, 0.24)";
          }, 1200);
          return () => clearInterval(timer);
        }
      };
    }
  }
];

const cssState = Object.fromEntries(cssTools.map((tool) => [tool.id, { ...tool.defaults }]));
let currentToolId = "keyframeAnimation";

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
    copyMessageEl.textContent = "CSS 已复制到剪贴板。";
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
  return cssTools.find((tool) => tool.id === currentToolId);
}

function renderSidebar() {
  categoryNavEl.innerHTML = cssCategories.map((category) => {
    const items = cssTools.filter((tool) => tool.category === category.id);
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
      copyMessageEl.textContent = "复制后可直接粘贴到样式表中使用。";
      renderApp();
    });
  });
}

function renderToolPanel() {
  const tool = currentTool();
  const state = cssState[tool.id];
  toolTitleEl.textContent = tool.title;
  toolDescEl.textContent = tool.desc;
  fieldGridEl.innerHTML = tool.fields.map((field) => renderField(field, state[field.key])).join("");

  fieldGridEl.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const field = tool.fields.find((item) => item.key === event.target.dataset.field);
      if (!field) return;
      updateState(field, state, event.target);
      updateFieldHint(field, event.target);
      renderPreview();
    });
  });
}

function renderPreview() {
  if (previewCleanup) {
    previewCleanup();
    previewCleanup = null;
  }
  const tool = currentTool();
  const result = tool.render(cssState[tool.id]);
  previewWrapEl.innerHTML = result.previewHtml;
  codeBlockEl.textContent = result.code;
  if (typeof result.afterRender === "function") {
    previewCleanup = result.afterRender(previewWrapEl);
  }
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

  const inputType = field.type === "text" ? "text" : field.type === "number" ? "number" : "range";
  return `
    <div class="field ${field.full ? "full" : ""}">
      <label for="field-${field.key}">${field.label}</label>
      <input
        id="field-${field.key}"
        data-field="${field.key}"
        type="${inputType}"
        ${field.min !== undefined ? `min="${field.min}"` : ""}
        ${field.max !== undefined ? `max="${field.max}"` : ""}
        ${field.step !== undefined ? `step="${field.step}"` : ""}
        value="${escapeAttr(value)}"
      >
      ${(field.unit && inputType === "range") || (inputType === "number") ? `<div class="value-line" id="hint-${field.key}">${formatValue(value, field.unit)}</div>` : ""}
    </div>
  `;
}

function updateState(field, state, input) {
  if (field.type === "checkbox") {
    state[field.key] = input.checked;
    return;
  }
  if (field.type === "range" || field.type === "number") {
    state[field.key] = Number(input.value);
    return;
  }
  state[field.key] = input.value;
}

function updateFieldHint(field, input) {
  const hintEl = document.getElementById(`hint-${field.key}`);
  if (hintEl) {
    hintEl.textContent = formatValue(input.value, field.unit);
  }
}

function simpleTool(config) {
  return {
    ...config,
    render(state) {
      const value = config.value(state);
      const previewBuilder = config.previewBuilder || ((cssValue) => previewCard({ [config.property]: cssValue }, config.title));
      return {
        code: cssBlock([`${config.property}: ${value}`], config.selector),
        previewHtml: previewBuilder(value, state, config)
      };
    }
  };
}

function filterTool(id, category, title, desc, defaults, fields, valueFn) {
  return simpleTool({
    id,
    category,
    title,
    desc,
    property: "filter",
    defaults,
    fields,
    value: valueFn,
    previewBuilder: (value) => previewImage({ filter: value })
  });
}

function textField(key, label, full = false) {
  return { key, label, type: "text", full };
}

function textareaField(key, label, full = false) {
  return { key, label, type: "textarea", full };
}

function rangeField(key, label, min, max, step = 1, unit = "", full = false) {
  return { key, label, type: "range", min, max, step, unit, full };
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

function previewCard(styles, text) {
  return `<div class="demo-card" style="${styleText({ background: "linear-gradient(135deg, #ffffff, #eef5ff)", ...styles })}">${escapeHtml(text)}</div>`;
}

function previewText(styles, text) {
  return `<div class="demo-text" style="${styleText(styles)}">${escapeHtml(text)}</div>`;
}

function previewParagraph(styles, text) {
  return `<div class="demo-paragraph" style="${styleText(styles)}">${escapeHtml(text)}</div>`;
}

function previewPre(styles, text) {
  return `<pre class="demo-pre" style="${styleText(styles)}">${escapeHtml(text)}</pre>`;
}

function previewImage(styles) {
  return `<div class="demo-media"><img src="${escapeAttr(colorfulImage)}" alt="filter preview" style="${styleText(styles)}"></div>`;
}

function previewTransform(transformValue, label) {
  return `
    <div class="demo-scene">
      <div class="demo-transform" style="${styleText({ transform: transformValue })}">${escapeHtml(label)}</div>
    </div>
  `;
}

function styleText(styles) {
  return Object.entries(styles)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${toCssKey(key)}:${value}`)
    .join(";");
}

function cssBlock(lines, selector = ".target") {
  return `${selector} {\n${lines.map((line) => `  ${line};`).join("\n")}\n}`;
}

function toCssKey(key) {
  return key.includes("-") ? key : key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function rgba(hex, alpha) {
  const value = hex.replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((item) => item + item).join("") : value;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sampleParagraph() {
  return "这是一段用于观察排版效果的示例文字。你可以通过实时预览来判断当前属性对阅读节奏、对齐方式和整体观感的影响。";
}

function contrastTextColor(hex) {
  const value = hex.replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((item) => item + item).join("") : value;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 150 ? "#16233d" : "#ffffff";
}

function svgDataUri(svg) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
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

function escapeCssUrl(value) {
  return String(value).replace(/"/g, '\\"');
}

function formatValue(value, unit) {
  return unit ? `${value}${unit}` : `${value}`;
}
