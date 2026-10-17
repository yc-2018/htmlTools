/**
 * 首页工具搜索（仅桌面端显示，见 homepage-earth.css 的媒体查询）
 * - 支持按名称、拼音全拼、拼音首字母搜索（依赖 js/vendor/pinyin-pro.min.js 的 pinyinPro 全局）
 * - 渲染 A-Z 字母 + 0-9 数字按钮：与搜索一致，名称里任意一字的首字母（或数字字符）命中即可
 *   （点 D 会命中 3D机器手 / 大话骰 / 第一版 等），再次点击取消
 * - 命中的字符会高亮：拼音/首字母命中也能定位回具体的汉字（搜 t 高亮「特」）
 * - 搜索/筛选时会强制展开所有 <details>，清空后恢复原始展开状态
 */
(function () {
  'use strict';

  var HIDDEN_CLASS = 'search-hidden';
  var MARK_CLASS = 'home-search-mark';
  // A-Z 按拼音首字母筛选；0-9 按名称开头字符筛选
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    .split('')
    .concat('0123456789'.split(''));

  var hasPinyin = window.pinyinPro && typeof window.pinyinPro.pinyin === 'function';
  var charCache = {}; // 单字 -> { full, init }

  function charKey(ch) {
    if (charCache[ch]) return charCache[ch];
    var result = { full: ch.toLowerCase(), init: ch.toLowerCase() };
    if (hasPinyin && /[\u4e00-\u9fa5]/.test(ch)) {
      try {
        result.full = window.pinyinPro
          .pinyin(ch, { toneType: 'none', type: 'array' })
          .join('')
          .toLowerCase()
          .replace(/\s+/g, '');
        result.init = window.pinyinPro
          .pinyin(ch, { pattern: 'first', toneType: 'none', type: 'array' })
          .join('')
          .toLowerCase()
          .replace(/\s+/g, '');
      } catch (e) {
        /* 转换失败保持原文 */
      }
    }
    charCache[ch] = result;
    return result;
  }

  // 为一个链接文本建立索引：分字拼音 + 全拼串/首字母串（带回到字符位置的映射）
  function buildEntry(el, text) {
    var chars = Array.from(text);
    var fullStr = '';
    var initStr = '';
    var fullMap = [];
    var initMap = [];
    var initPerChar = [];
    for (var i = 0; i < chars.length; i++) {
      var k = charKey(chars[i]);
      initPerChar.push(k.init);
      for (var f = 0; f < k.full.length; f++) fullMap.push(i);
      fullStr += k.full;
      for (var n = 0; n < k.init.length; n++) initMap.push(i);
      initStr += k.init;
    }
    return {
      el: el,
      text: text,
      chars: chars,
      textKey: text.toLowerCase(),
      fullStr: fullStr,
      initStr: initStr,
      fullMap: fullMap,
      initMap: initMap,
      initPerChar: initPerChar,
      marked: false
    };
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // 收集命中的字符下标：原文 / 拼音全拼 / 首字母三条路径都要映射回汉字位置
  function collectMarks(entry, query) {
    var marks = {};
    var pos;
    pos = entry.textKey.indexOf(query);
    while (pos !== -1) {
      for (var i = pos; i < pos + query.length; i++) marks[i] = true;
      pos = entry.textKey.indexOf(query, pos + 1);
    }
    pos = entry.fullStr.indexOf(query);
    while (pos !== -1) {
      for (var j = pos; j < pos + query.length; j++) marks[entry.fullMap[j]] = true;
      pos = entry.fullStr.indexOf(query, pos + 1);
    }
    pos = entry.initStr.indexOf(query);
    while (pos !== -1) {
      for (var k = pos; k < pos + query.length; k++) marks[entry.initMap[k]] = true;
      pos = entry.initStr.indexOf(query, pos + 1);
    }
    return marks;
  }

  // 字母/数字筛选按钮命中的字符：与搜索一致，命中所有符合条件的字
  // （点 D 时「大话骰(第一版)」的大、第都会高亮）
  function collectLetterMarks(entry, letter) {
    var marks = {};
    for (var i = 0; i < entry.initPerChar.length; i++) {
      if (entry.initPerChar[i] === letter) marks[i] = true;
    }
    return marks;
  }

  function renderMarks(entry, marks) {
    var html = '';
    for (var i = 0; i < entry.chars.length; i++) {
      var piece = escapeHtml(entry.chars[i]);
      html += marks[i] ? '<mark class="' + MARK_CLASS + '">' + piece + '</mark>' : piece;
    }
    // 避免重复写 DOM
    if (entry.el.innerHTML !== html) entry.el.innerHTML = html;
    entry.marked = true;
  }

  function clearMarks(entry) {
    if (entry.marked) {
      entry.el.textContent = entry.text;
      entry.marked = false;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var input = document.getElementById('home-search-input');
    var letterBar = document.getElementById('home-search-letters');
    var countEl = document.getElementById('home-search-count');
    if (!input || !letterBar) return;

    // 收集所有工具条目（各分区里的 <li>），按链接建索引
    var items = [];
    var lis = document.querySelectorAll('.home-section li');
    for (var i = 0; i < lis.length; i++) {
      var li = lis[i];
      var anchors = li.querySelectorAll('a');
      var entries = [];
      var target = anchors.length ? anchors : [li];
      for (var j = 0; j < target.length; j++) {
        var text = target[j].textContent.trim();
        if (text) entries.push(buildEntry(target[j], text));
      }
      if (entries.length) items.push({ el: li, entries: entries });
    }

    var allDetails = document.querySelectorAll('.home-section, .home-subsection');
    var originalOpen = null; // 筛选前的展开状态
    var activeLetter = '';

    function matchesQuery(entry, query) {
      return (
        entry.textKey.indexOf(query) !== -1 ||
        entry.fullStr.indexOf(query) !== -1 ||
        entry.initStr.indexOf(query) !== -1
      );
    }

    function matchesLetter(entry, letter) {
      // 与搜索一致：名称里任意一个字的首字母/字符命中即可
      // 例如 D 命中 3D机器手（D）、大话骰（大）、第一版（第）；3 命中 3D、2048 里的 3
      for (var i = 0; i < entry.initPerChar.length; i++) {
        if (entry.initPerChar[i] === letter) return true;
      }
      return false;
    }

    function applyFilter() {
      var query = input.value.trim().toLowerCase();
      var filtering = query !== '' || activeLetter !== '';
      var visibleCount = 0;

      if (filtering && !originalOpen) {
        originalOpen = [];
        for (var d = 0; d < allDetails.length; d++) {
          originalOpen.push(allDetails[d].open);
        }
      }

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var show = false;
        for (var j = 0; j < item.entries.length; j++) {
          var entry = item.entries[j];
          var ok = true;
          if (query) ok = matchesQuery(entry, query);
          if (ok && activeLetter) ok = matchesLetter(entry, activeLetter);
          if (ok) show = true;
          // 关键词命中 + 字母/数字按钮命中都高亮对应字符
          if (ok) {
            var marks = query ? collectMarks(entry, query) : {};
            if (activeLetter) {
              var letterMarks = collectLetterMarks(entry, activeLetter);
              for (var pos in letterMarks) marks[pos] = true;
            }
            var hasMarks = false;
            for (var pos2 in marks) {
              hasMarks = true;
              break;
            }
            if (hasMarks) renderMarks(entry, marks);
            else clearMarks(entry);
          } else {
            clearMarks(entry);
          }
        }
        item.el.classList.toggle(HIDDEN_CLASS, !show);
        if (show) visibleCount++;
      }

      // 隐藏没有可见条目的列表/分区，筛选时强制展开所有 details
      for (var k = 0; k < allDetails.length; k++) {
        var details = allDetails[k];
        if (filtering) {
          details.open = true;
          var hasVisible = !!details.querySelector('li:not(.' + HIDDEN_CLASS + ')');
          var isLeafList = details.querySelector('li') !== null;
          details.classList.toggle(HIDDEN_CLASS, isLeafList && !hasVisible);
        } else {
          details.classList.remove(HIDDEN_CLASS);
          if (originalOpen) details.open = originalOpen[k];
        }
      }
      if (!filtering) originalOpen = null;

      if (countEl) {
        countEl.textContent = filtering ? '共 ' + visibleCount + ' 项' : '';
      }
    }

    // 渲染 A-Z 字母 + 0-9 数字按钮
    LETTERS.forEach(function (letter) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'home-search-letter';
      btn.textContent = letter;
      var isDigit = letter >= '0' && letter <= '9';
      btn.setAttribute('aria-label', (isDigit ? '筛选数字 ' : '筛选首字母 ') + letter);
      btn.addEventListener('click', function () {
        var lower = letter.toLowerCase();
        activeLetter = activeLetter === lower ? '' : lower;
        var buttons = letterBar.querySelectorAll('.home-search-letter');
        for (var b = 0; b < buttons.length; b++) {
          buttons[b].classList.toggle(
            'active',
            buttons[b].textContent.toLowerCase() === activeLetter
          );
        }
        applyFilter();
      });
      letterBar.appendChild(btn);
    });

    input.addEventListener('input', applyFilter);
    // 点 ESC 清空搜索
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && input.value) {
        input.value = '';
        applyFilter();
      }
    });
  });
})();
