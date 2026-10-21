(function () {
  "use strict";

  const escapeMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => escapeMap[char]);
  }

  function attrs(map) {
    const parts = [];
    Object.entries(map).forEach(([name, value]) => {
      if (value === undefined || value === null || value === false || value === "") {
        return;
      }
      if (value === true) {
        parts.push(` ${name}`);
      } else {
        parts.push(` ${name}="${escapeHtml(value)}"`);
      }
    });
    return parts.join("");
  }

  function formatNumber(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return "0";
    }
    return String(Number(number.toFixed(digits)));
  }

  function cssBlock(declarations, selector = ".selector") {
    const list = (Array.isArray(declarations) ? declarations : [declarations]).filter(Boolean);
    const lines = list.map((item) => {
      const text = String(item);
      return `  ${text.endsWith(";") ? text : `${text};`}`;
    });
    return `${selector} {\n${lines.join("\n")}\n}`;
  }

  function cssString(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function sanitizeCssName(value, fallback = "myAnim") {
    const cleaned = String(value ?? "")
      .trim()
      .replace(/[^\p{L}\p{N}_-]/gu, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!cleaned) {
      return fallback;
    }
    return /^[\d-]/.test(cleaned) ? `anim-${cleaned}` : cleaned;
  }

  function indentBlock(value, spaces = 2) {
    const indent = " ".repeat(spaces);
    return String(value ?? "")
      .split("\n")
      .map((line) => `${indent}${line}`)
      .join("\n");
  }

  function clone(value) {
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch (error) {
        // 继续使用 JSON 方式复制
      }
    }
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeOptions(options) {
    return (options || []).map((option) => {
      if (Array.isArray(option)) {
        return { value: String(option[0]), label: option[1] };
      }
      return { value: String(option.value), label: option.label };
    });
  }

  function field(type, key, label, defaultValue, extra = {}) {
    return {
      key,
      label,
      type,
      default: defaultValue,
      ...extra
    };
  }

  const text = (key, label, defaultValue = "", extra = {}) => field("text", key, label, defaultValue, extra);
  const textarea = (key, label, defaultValue = "", extra = {}) => field("textarea", key, label, defaultValue, { rows: 3, ...extra });
  const number = (key, label, defaultValue = "", extra = {}) => field("number", key, label, defaultValue, extra);
  const range = (key, label, defaultValue, min, max, step = 1, extra = {}) => field("range", key, label, defaultValue, { min, max, step, ...extra });
  const checkbox = (key, label, defaultValue = false, extra = {}) => field("checkbox", key, label, defaultValue, extra);
  const color = (key, label, defaultValue = "#000000", extra = {}) => field("color", key, label, defaultValue, extra);

  function select(key, label, defaultValue, options, extra = {}) {
    const config = {
      ...extra,
      key,
      label,
      type: "select",
      default: defaultValue,
      options: normalizeOptions(options)
    };
    if (extra.groups) {
      config.groups = extra.groups.map((group) => ({
        label: group.label,
        options: normalizeOptions(group.options)
      }));
    }
    return config;
  }

  const radio = (key, label, defaultValue, options, extra = {}) => ({
    ...extra,
    key,
    label,
    type: "radio",
    default: defaultValue,
    options: normalizeOptions(options)
  });

  const shadowList = (key, label, defaultValue, extra = {}) => ({
    ...extra,
    key,
    label,
    type: "shadow-list",
    kind: extra.kind || "box",
    default: defaultValue
  });

  const colorStops = (key, label, defaultValue, extra = {}) => ({
    ...extra,
    key,
    label,
    type: "color-stops",
    default: defaultValue
  });

  function defaultForField(fieldConfig) {
    if (fieldConfig.default !== undefined) {
      return fieldConfig.default;
    }
    switch (fieldConfig.type) {
      case "checkbox":
        return false;
      case "number":
      case "range":
        return fieldConfig.min ?? 0;
      case "shadow-list":
      case "color-stops":
        return [];
      case "color":
        return "#000000";
      default:
        return "";
    }
  }

  function createState(item) {
    const values = {};
    item.fields.forEach((fieldConfig) => {
      values[fieldConfig.key] = clone(defaultForField(fieldConfig));
      if (Array.isArray(fieldConfig.units) && fieldConfig.units.length) {
        values[`${fieldConfig.key}Unit`] = fieldConfig.defaultUnit || fieldConfig.units[0];
      }
    });
    return values;
  }

  window.Gen = {
    escapeHtml,
    attrs,
    formatNumber,
    cssBlock,
    cssString,
    sanitizeCssName,
    indentBlock,
    clone,
    createState,
    text,
    textarea,
    number,
    range,
    checkbox,
    color,
    select,
    radio,
    shadowList,
    colorStops
  };
})();
