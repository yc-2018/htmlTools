(function () {
  "use strict";

  const {
    cssBlock,
    formatNumber,
    sanitizeCssName,
    cssString,
    text,
    number,
    range,
    checkbox,
    color,
    select,
    radio,
    shadowList,
    colorStops
  } = window.Gen;

  const borderStyleOptions = [
    ["solid", "实线"],
    ["dashed", "虚线"],
    ["dotted", "点线"],
    ["double", "双线"],
    ["groove", "凹槽"],
    ["ridge", "凸起"],
    ["inset", "内嵌"],
    ["outset", "外凸"],
    ["none", "无"]
  ];

  const timingOptions = [
    ["ease", "平滑（ease）"],
    ["linear", "匀速（linear）"],
    ["ease-in", "缓入（ease-in）"],
    ["ease-out", "缓出（ease-out）"],
    ["ease-in-out", "缓入缓出（ease-in-out）"],
    ["cubic-bezier(0.4, 0, 0.2, 1)", "柔和（cubic-bezier）"]
  ];

  const directionOptions = [
    ["normal", "正常"],
    ["reverse", "反向"],
    ["alternate", "交替"],
    ["alternate-reverse", "反向往返"]
  ];

  const fillModeOptions = [
    ["none", "不保留"],
    ["forwards", "保留结束状态"],
    ["backwards", "应用起始状态"],
    ["both", "前后都保留"]
  ];

  const positionOptions = [
    ["center center", "居中"],
    ["left top", "左上"],
    ["center top", "上中"],
    ["right top", "右上"],
    ["left center", "左中"],
    ["right center", "右中"],
    ["left bottom", "左下"],
    ["center bottom", "下中"],
    ["right bottom", "右下"]
  ];

  const backgroundSizeOptions = [
    ["cover", "覆盖整个区域（cover）"],
    ["contain", "完整显示（contain）"],
    ["auto", "原始尺寸（auto）"],
    ["100% 100%", "拉伸铺满"]
  ];

  const repeatOptions = [
    ["no-repeat", "不重复"],
    ["repeat", "双向重复"],
    ["repeat-x", "水平重复"],
    ["repeat-y", "垂直重复"]
  ];

  const clipOptions = [
    ["border-box", "边框盒"],
    ["padding-box", "内边距盒"],
    ["content-box", "内容盒"]
  ];

  const attachmentOptions = [
    ["scroll", "随页面滚动"],
    ["fixed", "固定不动"],
    ["local", "随内容滚动"]
  ];

  function buildTransform(parts) {
    return cssBlock([`transform: ${parts.join(" ")};`]);
  }

  function filterGenerator(config) {
    const { id, name, desc, field, sample = "image" } = config;
    return {
      id,
      name,
      desc,
      sample,
      fields: [field],
      build(values) {
        return cssBlock([`filter: ${config.value(values)};`]);
      }
    };
  }

  const percentAmount = (key, label, defaultValue, max) => range(key, label, defaultValue, 0, max, 1, { unit: "%" });

  function makeFrames(steps) {
    return Object.entries(steps).map(([selector, declarations]) => {
      const lines = declarations.map((declaration) => `    ${declaration}`).join("\n");
      return `  ${selector} {\n${lines}\n  }`;
    }).join("\n");
  }

  const animationPresets = [
    {
      value: "blink",
      label: "闪烁",
      group: "强调",
      steps: {
        "0%, 50%, 100%": ["opacity: 1;"],
        "25%, 75%": ["opacity: 0;"]
      }
    },
    {
      value: "pulse",
      label: "脉冲",
      group: "强调",
      steps: {
        "0%, 100%": ["transform: scale(1);"],
        "50%": ["transform: scale(1.08);"]
      }
    },
    {
      value: "bounce",
      label: "弹跳",
      group: "强调",
      steps: {
        "0%, 20%, 53%, 80%, 100%": ["transform: translateY(0);"],
        "40%, 43%": ["transform: translateY(-24px);"],
        "70%": ["transform: translateY(-12px);"],
        "90%": ["transform: translateY(-4px);"]
      }
    },
    {
      value: "shake",
      label: "水平抖动",
      group: "强调",
      steps: {
        "0%, 100%": ["transform: translateX(0);"],
        "10%, 30%, 50%, 70%, 90%": ["transform: translateX(-8px);"],
        "20%, 40%, 60%, 80%": ["transform: translateX(8px);"]
      }
    },
    {
      value: "swing",
      label: "摇摆",
      group: "强调",
      steps: {
        "0%, 100%": ["transform: rotate(0deg);"],
        "20%": ["transform: rotate(12deg);"],
        "40%": ["transform: rotate(-10deg);"],
        "60%": ["transform: rotate(6deg);"],
        "80%": ["transform: rotate(-4deg);"]
      }
    },
    {
      value: "heartbeat",
      label: "心跳",
      group: "强调",
      steps: {
        "0%, 28%, 70%, 100%": ["transform: scale(1);"],
        "14%, 42%": ["transform: scale(1.12);"]
      }
    },
    {
      value: "jello",
      label: "果冻",
      group: "强调",
      steps: {
        "0%, 100%": ["transform: scale(1, 1);"],
        "30%": ["transform: scale(1.15, 0.85);"],
        "50%": ["transform: scale(0.9, 1.1);"],
        "70%": ["transform: scale(1.05, 0.95);"]
      }
    },
    {
      value: "wobble",
      label: "晃动",
      group: "强调",
      steps: {
        "0%, 100%": ["transform: translateX(0) rotate(0);"],
        "15%": ["transform: translateX(-20px) rotate(-5deg);"],
        "30%": ["transform: translateX(16px) rotate(3deg);"],
        "45%": ["transform: translateX(-12px) rotate(-3deg);"],
        "60%": ["transform: translateX(8px) rotate(2deg);"],
        "75%": ["transform: translateX(-4px) rotate(-1deg);"]
      }
    },
    {
      value: "float",
      label: "上下浮动",
      group: "强调",
      steps: {
        "0%, 100%": ["transform: translateY(0);"],
        "50%": ["transform: translateY(-14px);"]
      }
    },
    {
      value: "fadeIn",
      label: "淡入",
      group: "基础",
      steps: {
        "0%": ["opacity: 0;"],
        "100%": ["opacity: 1;"]
      }
    },
    {
      value: "fadeOut",
      label: "淡出",
      group: "基础",
      steps: {
        "0%": ["opacity: 1;"],
        "100%": ["opacity: 0;"]
      }
    },
    {
      value: "zoomIn",
      label: "放大进入",
      group: "基础",
      steps: {
        "0%": ["opacity: 0;", "transform: scale(0.5);"],
        "100%": ["opacity: 1;", "transform: scale(1);"]
      }
    },
    {
      value: "zoomOut",
      label: "缩小退出",
      group: "基础",
      steps: {
        "0%": ["opacity: 1;", "transform: scale(1);"],
        "100%": ["opacity: 0;", "transform: scale(0.5);"]
      }
    },
    {
      value: "slideInUp",
      label: "向上滑入",
      group: "基础",
      steps: {
        "0%": ["opacity: 0;", "transform: translateY(36px);"],
        "100%": ["opacity: 1;", "transform: translateY(0);"]
      }
    },
    {
      value: "slideInDown",
      label: "向下滑入",
      group: "基础",
      steps: {
        "0%": ["opacity: 0;", "transform: translateY(-36px);"],
        "100%": ["opacity: 1;", "transform: translateY(0);"]
      }
    },
    {
      value: "flipInX",
      label: "X 轴翻转",
      group: "基础",
      steps: {
        "0%": ["opacity: 0;", "transform: perspective(400px) rotateX(90deg);"],
        "40%": ["transform: perspective(400px) rotateX(-12deg);"],
        "70%": ["transform: perspective(400px) rotateX(6deg);"],
        "100%": ["opacity: 1;", "transform: perspective(400px) rotateX(0);"]
      }
    },
    {
      value: "bounceIn",
      label: "弹跳进入",
      group: "进入与退出",
      steps: {
        "0%": ["opacity: 0;", "transform: scale(0.3);"],
        "20%": ["transform: scale(1.05);"],
        "40%": ["transform: scale(0.95);"],
        "60%": ["transform: scale(1.02);"],
        "80%": ["transform: scale(0.99);"],
        "100%": ["opacity: 1;", "transform: scale(1);"]
      }
    },
    {
      value: "bounceOut",
      label: "弹跳退出",
      group: "进入与退出",
      steps: {
        "0%": ["opacity: 1;", "transform: scale(1);"],
        "20%": ["transform: scale(0.95);"],
        "50%": ["opacity: 1;", "transform: scale(1.05);"],
        "100%": ["opacity: 0;", "transform: scale(0.3);"]
      }
    },
    {
      value: "rotateIn",
      label: "旋转进入",
      group: "进入与退出",
      steps: {
        "0%": ["opacity: 0;", "transform: rotate(-180deg) scale(0.5);"],
        "100%": ["opacity: 1;", "transform: rotate(0) scale(1);"]
      }
    },
    {
      value: "backgroundPulse",
      label: "背景颜色脉冲",
      group: "背景与边框",
      base: ["background-color: #6366f1;"],
      steps: {
        "0%, 100%": ["background-color: #6366f1;"],
        "50%": ["background-color: #ec4899;"]
      }
    },
    {
      value: "gradientFlow",
      label: "渐变流动",
      group: "背景与边框",
      base: [
        "background: linear-gradient(120deg, #6366f1, #ec4899, #0ea5e9);",
        "background-size: 220% 220%;"
      ],
      steps: {
        "0%, 100%": ["background-position: 0% 50%;"],
        "50%": ["background-position: 100% 50%;"]
      }
    },
    {
      value: "glow",
      label: "光晕呼吸",
      group: "背景与边框",
      steps: {
        "0%, 100%": ["box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.55);"],
        "50%": ["box-shadow: 0 0 0 16px rgba(99, 102, 241, 0);"]
      }
    }
  ].map((preset) => ({ ...preset, frames: makeFrames(preset.steps) }));

  const animationGroups = ["强调", "基础", "进入与退出", "背景与边框"].map((group) => ({
    label: group,
    options: animationPresets
      .filter((preset) => preset.group === group)
      .map((preset) => [preset.value, preset.label])
  }));

  const backgroundGroup = {
    id: "background",
    name: "背景",
    items: [
      {
        id: "background-color",
        name: "背景颜色",
        desc: "设置元素背景色，对应 CSS 的 background-color 属性。",
        sample: "box",
        fields: [
          color("color", "背景颜色", "#3b82f6")
        ],
        build(values) {
          return cssBlock([`background-color: ${values.color};`]);
        }
      },
      {
        id: "background-gradient",
        name: "背景渐变",
        desc: "生成线性、径向或圆锥渐变背景，并自由添加颜色节点。",
        sample: "box",
        fields: [
          radio("type", "渐变类型", "linear", [
            ["linear", "线性渐变"],
            ["radial", "径向渐变"],
            ["conic", "圆锥渐变"]
          ]),
          range("angle", "渐变角度", 135, 0, 360, 1, {
            unit: "deg",
            showIf: (values) => values.type !== "radial"
          }),
          colorStops("stops", "颜色节点", [
            { color: "#3b82f6", position: 0 },
            { color: "#8b5cf6", position: 50 },
            { color: "#ec4899", position: 100 }
          ])
        ],
        build(values) {
          const stops = values.stops
            .map((stop) => `${stop.color} ${formatNumber(stop.position, 1)}%`)
            .join(", ");
          let gradient;
          if (values.type === "radial") {
            gradient = `radial-gradient(circle at 50% 50%, ${stops})`;
          } else if (values.type === "conic") {
            gradient = `conic-gradient(from ${formatNumber(values.angle)}deg at 50% 50%, ${stops})`;
          } else {
            gradient = `linear-gradient(${formatNumber(values.angle)}deg, ${stops})`;
          }
          return cssBlock([`background: ${gradient};`]);
        }
      },
      {
        id: "background-image",
        name: "背景图片",
        desc: "组合背景颜色与图片，并设置位置、尺寸、重复方式等属性。",
        sample: "box",
        fields: [
          text("url", "图片地址", "./assets/sample.svg", { hint: "示例图片位于本工具目录，可替换为自己的图片地址。" }),
          color("color", "背景颜色", "#ffffff"),
          select("position", "位置（background-position）", "center center", positionOptions),
          select("size", "尺寸（background-size）", "cover", backgroundSizeOptions),
          select("repeat", "重复方式（background-repeat）", "no-repeat", repeatOptions),
          select("clip", "绘制区域（background-clip）", "border-box", clipOptions),
          select("attachment", "附着方式（background-attachment）", "scroll", attachmentOptions)
        ],
        build(values) {
          const declarations = [`background-color: ${values.color};`];
          if (values.url) {
            declarations.push(`background-image: url("${cssString(values.url)}");`);
          }
          declarations.push(
            `background-position: ${values.position};`,
            `background-size: ${values.size};`,
            `background-repeat: ${values.repeat};`,
            `background-clip: ${values.clip};`,
            `background-attachment: ${values.attachment};`
          );
          return cssBlock(declarations);
        }
      }
    ]
  };

  const boxGroup = {
    id: "box",
    name: "盒子",
    items: [
      {
        id: "border",
        name: "边框",
        desc: "设置边框颜色、样式与宽度，可让四条边使用不同宽度。",
        sample: "box",
        fields: [
          select("type", "设置方式", "same", [
            ["same", "四边相同"],
            ["each", "分别设置四边"]
          ]),
          select("style", "边框样式", "solid", borderStyleOptions),
          color("color", "边框颜色", "#4f46e5"),
          range("width", "边框宽度", 10, 1, 20, 1, {
            unit: "px",
            showIf: (values) => values.type === "same"
          }),
          range("top", "上边框宽度", 10, 0, 20, 1, { unit: "px", showIf: (values) => values.type === "each" }),
          range("right", "右边框宽度", 10, 0, 20, 1, { unit: "px", showIf: (values) => values.type === "each" }),
          range("bottom", "下边框宽度", 10, 0, 20, 1, { unit: "px", showIf: (values) => values.type === "each" }),
          range("left", "左边框宽度", 10, 0, 20, 1, { unit: "px", showIf: (values) => values.type === "each" })
        ],
        build(values) {
          if (values.type === "same") {
            return cssBlock([`border: ${formatNumber(values.width)}px ${values.style} ${values.color};`]);
          }
          return cssBlock([
            `border-width: ${formatNumber(values.top)}px ${formatNumber(values.right)}px ${formatNumber(values.bottom)}px ${formatNumber(values.left)}px;`,
            `border-style: ${values.style};`,
            `border-color: ${values.color};`
          ]);
        }
      },
      {
        id: "border-image",
        name: "图片边框",
        desc: "使用九宫格图片生成边框，可调节切割值、宽度、外扩与重复方式。",
        sample: "box",
        fields: [
          text("url", "边框图片地址", "./assets/border-image.svg", { hint: "建议使用 9 宫格边框图片，示例图片位于本工具目录。" }),
          range("slice", "切割值（slice）", 30, 0, 100, 1),
          range("width", "边框宽度", 15, 0, 50, 1, { unit: "px" }),
          range("outset", "向外扩展（outset）", 0, 0, 50, 1, { unit: "px" }),
          select("repeat", "重复方式", "stretch", [
            ["stretch", "拉伸"],
            ["repeat", "重复"],
            ["round", "平铺取整"],
            ["space", "留白重复"]
          ])
        ],
        build(values) {
          const declarations = [`border: ${formatNumber(values.width)}px solid transparent;`];
          if (values.url) {
            declarations.push(
              `border-image: url("${cssString(values.url)}") ${formatNumber(values.slice)} / ${formatNumber(values.width)}px / ${formatNumber(values.outset)}px ${values.repeat};`
            );
          }
          return cssBlock(declarations);
        }
      },
      {
        id: "border-radius",
        name: "圆角",
        desc: "为元素设置统一圆角，或分别设置四个角的半径。",
        sample: "box",
        fields: [
          radio("type", "设置方式", "same", [
            ["same", "四角相同"],
            ["each", "分别设置四角"]
          ]),
          range("radius", "圆角半径", 10, 0, 100, 1, {
            units: ["px", "%"],
            defaultUnit: "px",
            showIf: (values) => values.type === "same"
          }),
          range("topLeft", "左上角", 10, 0, 100, 1, {
            units: ["px", "%"],
            defaultUnit: "px",
            showIf: (values) => values.type === "each"
          }),
          range("topRight", "右上角", 30, 0, 100, 1, {
            units: ["px", "%"],
            defaultUnit: "px",
            showIf: (values) => values.type === "each"
          }),
          range("bottomRight", "右下角", 10, 0, 100, 1, {
            units: ["px", "%"],
            defaultUnit: "px",
            showIf: (values) => values.type === "each"
          }),
          range("bottomLeft", "左下角", 30, 0, 100, 1, {
            units: ["px", "%"],
            defaultUnit: "px",
            showIf: (values) => values.type === "each"
          })
        ],
        build(values) {
          const unitOf = (key) => values[`${key}Unit`] || "px";
          if (values.type === "same") {
            return cssBlock([`border-radius: ${formatNumber(values.radius)}${unitOf("radius")};`]);
          }
          return cssBlock([
            `border-radius: ${formatNumber(values.topLeft)}${unitOf("topLeft")} ${formatNumber(values.topRight)}${unitOf("topRight")} ${formatNumber(values.bottomRight)}${unitOf("bottomRight")} ${formatNumber(values.bottomLeft)}${unitOf("bottomLeft")};`
          ]);
        }
      },
      {
        id: "box-shadow",
        name: "盒子阴影",
        desc: "为元素添加一层或多层阴影，支持内阴影、颜色、偏移、模糊与扩展。",
        sample: "box",
        fields: [
          shadowList("shadows", "阴影列表", [
            { inset: false, color: "#1f2937", x: 5, y: 5, blur: 10, spread: 1 }
          ], { kind: "box" })
        ],
        build(values) {
          const shadows = values.shadows.map((shadow) => {
            const prefix = shadow.inset ? "inset " : "";
            return `${prefix}${formatNumber(shadow.x)}px ${formatNumber(shadow.y)}px ${formatNumber(shadow.blur)}px ${formatNumber(shadow.spread)}px ${shadow.color}`;
          }).join(", ");
          return cssBlock([`box-shadow: ${shadows};`]);
        }
      },
      {
        id: "box-resize",
        name: "调整大小",
        desc: "允许用户拖动元素右下角调整尺寸，需配合 overflow: auto 才能生效。",
        sample: "resize",
        fields: [
          radio("resize", "调整方向", "both", [
            ["both", "水平和垂直"],
            ["horizontal", "仅水平"],
            ["vertical", "仅垂直"],
            ["none", "禁止调整"]
          ])
        ],
        build(values) {
          return cssBlock([
            `resize: ${values.resize};`,
            "overflow: auto;"
          ]);
        }
      },
      {
        id: "outline",
        name: "轮廓线",
        desc: "生成不占据布局空间的轮廓线，可设置颜色、样式、宽度与偏移。",
        sample: "box",
        fields: [
          color("color", "轮廓颜色", "#f97316"),
          select("style", "线条样式", "solid", borderStyleOptions),
          range("width", "线条宽度", 6, 1, 20, 1, { unit: "px" }),
          range("offset", "向外偏移", 4, 0, 100, 1, { unit: "px" })
        ],
        build(values) {
          return cssBlock([
            `outline: ${formatNumber(values.width)}px ${values.style} ${values.color};`,
            `outline-offset: ${formatNumber(values.offset)}px;`
          ]);
        }
      }
    ]
  };

  const colorGroup = {
    id: "color",
    name: "颜色",
    items: [
      {
        id: "color",
        name: "文字颜色",
        desc: "设置文字颜色，对应 CSS 的 color 属性。",
        sample: "text",
        fields: [
          color("color", "文字颜色", "#4f46e5")
        ],
        build(values) {
          return cssBlock([`color: ${values.color};`]);
        }
      },
      {
        id: "opacity",
        name: "不透明度",
        desc: "设置元素整体透明度，0 表示完全透明，100% 表示完全不透明。",
        sample: "opacity",
        fields: [
          range("value", "不透明度", 50, 0, 100, 1, { unit: "%" })
        ],
        build(values) {
          return cssBlock([`opacity: ${formatNumber(values.value / 100, 2)};`]);
        }
      }
    ]
  };

  const filterGroup = {
    id: "filter",
    name: "滤镜",
    items: [
      filterGenerator({
        id: "blur",
        name: "模糊",
        desc: "使用 blur() 滤镜模糊元素，数值越大越模糊。",
        field: range("radius", "模糊半径", 5, 0, 20, 0.5, { unit: "px" }),
        value: (values) => `blur(${formatNumber(values.radius, 1)}px)`
      }),
      filterGenerator({
        id: "brightness",
        name: "亮度",
        desc: "使用 brightness() 调整亮度，100% 为原始亮度。",
        field: percentAmount("amount", "亮度", 130, 200),
        value: (values) => `brightness(${formatNumber(values.amount)}%)`
      }),
      filterGenerator({
        id: "contrast",
        name: "对比度",
        desc: "使用 contrast() 调整对比度，100% 为原始对比度。",
        field: percentAmount("amount", "对比度", 130, 200),
        value: (values) => `contrast(${formatNumber(values.amount)}%)`
      }),
      {
        id: "drop-shadow",
        name: "投影",
        desc: "使用 drop-shadow() 为元素内容添加贴合轮廓的阴影，常用于透明图标。",
        sample: "image",
        fields: [
          color("color", "阴影颜色", "#1f2937"),
          range("x", "水平偏移", 5, -100, 100, 1, { unit: "px" }),
          range("y", "垂直偏移", 5, -100, 100, 1, { unit: "px" }),
          range("blur", "模糊半径", 10, 0, 100, 1, { unit: "px" })
        ],
        build(values) {
          return cssBlock([
            `filter: drop-shadow(${formatNumber(values.x)}px ${formatNumber(values.y)}px ${formatNumber(values.blur)}px ${values.color});`
          ]);
        }
      },
      filterGenerator({
        id: "grayscale",
        name: "灰度",
        desc: "使用 grayscale() 将彩色内容转为灰度，100% 为完全灰度。",
        field: percentAmount("amount", "灰度比例", 100, 100),
        value: (values) => `grayscale(${formatNumber(values.amount)}%)`
      }),
      filterGenerator({
        id: "hue-rotate",
        name: "色相旋转",
        desc: "使用 hue-rotate() 旋转所有颜色的色相，单位为角度。",
        field: range("angle", "旋转角度", 90, 0, 360, 1, { unit: "deg" }),
        value: (values) => `hue-rotate(${formatNumber(values.angle)}deg)`
      }),
      filterGenerator({
        id: "invert",
        name: "反色",
        desc: "使用 invert() 反转颜色，100% 为完全反色。",
        field: percentAmount("amount", "反色比例", 100, 100),
        value: (values) => `invert(${formatNumber(values.amount)}%)`
      }),
      filterGenerator({
        id: "saturate",
        name: "饱和度",
        desc: "使用 saturate() 调整饱和度，100% 为原始饱和度。",
        field: percentAmount("amount", "饱和度", 300, 300),
        value: (values) => `saturate(${formatNumber(values.amount)}%)`
      }),
      filterGenerator({
        id: "sepia",
        name: "复古棕褐",
        desc: "使用 sepia() 添加复古棕褐色调，100% 为完全棕褐。",
        field: percentAmount("amount", "棕褐比例", 100, 100),
        value: (values) => `sepia(${formatNumber(values.amount)}%)`
      })
    ]
  };

  const layoutGroup = {
    id: "layout",
    name: "布局",
    items: [
      {
        id: "columns",
        name: "多栏文本",
        desc: "使用 columns 将内容自动分成多栏。",
        sample: "columns",
        fields: [
          range("count", "栏数", 2, 1, 6, 1)
        ],
        build(values) {
          return cssBlock([`columns: ${formatNumber(values.count)};`]);
        }
      },
      {
        id: "display",
        name: "显示方式",
        desc: "设置元素的 display 值，改变它在文档流中的排版方式。",
        sample: "display",
        fields: [
          radio("value", "display 值", "block", [
            ["block", "块级元素（block）"],
            ["inline", "行内元素（inline）"],
            ["inline-block", "行内块（inline-block）"],
            ["flex", "弹性盒（flex）"],
            ["inline-flex", "行内弹性盒（inline-flex）"],
            ["grid", "网格（grid）"],
            ["inline-grid", "行内网格（inline-grid）"],
            ["none", "隐藏（none）"],
            ["contents", "内容透传（contents）"],
            ["table", "表格（table）"],
            ["table-cell", "表格单元（table-cell）"]
          ], { layout: "stacked" })
        ],
        build(values) {
          return cssBlock([`display: ${values.value};`]);
        }
      },
      {
        id: "overflow",
        name: "溢出处理",
        desc: "控制内容超出元素时的显示方式，可分别设置横轴或纵轴。",
        sample: "overflow",
        fields: [
          radio("type", "作用方向", "overflow", [
            ["overflow", "两个方向"],
            ["overflow-x", "水平方向"],
            ["overflow-y", "垂直方向"]
          ]),
          select("value", "溢出值", "auto", [
            ["visible", "可见（visible）"],
            ["hidden", "隐藏（hidden）"],
            ["clip", "裁剪（clip）"],
            ["scroll", "显示滚动条（scroll）"],
            ["auto", "按需滚动（auto）"]
          ])
        ],
        build(values) {
          return cssBlock([`${values.type}: ${values.value};`]);
        }
      },
      {
        id: "overflow-wrap",
        name: "长词换行",
        desc: "控制超长单词或网址在容器边缘的换行行为。",
        sample: "wordbreak",
        fields: [
          radio("value", "overflow-wrap 值", "break-word", [
            ["normal", "正常换行"],
            ["break-word", "必要时断开长词"],
            ["anywhere", "任意位置换行"]
          ])
        ],
        build(values) {
          return cssBlock([`overflow-wrap: ${values.value};`]);
        }
      },
      {
        id: "visibility",
        name: "可见性",
        desc: "设置元素是否可见；隐藏后元素仍会占据原有布局空间。",
        sample: "visibility",
        fields: [
          radio("value", "visibility 值", "hidden", [
            ["visible", "可见"],
            ["hidden", "隐藏但保留空间"],
            ["collapse", "折叠（表格）"]
          ])
        ],
        build(values) {
          return cssBlock([`visibility: ${values.value};`]);
        }
      }
    ]
  };

  const listGroup = {
    id: "list",
    name: "列表",
    items: [
      {
        id: "list-style",
        name: "列表样式",
        desc: "设置有序或无序列表的项目符号类型与位置。",
        sample: "list",
        fields: [
          select("type", "符号类型", "square", [
            ["disc", "实心圆点"],
            ["circle", "空心圆点"],
            ["square", "方块"],
            ["decimal", "阿拉伯数字"],
            ["decimal-leading-zero", "带前导零数字"],
            ["lower-roman", "小写罗马数字"],
            ["upper-roman", "大写罗马数字"],
            ["lower-alpha", "小写字母"],
            ["upper-alpha", "大写字母"],
            ["none", "不显示符号"]
          ]),
          select("position", "符号位置", "outside", [
            ["outside", "在内容外侧"],
            ["inside", "在内容内侧"]
          ])
        ],
        build(values) {
          return cssBlock([`list-style: ${values.type} ${values.position};`]);
        }
      }
    ]
  };

  const miscGroup = {
    id: "misc",
    name: "其他",
    items: [
      {
        id: "cursor",
        name: "鼠标指针",
        desc: "设置鼠标悬停在元素上时的指针样式。",
        sample: "cursor",
        fields: [
          select("value", "指针样式", "pointer", [
            ["auto", "自动"],
            ["default", "默认箭头"],
            ["pointer", "手形指针"],
            ["text", "文本光标"],
            ["move", "移动十字"],
            ["grab", "抓手"],
            ["grabbing", "抓取中"],
            ["crosshair", "十字准星"],
            ["wait", "等待"],
            ["help", "帮助"],
            ["not-allowed", "禁止"],
            ["zoom-in", "放大"],
            ["zoom-out", "缩小"]
          ])
        ],
        build(values) {
          return cssBlock([`cursor: ${values.value};`]);
        }
      },
      {
        id: "tab-size",
        name: "制表符宽度",
        desc: "设置代码块中制表符显示的字符宽度。",
        sample: "tab",
        fields: [
          range("value", "制表符宽度", 2, 1, 8, 1)
        ],
        build(values) {
          return cssBlock([`tab-size: ${formatNumber(values.value)};`]);
        }
      }
    ]
  };

  const textGroup = {
    id: "text",
    name: "文本",
    items: [
      {
        id: "letter-spacing",
        name: "字间距",
        desc: "调整字符之间的间距，可使用负值收紧文字。",
        sample: "text",
        fields: [
          range("value", "字间距", 5, -5, 20, 0.5, { unit: "px" })
        ],
        build(values) {
          return cssBlock([`letter-spacing: ${formatNumber(values.value, 1)}px;`]);
        }
      },
      {
        id: "line-height",
        name: "行高",
        desc: "设置文本行高，推荐使用无单位数值以随字号缩放。",
        sample: "text",
        fields: [
          range("value", "行高倍数", 2, 0.5, 3, 0.1)
        ],
        build(values) {
          return cssBlock([`line-height: ${formatNumber(values.value, 2)};`]);
        }
      },
      {
        id: "text-align",
        name: "文本对齐",
        desc: "设置文本在容器中的水平对齐方式。",
        sample: "text",
        fields: [
          radio("value", "对齐方式", "center", [
            ["left", "左对齐"],
            ["center", "居中"],
            ["right", "右对齐"],
            ["justify", "两端对齐"],
            ["start", "起始侧对齐"],
            ["end", "结束侧对齐"]
          ], { layout: "stacked" })
        ],
        build(values) {
          return cssBlock([`text-align: ${values.value};`]);
        }
      },
      {
        id: "text-decoration",
        name: "文本装饰线",
        desc: "为文字添加下划线、上划线或删除线，并设置线型与颜色。",
        sample: "text",
        fields: [
          radio("type", "装饰线类型", "underline", [
            ["underline", "下划线"],
            ["overline", "上划线"],
            ["line-through", "删除线"]
          ]),
          select("style", "线条样式", "wavy", [
            ["solid", "实线"],
            ["double", "双线"],
            ["dotted", "点线"],
            ["dashed", "虚线"],
            ["wavy", "波浪线"]
          ]),
          checkbox("customColor", "使用自定义颜色", false),
          color("color", "线条颜色", "#f97316", {
            showIf: (values) => values.customColor
          })
        ],
        build(values) {
          const colorPart = values.customColor ? ` ${values.color}` : "";
          return cssBlock([`text-decoration: ${values.type} ${values.style}${colorPart};`]);
        }
      },
      {
        id: "text-indent",
        name: "首行缩进",
        desc: "设置段落第一行的缩进距离。",
        sample: "text",
        fields: [
          range("value", "缩进距离", 20, 0, 100, 1, { unit: "px" })
        ],
        build(values) {
          return cssBlock([`text-indent: ${formatNumber(values.value)}px;`]);
        }
      },
      {
        id: "text-shadow",
        name: "文字阴影",
        desc: "为文字添加一层或多层阴影，支持设置颜色、偏移与模糊。",
        sample: "text",
        fields: [
          shadowList("shadows", "阴影列表", [
            { color: "#94a3b8", x: 2, y: 2, blur: 4 }
          ], { kind: "text" })
        ],
        build(values) {
          const shadows = values.shadows.map((shadow) => {
            return `${formatNumber(shadow.x)}px ${formatNumber(shadow.y)}px ${formatNumber(shadow.blur)}px ${shadow.color}`;
          }).join(", ");
          return cssBlock([`text-shadow: ${shadows};`]);
        }
      },
      {
        id: "text-transform",
        name: "文本转换",
        desc: "自动转换英文字母的大小写或全角显示。",
        sample: "text",
        fields: [
          radio("value", "转换方式", "uppercase", [
            ["none", "不转换"],
            ["uppercase", "全部大写"],
            ["lowercase", "全部小写"],
            ["capitalize", "单词首字母大写"],
            ["full-width", "转为全角"]
          ], { layout: "stacked" })
        ],
        build(values) {
          return cssBlock([`text-transform: ${values.value};`]);
        }
      },
      {
        id: "white-space",
        name: "空白处理",
        desc: "控制空格、换行与自动换行的处理方式。",
        sample: "whitespace",
        fields: [
          radio("value", "white-space 值", "pre-wrap", [
            ["normal", "正常处理"],
            ["nowrap", "强制不换行"],
            ["pre", "保留空白且不自动换行"],
            ["pre-wrap", "保留空白并自动换行"],
            ["pre-line", "合并空格但保留换行"],
            ["break-spaces", "保留空白并允许断行"]
          ], { layout: "stacked" })
        ],
        build(values) {
          return cssBlock([`white-space: ${values.value};`]);
        }
      },
      {
        id: "word-break",
        name: "单词断行",
        desc: "控制单词在容器边缘的断行规则，常用于中英文混排。",
        sample: "wordbreak",
        fields: [
          radio("value", "word-break 值", "break-word", [
            ["normal", "按语言规则断行"],
            ["break-all", "任意字符处断行"],
            ["keep-all", "保持单词完整"],
            ["break-word", "必要时断开单词"]
          ], { layout: "stacked" })
        ],
        build(values) {
          return cssBlock([`word-break: ${values.value};`]);
        }
      },
      {
        id: "word-spacing",
        name: "单词间距",
        desc: "调整单词之间的间距，对中文排版影响较小。",
        sample: "text",
        fields: [
          range("value", "单词间距", 20, 0, 50, 1, { unit: "px" })
        ],
        build(values) {
          return cssBlock([`word-spacing: ${formatNumber(values.value)}px;`]);
        }
      }
    ]
  };

  const transformGroup = {
    id: "transform",
    name: "变换",
    items: [
      {
        id: "perspective",
        name: "透视效果",
        desc: "在父元素上设置透视距离，在子元素上设置 X / Y 轴旋转，生成两段配套代码。",
        sample: "perspective",
        fields: [
          range("length", "透视距离", 150, 0, 500, 1, { unit: "px" }),
          range("rotateX", "X 轴旋转", 25, 0, 360, 1, { unit: "deg" }),
          range("rotateY", "Y 轴旋转", 20, 0, 360, 1, { unit: "deg" })
        ],
        sections(values) {
          return [
            {
              label: "复制到父元素",
              code: `perspective: ${formatNumber(values.length)}px;`
            },
            {
              label: "复制到子元素",
              code: `transform: rotateX(${formatNumber(values.rotateX)}deg) rotateY(${formatNumber(values.rotateY)}deg);\ntransform-style: preserve-3d;`
            }
          ];
        },
        build(values) {
          return [
            `.selector-parent {\n  perspective: ${formatNumber(values.length)}px;\n}`,
            `.selector {\n  transform: rotateX(${formatNumber(values.rotateX)}deg) rotateY(${formatNumber(values.rotateY)}deg);\n  transform-style: preserve-3d;\n}`
          ].join("\n\n");
        }
      },
      {
        id: "rotate",
        name: "旋转",
        desc: "在 2D 平面或 3D 空间中旋转元素。",
        sample: "transform",
        fields: [
          select("type", "旋转方式", "2d", [
            ["2d", "2D 平面旋转"],
            ["3d", "3D 轴向旋转"]
          ]),
          range("angle", "旋转角度", 35, -180, 180, 1, {
            unit: "deg",
            showIf: (values) => values.type === "2d"
          }),
          range("rotateX", "X 轴角度", 25, -180, 180, 1, { unit: "deg", showIf: (values) => values.type === "3d" }),
          range("rotateY", "Y 轴角度", 20, -180, 180, 1, { unit: "deg", showIf: (values) => values.type === "3d" }),
          range("rotateZ", "Z 轴角度", 35, -180, 180, 1, { unit: "deg", showIf: (values) => values.type === "3d" })
        ],
        build(values) {
          if (values.type === "2d") {
            return buildTransform([`rotate(${formatNumber(values.angle)}deg)`]);
          }
          return buildTransform([
            `rotateX(${formatNumber(values.rotateX)}deg)`,
            `rotateY(${formatNumber(values.rotateY)}deg)`,
            `rotateZ(${formatNumber(values.rotateZ)}deg)`
          ]);
        }
      },
      {
        id: "scale",
        name: "缩放",
        desc: "按比例放大或缩小元素，可让横纵方向使用不同比例。",
        sample: "transform",
        fields: [
          checkbox("same", "横纵使用同一比例", true),
          range("value", "缩放比例", 1.1, 0, 3, 0.05, {
            showIf: (values) => values.same
          }),
          range("scaleX", "横向比例", 1.2, 0, 3, 0.05, { showIf: (values) => !values.same }),
          range("scaleY", "纵向比例", 0.8, 0, 3, 0.05, { showIf: (values) => !values.same })
        ],
        build(values) {
          if (values.same) {
            return buildTransform([`scale(${formatNumber(values.value, 2)})`]);
          }
          return buildTransform([`scale(${formatNumber(values.scaleX, 2)}, ${formatNumber(values.scaleY, 2)})`]);
        }
      },
      {
        id: "skew",
        name: "倾斜",
        desc: "沿水平或垂直方向倾斜元素，制造平行四边形效果。",
        sample: "transform",
        fields: [
          range("x", "水平倾斜角", 10, -90, 90, 1, { unit: "deg" }),
          range("y", "垂直倾斜角", 10, -90, 90, 1, { unit: "deg" })
        ],
        build(values) {
          return buildTransform([
            `skew(${formatNumber(values.x)}deg, ${formatNumber(values.y)}deg)`
          ]);
        }
      },
      {
        id: "translate",
        name: "位移",
        desc: "沿水平和垂直方向移动元素，不会影响周围元素的布局。",
        sample: "transform",
        fields: [
          range("x", "水平位移", 50, -200, 200, 1, { unit: "px" }),
          range("y", "垂直位移", 0, -200, 200, 1, { unit: "px" })
        ],
        build(values) {
          return buildTransform([
            `translate(${formatNumber(values.x)}px, ${formatNumber(values.y)}px)`
          ]);
        }
      }
    ]
  };

  const animationGroup = {
    id: "animation",
    name: "动画与过渡",
    items: [
      {
        id: "keyframe-animation",
        name: "关键帧动画",
        desc: "选择预设动画，调整时长、缓动与播放次数，生成完整的 @keyframes 代码。",
        sample: "animation",
        fields: [
          select("preset", "动画预设", "pulse", null, { groups: animationGroups }),
          text("name", "动画名称", "myAnim", { hint: "用于 @keyframes 名称，支持中文；非法字符会自动替换。" }),
          number("duration", "持续时间（秒）", 2, { min: 0, step: 0.1 }),
          select("timing", "缓动函数", "ease", timingOptions),
          number("delay", "延迟时间（秒）", 0, { min: 0, step: 0.1 }),
          text("iteration", "播放次数", "1", { hint: "留空或填写 infinite 表示无限循环。" }),
          select("direction", "播放方向", "normal", directionOptions),
          select("fill", "结束状态", "forwards", fillModeOptions)
        ],
        build(values) {
          const name = sanitizeCssName(values.name);
          const preset = animationPresets.find((item) => item.value === values.preset) || animationPresets[0];
          const iteration = String(values.iteration || "").trim() || "infinite";
          const animation = `animation: ${name} ${formatNumber(values.duration, 2)}s ${values.timing} ${formatNumber(values.delay, 2)}s ${iteration} ${values.direction} ${values.fill};`;
          const declarations = [...(preset.base || []), animation];
          return `${cssBlock(declarations)}\n\n@keyframes ${name} {\n${preset.frames}\n}`;
        }
      },
      {
        id: "transition",
        name: "过渡效果",
        desc: "生成鼠标悬停时的平滑过渡代码，支持透明度、背景色与缩放。",
        sample: "transition",
        fields: [
          select("property", "过渡属性", "opacity", [
            ["opacity", "透明度"],
            ["background-color", "背景颜色"],
            ["transform", "缩放变换"]
          ]),
          range("startOpacity", "起始透明度", 100, 0, 100, 1, {
            unit: "%",
            showIf: (values) => values.property === "opacity"
          }),
          range("endOpacity", "结束透明度", 60, 0, 100, 1, {
            unit: "%",
            showIf: (values) => values.property === "opacity"
          }),
          color("fromColor", "起始背景色", "#3b82f6", {
            showIf: (values) => values.property === "background-color"
          }),
          color("toColor", "结束背景色", "#ec4899", {
            showIf: (values) => values.property === "background-color"
          }),
          range("fromScale", "起始缩放", 1, 0, 3, 0.05, {
            showIf: (values) => values.property === "transform"
          }),
          range("toScale", "结束缩放", 1.2, 0, 3, 0.05, {
            showIf: (values) => values.property === "transform"
          }),
          number("duration", "持续时间（秒）", 1, { min: 0, step: 0.1 }),
          select("timing", "缓动函数", "ease", timingOptions),
          number("delay", "延迟时间（秒）", 0, { min: 0, step: 0.1 })
        ],
        build(values) {
          const duration = `${formatNumber(values.duration, 2)}s`;
          const delay = `${formatNumber(values.delay, 2)}s`;
          const transition = `transition: ${values.property} ${duration} ${values.timing} ${delay};`;
          if (values.property === "opacity") {
            return `${cssBlock([
              `opacity: ${formatNumber(values.startOpacity / 100, 2)};`,
              transition
            ])}\n\n${cssBlock([
              `opacity: ${formatNumber(values.endOpacity / 100, 2)};`
            ], ".selector:hover")}`;
          }
          if (values.property === "background-color") {
            return `${cssBlock([
              `background-color: ${values.fromColor};`,
              transition
            ])}\n\n${cssBlock([
              `background-color: ${values.toColor};`
            ], ".selector:hover")}`;
          }
          return `${cssBlock([
            `transform: scale(${formatNumber(values.fromScale, 2)});`,
            transition
          ])}\n\n${cssBlock([
            `transform: scale(${formatNumber(values.toScale, 2)});`
          ], ".selector:hover")}`;
        }
      }
    ]
  };

  window.CSS_GENERATOR_GROUPS = [
    backgroundGroup,
    boxGroup,
    colorGroup,
    filterGroup,
    layoutGroup,
    listGroup,
    miscGroup,
    textGroup,
    transformGroup,
    animationGroup
  ];
})();
