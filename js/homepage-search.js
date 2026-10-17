/**
 * 首页工具搜索（仅桌面端显示，见 homepage-earth.css 的媒体查询）
 * - 支持按名称、拼音全拼、拼音首字母搜索（依赖 js/vendor/pinyin-pro.min.js 的 pinyinPro 全局）
 * - 渲染 A-Z 26 个字母按钮，点击按「首字拼音首字母」筛选，再次点击取消
 * - 搜索/筛选时会强制展开所有 <details>，清空后恢复原始展开状态
 */
(function () {
  'use strict';

  var HIDDEN_CLASS = 'search-hidden';
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  function toSearchKey(text) {
    var lower = text.toLowerCase();
    var full = lower;
    var initials = lower;
    if (window.pinyinPro && typeof window.pinyinPro.pinyin === 'function') {
      try {
        full = window.pinyinPro
          .pinyin(text, { toneType: 'none', type: 'array' })
          .join('')
          .toLowerCase()
          .replace(/\s+/g, '');
        initials = window.pinyinPro
          .pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' })
          .join('')
          .toLowerCase()
          .replace(/\s+/g, '');
      } catch (e) {
        /* 拼音转换失败时退化为纯文本搜索 */
      }
    }
    return { text: lower, full: full, initials: initials };
  }

  document.addEventListener('DOMContentLoaded', function () {
    var input = document.getElementById('home-search-input');
    var letterBar = document.getElementById('home-search-letters');
    var countEl = document.getElementById('home-search-count');
    if (!input || !letterBar) return;

    // 收集所有工具条目（各分区里的 <li>）
    var items = [];
    var lis = document.querySelectorAll('.home-section li');
    for (var i = 0; i < lis.length; i++) {
      var li = lis[i];
      var anchors = li.querySelectorAll('a');
      var keys = [];
      if (anchors.length) {
        for (var j = 0; j < anchors.length; j++) {
          var t = anchors[j].textContent.trim();
          if (t) keys.push(toSearchKey(t));
        }
      } else {
        keys.push(toSearchKey(li.textContent.trim()));
      }
      if (keys.length) {
        items.push({ el: li, keys: keys });
      }
    }

    var allDetails = document.querySelectorAll('.home-section, .home-subsection');
    var originalOpen = null; // 筛选前的展开状态
    var activeLetter = '';

    function matchesQuery(key, query) {
      return (
        key.text.indexOf(query) !== -1 ||
        key.full.indexOf(query) !== -1 ||
        key.initials.indexOf(query) !== -1
      );
    }

    function matchesLetter(key, letter) {
      var c = key.initials.charAt(0);
      if (c >= 'a' && c <= 'z') return c === letter;
      // 首字符不是字母（如数字），用原文首字符兜底
      return key.text.charAt(0) === letter;
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
        for (var j = 0; j < item.keys.length; j++) {
          var key = item.keys[j];
          var ok = true;
          if (query) ok = matchesQuery(key, query);
          if (ok && activeLetter) ok = matchesLetter(key, activeLetter);
          if (ok) {
            show = true;
            break;
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

    // 渲染 26 个字母按钮
    LETTERS.forEach(function (letter) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'home-search-letter';
      btn.textContent = letter;
      btn.setAttribute('aria-label', '筛选首字母 ' + letter);
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
