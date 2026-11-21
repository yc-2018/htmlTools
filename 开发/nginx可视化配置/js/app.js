(function () {
  'use strict';

  const STORAGE_KEY = 'html-tools:nginx-config-generator:v1';
  const FLASH_DURATION = 1300;
  const FOCUS_FLASH_DURATION = 1500;
  const REMOVE_DELAY = 500;

  const form = document.getElementById('configForm');
  const codePre = document.querySelector('.code');
  const previewEl = document.querySelector('.preview');
  const codeEl = document.getElementById('code');
  const lineCountEl = document.getElementById('lineCount');
  const toastEl = document.getElementById('toast');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const defaultState = {
    domain: 'example.com',
    root: '/var/www/example.com/public',
    port: '80',
    ipv6: true,
    wwwMode: 'add',
    indexFiles: 'index.html index.htm',

    https: false,
    http2: true,
    forceHttps: true,
    hsts: true,
    hstsSubdomains: true,
    hstsPreload: false,
    certType: 'letsencrypt',
    certPath: '/etc/nginx/ssl/example.com.crt',
    keyPath: '/etc/nginx/ssl/example.com.key',
    securityHeaders: true,
    csp: false,
    hideDotfiles: true,

    backend: 'static',
    spaFallback: false,
    phpSocket: 'unix:/var/run/php/php8.2-fpm.sock',
    proxyPass: '127.0.0.1:3000',
    proxyPath: '/',

    gzip: true,
    gzipLevel: '6',
    clientMaxBodySize: '16M',
    staticCache: true,
    cacheDays: '30',

    accessLog: '/var/log/nginx/access.log',
    errorLogLevel: 'warn',

    nginxUser: 'www-data',
    workerProcesses: 'auto',
    workerConnections: '1024',
    hideVersion: true
  };

  const GZIP_TYPES = [
    'text/plain',
    'text/css',
    'text/xml',
    'text/javascript',
    'application/json',
    'application/javascript',
    'application/xml',
    'application/xhtml+xml',
    'image/svg+xml'
  ].join(' ');

  const MEDIA_EXT = [
    'css', 'js', 'mjs', 'map', 'jpg', 'jpeg', 'png', 'gif', 'ico', 'svg',
    'webp', 'avif', 'woff2?', 'ttf', 'otf', 'eot', 'mp4', 'webm'
  ].join('|');

  let state = Object.assign({}, defaultState);
  let currentRender = null;
  let pendingRender = null;
  let pendingTimer = null;

  /* ---------- 状态读写 ---------- */

  function readForm() {
    form.querySelectorAll('[data-key]').forEach((el) => {
      const key = el.dataset.key;
      if (!(key in defaultState)) return;
      state[key] = el.type === 'checkbox' ? el.checked : el.value;
    });
  }

  function applyState(data) {
    form.querySelectorAll('[data-key]').forEach((el) => {
      const key = el.dataset.key;
      if (!(key in defaultState)) return;
      const value = key in data ? data[key] : defaultState[key];
      if (el.type === 'checkbox') {
        el.checked = Boolean(value);
      } else {
        el.value = value;
      }
    });
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const saved = JSON.parse(raw);
      const result = {};
      Object.keys(defaultState).forEach((key) => {
        if (key in saved && typeof saved[key] === typeof defaultState[key]) {
          result[key] = saved[key];
        }
      });
      return result;
    } catch (err) {
      return {};
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      /* 隐私模式下忽略 */
    }
  }

  function updateVisibility() {
    document.querySelectorAll('[data-depends]').forEach((el) => {
      const visible = el.dataset.depends.split(' ').every((rule) => {
        const [key, expected] = rule.split(':');
        if (expected !== undefined) return String(state[key]) === expected;
        return Boolean(state[key]);
      });
      el.hidden = !visible;
    });
  }

  /* ---------- 工具函数 ---------- */

  function text(key) {
    const value = state[key];
    return typeof value === 'string' ? value.trim() : '';
  }

  function getDomains() {
    const list = (state.domain || '')
      .split(/[\s,，;；]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return list.length ? list : ['example.com'];
  }

  function getServerNames(domains) {
    const names = domains.slice();
    const primary = domains[0];
    if (state.wwwMode === 'add' && isHostName(primary) && names.indexOf('www.' + primary) === -1) {
      names.push('www.' + primary);
    }
    return names;
  }

  function isHostName(host) {
    return !/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && host.indexOf(':') === -1;
  }

  function normalizeProxyPass(value) {
    if (!value) return 'http://127.0.0.1:3000';
    return /^https?:\/\//i.test(value) ? value : 'http://' + value;
  }

  function normalizePath(value) {
    let path = (value || '/').trim();
    if (!path.startsWith('/')) path = '/' + path;
    return path;
  }

  function getCertPaths(primary) {
    if (state.certType === 'custom') {
      return {
        cert: text('certPath') || '/etc/nginx/ssl/' + primary + '.crt',
        key: text('keyPath') || '/etc/nginx/ssl/' + primary + '.key',
        chain: ''
      };
    }
    const base = '/etc/letsencrypt/live/' + primary;
    return {
      cert: base + '/fullchain.pem',
      key: base + '/privkey.pem',
      chain: base + '/chain.pem'
    };
  }

  function getHstsValue() {
    let value = 'max-age=31536000';
    if (state.hstsSubdomains) value += '; includeSubDomains';
    if (state.hstsPreload) value += '; preload';
    return value;
  }

  /* ---------- 生成器：行 + 来源标记 ---------- */

  function createEmitter() {
    const lines = [];
    const tags = [];
    const groups = [];
    const active = new Set();
    let currentGroup = '';

    const split = (keys) => String(keys).split(/\s+/).filter(Boolean);

    return {
      push(line, extra) {
        const value = line === undefined ? '' : line;
        if (value === '' && lines.length > 0 && lines[lines.length - 1] === '') return;
        const keys = new Set(active);
        (extra || []).forEach((key) => keys.add(key));
        lines.push(value);
        tags.push(Array.from(keys));
        groups.push(currentGroup);
      },
      group(name) {
        currentGroup = name || '';
      },
      tag(keys) {
        split(keys).forEach((key) => active.add(key));
      },
      untag(keys) {
        split(keys).forEach((key) => active.delete(key));
      },
      result() {
        return { lines: lines, tags: tags, groups: groups, text: lines.join('\n') + '\n' };
      }
    };
  }

  function buildConfig() {
    const em = createEmitter();
    const domains = getDomains();
    const primary = domains[0];

    em.push('# --------------------------------');
    em.push('# 由「Nginx 配置生成器」生成');
    em.push('# 站点: ' + domains.join(', '));
    em.push('# --------------------------------');
    em.push('');

    em.group('global');

    if (text('nginxUser')) {
      em.tag('nginxUser');
      em.push('user ' + text('nginxUser') + ';');
      em.untag('nginxUser');
    }

    em.tag('workerProcesses');
    em.push('worker_processes ' + (text('workerProcesses') || 'auto') + ';');
    em.untag('workerProcesses');
    em.push('pid /run/nginx.pid;');
    em.push('');

    em.push('events {');
    em.tag('workerConnections');
    em.push('  worker_connections ' + (parseInt(state.workerConnections, 10) || 1024) + ';');
    em.untag('workerConnections');
    em.push('}');
    em.push('');

    em.group('');
    em.push('http {');
    em.push('  charset utf-8;');
    em.push('  sendfile on;');
    em.push('  tcp_nopush on;');
    em.push('  tcp_nodelay on;');
    em.push('  keepalive_timeout 65;');
    em.push('  types_hash_max_size 2048;');

    if (state.hideVersion) {
      em.group('global');
      em.tag('hideVersion');
      em.push('  server_tokens off;');
      em.untag('hideVersion');
      em.group('');
    }

    em.group('perf');
    em.tag('clientMaxBodySize');
    em.push('  client_max_body_size ' + (text('clientMaxBodySize') || '16M') + ';');
    em.untag('clientMaxBodySize');
    em.group('');

    em.push('');
    em.push('  include mime.types;');
    em.push('  default_type application/octet-stream;');
    em.push('');

    em.group('logs');
    em.tag('accessLog errorLogLevel');
    em.push('  # 全局日志');
    em.push('  access_log ' + (text('accessLog') || 'off') + ';');
    em.push('  error_log /var/log/nginx/error.log ' + (state.errorLogLevel || 'warn') + ';');
    em.untag('accessLog errorLogLevel');
    em.group('');

    if (state.gzip) {
      em.group('perf');
      em.push('');
      em.tag('gzip');
      em.push('  # Gzip 压缩');
      em.push('  gzip on;');
      em.push('  gzip_vary on;');
      em.push('  gzip_proxied any;');
      em.push('  gzip_min_length 256;');
      em.push('  gzip_comp_level ' + (state.gzipLevel || '6') + ';', ['gzipLevel']);
      em.push('  gzip_types ' + GZIP_TYPES + ';');
      em.untag('gzip');
      em.group('');
    }

    if (state.https) {
      em.group('https');
      em.push('');
      em.tag('https');
      em.push('  # SSL 全局配置');
      em.push('  ssl_session_timeout 1d;');
      em.push('  ssl_session_cache shared:SSL:10m;');
      em.push('  ssl_session_tickets off;');
      em.push('  ssl_protocols TLSv1.2 TLSv1.3;');
      em.push('  ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;');
      em.push('  ssl_prefer_server_ciphers off;');
      em.push('  ssl_stapling on;');
      em.push('  ssl_stapling_verify on;');
      em.push('  resolver 1.1.1.1 8.8.8.8 valid=300s;');
      em.push('  resolver_timeout 5s;');
      em.untag('https');
      em.group('');
    }

    em.push('');
    buildSiteServer(em, domains, primary);

    if (state.https && state.forceHttps) {
      em.push('');
      em.group('https');
      buildHttpRedirectServer(em, domains);
      em.group('');
    }

    if (state.wwwMode === 'redirect' && canRedirectWww(primary, domains)) {
      em.push('');
      em.group('basic');
      buildWwwRedirectServer(em, primary);
      em.group('');
    }

    em.push('}');
    return em.result();
  }

  function listenLines(em, indent, ssl) {
    const pad = '  '.repeat(indent);
    const port = ssl ? 443 : (parseInt(state.port, 10) || 80);
    const suffix = ssl ? ' ssl' + (state.http2 ? ' http2' : '') : '';
    em.push(pad + 'listen ' + port + suffix + ';');
    if (state.ipv6) em.push(pad + 'listen [::]:' + port + suffix + ';');
  }

  function buildSiteServer(em, domains, primary) {
    const serverNames = getServerNames(domains);
    const pad = '    ';

    em.group('basic');
    em.push('  # 站点：' + primary);
    em.push('  server {');

    em.tag('listen http2 ipv6 port');
    listenLines(em, 2, state.https);
    em.untag('listen http2 ipv6 port');

    em.tag('domain wwwMode');
    em.push(pad + 'server_name ' + serverNames.join(' ') + ';');
    em.untag('domain wwwMode');
    em.push('');

    if (text('root')) {
      em.tag('root');
      em.push(pad + 'root ' + text('root') + ';');
      em.untag('root');
    }

    if (text('indexFiles')) {
      em.tag('indexFiles');
      em.push(pad + 'index ' + text('indexFiles') + ';');
      em.untag('indexFiles');
    }

    if (state.https) {
      const certs = getCertPaths(primary);
      em.group('https');
      em.push('');
      em.tag('https certType certPath keyPath');
      em.push(pad + '# SSL 证书');
      em.push(pad + 'ssl_certificate     ' + certs.cert + ';');
      em.push(pad + 'ssl_certificate_key ' + certs.key + ';');
      if (certs.chain) em.push(pad + 'ssl_trusted_certificate ' + certs.chain + ';');
      em.untag('https certType certPath keyPath');
    }

    if (state.securityHeaders || state.csp || (state.https && state.hsts)) {
      em.group('https');
      em.push('');
      // 标题行随当前启用的分支一起标记，关闭分支时能跟着闪
      const headerKeys = [
        state.securityHeaders ? 'securityHeaders' : '',
        state.csp ? 'csp' : '',
        state.https && state.hsts ? 'https hsts' : ''
      ].filter(Boolean).join(' ');
      em.tag(headerKeys);
      em.push(pad + '# 安全响应头');
      em.untag(headerKeys);

      if (state.csp) {
        em.tag('csp');
        em.push(pad + 'add_header Content-Security-Policy "default-src \'self\' http: https: data: blob: \'unsafe-inline\'" always;');
        em.untag('csp');
      }

      if (state.https && state.hsts) {
        em.tag('https hsts hstsSubdomains hstsPreload');
        em.push(pad + 'add_header Strict-Transport-Security "' + getHstsValue() + '" always;');
        em.untag('https hsts hstsSubdomains hstsPreload');
      }

      if (state.securityHeaders) {
        em.tag('securityHeaders');
        em.push(pad + 'add_header X-Content-Type-Options "nosniff" always;');
        em.push(pad + 'add_header X-Frame-Options "SAMEORIGIN" always;');
        em.push(pad + 'add_header Referrer-Policy "no-referrer-when-downgrade" always;');
        if (state.https) em.push(pad + 'add_header X-XSS-Protection "1; mode=block" always;');
        em.untag('securityHeaders');
      }
    }

    em.group('logs');
    em.push('');
    em.tag('accessLog errorLogLevel');
    em.push(pad + '# 站点日志');
    em.push(pad + 'access_log ' + (text('accessLog') || 'off') + ';');
    em.push(pad + 'error_log /var/log/nginx/error.log ' + (state.errorLogLevel || 'warn') + ';');
    em.untag('accessLog errorLogLevel');

    if (state.hideDotfiles) {
      em.group('https');
      em.push('');
      em.tag('hideDotfiles');
      em.push(pad + '# 拒绝访问隐藏文件');
      em.push(pad + 'location ~ /\\.(?!well-known) {');
      em.push(pad + '  deny all;');
      em.push(pad + '}');
      em.untag('hideDotfiles');
    }

    if (state.staticCache) {
      const days = parseInt(state.cacheDays, 10) || 30;
      em.group('perf');
      em.push('');
      em.tag('staticCache cacheDays');
      em.push(pad + '# 静态资源缓存');
      em.push(pad + 'location ~* \\.(?:' + MEDIA_EXT + ')$ {');
      em.push(pad + '  expires ' + days + 'd;');
      em.push(pad + '  access_log off;');
      em.push(pad + '}');
      em.untag('staticCache cacheDays');
    }

    em.group('backend');
    em.push('');
    buildLocationBlock(em);

    em.group('basic');
    em.push('  }');
  }

  function buildLocationBlock(em) {
    const pad = '    ';

    if (state.backend === 'php') {
      em.tag('backend phpSocket');
      em.push(pad + '# PHP-FPM');
      em.push(pad + 'location ~ \\.php$ {');
      em.push(pad + '  fastcgi_pass ' + (text('phpSocket') || 'unix:/var/run/php/php8.2-fpm.sock') + ';');
      em.push(pad + '  fastcgi_index index.php;');
      em.push(pad + '  include fastcgi_params;');
      em.push(pad + '  fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;');
      em.push(pad + '  fastcgi_param PATH_INFO $fastcgi_path_info;');
      em.push(pad + '  fastcgi_read_timeout 60s;');
      em.push(pad + '}');
      em.push('');
      em.push(pad + 'location / {');
      em.push(pad + '  try_files $uri $uri/ /index.php?$query_string;');
      em.push(pad + '}');
      em.untag('backend phpSocket');
      return;
    }

    if (state.backend === 'proxy') {
      const path = normalizePath(state.proxyPath);
      em.tag('backend proxyPass proxyPath');
      em.push(pad + '# 反向代理到后端服务');
      em.push(pad + 'location ' + path + ' {');
      em.push(pad + '  proxy_pass ' + normalizeProxyPass(text('proxyPass')) + ';');
      em.push(pad + '  proxy_http_version 1.1;');
      em.push(pad + '  proxy_set_header Host $host;');
      em.push(pad + '  proxy_set_header X-Real-IP $remote_addr;');
      em.push(pad + '  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
      em.push(pad + '  proxy_set_header X-Forwarded-Proto $scheme;');
      em.push(pad + '  proxy_set_header X-Forwarded-Host $host;');
      em.push(pad + '  proxy_set_header Upgrade $http_upgrade;');
      em.push(pad + '  proxy_set_header Connection "upgrade";');
      em.push(pad + '  proxy_read_timeout 60s;');
      em.push(pad + '}');
      em.untag('backend proxyPass proxyPath');
      return;
    }

    em.tag('backend spaFallback');
    em.push(pad + '# 路由');
    em.push(pad + 'location / {');
    em.push(pad + (state.spaFallback ? '  try_files $uri $uri/ /index.html;' : '  try_files $uri $uri/ =404;'));
    em.push(pad + '}');
    em.untag('backend spaFallback');
  }

  function buildHttpRedirectServer(em, domains) {
    const names = getServerNames(domains);
    em.tag('https forceHttps ipv6 port');
    em.push('  # HTTP 跳转到 HTTPS');
    em.push('  server {');
    listenLines(em, 2, false);
    em.push('    server_name ' + names.join(' ') + ';');
    em.push('    return 301 https://$host$request_uri;');
    em.untag('https forceHttps ipv6 port');
    em.push('  }');
  }

  function canRedirectWww(primary, domains) {
    if (!isHostName(primary) || primary.indexOf('www.') === 0) return false;
    return domains.indexOf('www.' + primary) === -1;
  }

  function buildWwwRedirectServer(em, primary) {
    const wwwHost = 'www.' + primary;
    const pad = '    ';

    em.tag('wwwMode ipv6');
    em.push('  # www 跳转到主域名');
    em.push('  server {');
    listenLines(em, 2, state.https);
    em.push(pad + 'server_name ' + wwwHost + ';');

    if (state.https) {
      const certs = getCertPaths(primary);
      em.tag('https certPath keyPath');
      em.push(pad + 'ssl_certificate     ' + certs.cert + ';');
      em.push(pad + 'ssl_certificate_key ' + certs.key + ';');
      em.untag('https certPath keyPath');
    }

    const target = state.https ? 'https' : 'http';
    em.push(pad + 'return 301 ' + target + '://' + primary + '$request_uri;');
    em.untag('wwwMode ipv6');
    em.push('  }');
  }

  /* ---------- 语法高亮 ---------- */

  function tokenizeLine(line) {
    const tokens = [];
    let i = 0;
    let firstWord = true;

    while (i < line.length) {
      const ch = line[i];

      if (ch === ' ' || ch === '\t') {
        let j = i;
        while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++;
        tokens.push({ text: line.slice(i, j), cls: '' });
        i = j;
        continue;
      }

      if (ch === '#') {
        tokens.push({ text: line.slice(i), cls: 'tok-comment' });
        break;
      }

      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < line.length && line[j] !== ch) {
          if (line[j] === '\\') j++;
          j++;
        }
        j = Math.min(j + 1, line.length);
        tokens.push({ text: line.slice(i, j), cls: 'tok-string' });
        i = j;
        firstWord = false;
        continue;
      }

      if (ch === '{' || ch === '}' || ch === ';') {
        tokens.push({ text: ch, cls: 'tok-punct' });
        i++;
        continue;
      }

      if (ch === '$') {
        let j = i + 1;
        while (j < line.length && /[A-Za-z0-9_]/.test(line[j])) j++;
        tokens.push({ text: line.slice(i, j), cls: 'tok-var' });
        i = j;
        continue;
      }

      let j = i;
      while (j < line.length && !/[\s"'{};$]/.test(line[j])) j++;
      const word = line.slice(i, j);
      let cls = '';
      if (firstWord && word !== '}') {
        cls = 'tok-directive';
      } else if (/^\d+[a-zA-Z%]*$/.test(word)) {
        cls = 'tok-number';
      }
      tokens.push({ text: word, cls: cls });
      firstWord = false;
      i = j;
    }

    return tokens;
  }

  /* ---------- 渲染 ---------- */

  function renderResult(result) {
    const fragment = document.createDocumentFragment();

    result.lines.forEach((line) => {
      const lineEl = document.createElement('span');
      lineEl.className = 'code-line';

      tokenizeLine(line).forEach((token) => {
        if (!token.cls) {
          lineEl.appendChild(document.createTextNode(token.text));
          return;
        }
        const span = document.createElement('span');
        span.className = token.cls;
        span.textContent = token.text;
        lineEl.appendChild(span);
      });

      fragment.appendChild(lineEl);
    });

    codeEl.textContent = '';
    codeEl.appendChild(fragment);
    lineCountEl.textContent = result.lines.length + ' 行';
    currentRender = result;
  }

  /* ---------- 定位与闪烁 ---------- */

  function findRanges(tags, key) {
    const ranges = [];
    let start = -1;

    for (let i = 0; i <= tags.length; i++) {
      const hit = i < tags.length && tags[i].indexOf(key) !== -1;
      if (hit) {
        if (start === -1) start = i;
      } else if (start !== -1) {
        ranges.push([start, i - 1]);
        start = -1;
      }
    }

    return ranges;
  }

  function findRange(tags, key) {
    const ranges = findRanges(tags, key);
    if (!ranges.length) return null;
    return [ranges[0][0], Math.min(ranges[0][1], ranges[0][0] + 11)];
  }

  function findGroupRanges(groups, name) {
    const ranges = [];
    let start = -1;

    for (let i = 0; i <= groups.length; i++) {
      const hit = i < groups.length && groups[i] === name;
      if (hit) {
        if (start === -1) start = i;
      } else if (start !== -1) {
        ranges.push([start, i - 1]);
        start = -1;
      }
    }

    return ranges;
  }

  function widestRange(ranges) {
    return ranges.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a), ranges[0]);
  }

  function scrollRangeToCenter(range) {
    const first = codeEl.children[range[0]];
    const last = codeEl.children[range[1]] || first;
    if (!first) return;

    const center = (first.offsetTop + last.offsetTop + last.offsetHeight) / 2;
    const top = Math.max(0, center - codePre.clientHeight / 2);
    codePre.scrollTo({ top: top, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  const FLASH_THEMES = {
    on: { bar: 'rgba(34, 197, 94, 1)', soft: 'rgba(34, 197, 94, 0.34)', clear: 'rgba(34, 197, 94, 0)', duration: FLASH_DURATION },
    off: { bar: 'rgba(239, 68, 68, 1)', soft: 'rgba(239, 68, 68, 0.36)', clear: 'rgba(239, 68, 68, 0)', duration: REMOVE_DELAY - 40 },
    focus: { bar: 'rgba(56, 132, 255, 1)', soft: 'rgba(56, 132, 255, 0.26)', clear: 'rgba(56, 132, 255, 0)', duration: FOCUS_FLASH_DURATION }
  };

  function flashLines(range, type) {
    if (reduceMotion) return;

    const theme = FLASH_THEMES[type] || FLASH_THEMES.on;
    const frames = [
      { backgroundColor: theme.soft, boxShadow: 'inset 3px 0 0 0 ' + theme.bar },
      { backgroundColor: theme.soft, boxShadow: 'inset 3px 0 0 0 ' + theme.bar, offset: 0.6 },
      { backgroundColor: theme.clear, boxShadow: 'inset 3px 0 0 0 rgba(0, 0, 0, 0)' }
    ];

    for (let i = range[0]; i <= range[1]; i++) {
      const el = codeEl.children[i];
      if (!el || typeof el.animate !== 'function') continue;
      el.animate(frames, { duration: theme.duration, easing: 'ease-out' });
    }
  }

  /* ---------- 变更检测 ---------- */

  function detectDiff(prev) {
    const changed = Object.keys(defaultState).filter((key) => prev[key] !== state[key]);
    if (!changed.length) return null;

    let off = null;
    let on = null;
    let select = null;
    let input = null;

    changed.forEach((key) => {
      const el = form.querySelector('[data-key="' + key + '"]');
      if (!el) return;

      if (el.type === 'checkbox') {
        if (prev[key] === true && state[key] === false) {
          off = { key: key, kind: 'toggle', from: true, to: false };
        } else {
          on = { key: key, kind: 'toggle', from: false, to: true };
        }
      } else if (el.tagName === 'SELECT') {
        select = { key: key, kind: 'select' };
      } else {
        input = { key: key, kind: 'text' };
      }
    });

    return off || on || select || input;
  }

  /* ---------- 变更处理 ---------- */

  function commitPending() {
    pendingTimer = null;
    const next = pendingRender;
    pendingRender = null;
    if (next) renderResult(next);
  }

  function onChange() {
    const prev = Object.assign({}, state);
    readForm();

    const diff = detectDiff(prev);
    if (!diff) return;

    updateVisibility();
    saveState();

    const result = buildConfig();

    if (pendingTimer) {
      clearTimeout(pendingTimer);
      commitPending();
    }

    const removing = diff.kind === 'toggle' && diff.from === true && diff.to === false;
    if (removing) {
      const nextRange = findRange(result.tags, diff.key);
      const oldRanges = currentRender ? findRanges(currentRender.tags, diff.key) : [];

      // 关闭后相关配置整体消失：先红闪全部相关块，再重绘去掉
      if (!nextRange && oldRanges.length) {
        oldRanges.forEach((range) => flashLines(range, 'off'));
        scrollRangeToCenter(widestRange(oldRanges));
        pendingRender = result;
        pendingTimer = setTimeout(commitPending, REMOVE_DELAY);
        return;
      }
    }

    renderResult(result);

    if (diff.kind !== 'text') {
      const ranges = findRanges(result.tags, diff.key);
      if (ranges.length) {
        ranges.forEach((range) => flashLines(range, 'on'));
        scrollRangeToCenter(widestRange(ranges));
      }
    }
  }

  /* ---------- 交互 ---------- */

  let toastTimer = null;

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  // 窄屏下预览区在表单下方，定位前先把预览整体滚进视口
  function revealPreview() {
    const rect = previewEl.getBoundingClientRect();
    if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;

    const top = Math.max(0, window.scrollY + rect.top - 12);
    window.scrollTo({ top: top, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function jumpToGroup(name) {
    if (!currentRender) return;
    const ranges = findGroupRanges(currentRender.groups, name);

    if (!ranges.length) {
      showToast('这部分还没有生成配置，先启用相关开关');
      return;
    }

    ranges.forEach((range) => flashLines(range, 'focus'));
    scrollRangeToCenter(widestRange(ranges));
    revealPreview();
  }

  function copyConfig() {
    const config = buildConfig().text;

    const fallbackCopy = () => {
      const area = document.createElement('textarea');
      area.value = config;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        ok = false;
      }
      area.remove();
      showToast(ok ? '配置已复制' : '复制失败，请手动选择');
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(config).then(() => showToast('配置已复制'), fallbackCopy);
    } else {
      fallbackCopy();
    }
  }

  function downloadConfig() {
    const blob = new Blob([buildConfig().text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nginx.conf';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('已下载 nginx.conf');
  }

  function resetConfig() {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingRender = null;
      pendingTimer = null;
    }
    applyState(defaultState);
    readForm();
    updateVisibility();
    saveState();
    renderResult(buildConfig());
    showToast('已恢复默认配置');
  }

  form.addEventListener('input', onChange);
  form.addEventListener('change', onChange);

  form.querySelectorAll('.card-index').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      jumpToGroup(btn.dataset.goto);
    });
  });
  document.getElementById('btnCopy').addEventListener('click', copyConfig);
  document.getElementById('btnDownload').addEventListener('click', downloadConfig);
  document.getElementById('btnReset').addEventListener('click', resetConfig);

  applyState(loadState());
  readForm();
  updateVisibility();
  renderResult(buildConfig());
})();
