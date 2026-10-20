/* 局域网互传
 * 文件与文本：WebRTC DataChannel，点对点直传，不经过任何服务器。
 * 自动发现与配对信令：公共 MQTT over WebSocket，只转发“我在线 / 连接请求 / 接受 / 拒绝”这类小消息。
 */
(() => {
  'use strict';

  /* ---------- 基础工具 ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of kids.flat()) { if (c != null && c !== false) e.append(c); }
    return e;
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  /* ---------- 本机信息 ---------- */
  const ua = navigator.userAgent;
  const myKind = /Android|iPhone|iPad|Mobile/i.test(ua) ? 'phone' : 'pc';
  const osName = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : '设备';
  const myId = (() => {
    let id = store.get('lt_id') || '';
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) {
      id = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      store.set('lt_id', id);
    }
    return id;
  })();
  let myName = store.get('lt_name') || (osName + '-' + Math.random().toString(36).slice(2, 5).toUpperCase());
  store.set('lt_name', myName);
  const meBtn = $('#meBtn');
  const showMe = () => { meBtn.textContent = '本机：' + myName + ' ✎'; };
  showMe();
  meBtn.onclick = () => {
    const n = (prompt('本机名称', myName) || '').trim();
    if (!n) return;
    myName = n.slice(0, 24); store.set('lt_name', myName); showMe();
    for (const p of peers.values()) { if (p.state === 'open') safeSend(p, { type: 'hello', name: myName, kind: myKind, id: myId }); }
    sayHi(true);
  };

  /* ---------- 工具 ---------- */
  let toastTimer;
  function toast(t) {
    const e = $('#toast'); e.textContent = t; e.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.remove('show'), 2200);
  }
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function b64u(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const b = atob(s), u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  }
  async function pack(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let out = bytes, tag = '0';
    if (typeof CompressionStream !== 'undefined') {
      try {
        const cs = new CompressionStream('deflate-raw');
        const w = cs.writable.getWriter(); w.write(bytes); w.close();
        out = new Uint8Array(await new Response(cs.readable).arrayBuffer()); tag = '1';
      } catch (e) { out = bytes; tag = '0'; }
    }
    return 'LT' + tag + '.' + b64u(out);
  }
  async function unpack(code) {
    code = (code || '').trim().replace(/\s+/g, '');
    const m = /^LT([01])\.([A-Za-z0-9_-]+)$/.exec(code);
    if (!m) throw new Error('连接码格式不对，请完整复制（以 LT 开头）');
    let bytes = unb64u(m[2]);
    if (m[1] === '1') {
      if (typeof DecompressionStream === 'undefined') throw new Error('此浏览器不支持解压连接码，请换用较新的 Chrome / Edge');
      const ds = new DecompressionStream('deflate-raw');
      const w = ds.writable.getWriter(); w.write(bytes); w.close();
      bytes = new Uint8Array(await new Response(ds.readable).arrayBuffer());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async function copyText(text, ta) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) {}
    try { ta.focus(); ta.select(); ta.setSelectionRange(0, text.length); return document.execCommand('copy'); }
    catch (e) { return false; }
  }
  async function pasteInto(ta) {
    try {
      if (navigator.clipboard && window.isSecureContext && navigator.clipboard.readText) {
        ta.value = await navigator.clipboard.readText(); return;
      }
    } catch (e) {}
    toast('此页面不允许读剪贴板，请长按输入框手动粘贴'); ta.focus();
  }

  /* ---------- 设备 / 连接 ---------- */
  const peers = new Map();
  let seq = 0;
  function makePeer(role, extra) {
    const p = Object.assign({
      id: ++seq, role, name: '新设备', kind: 'pc', state: 'pending',
      pc: null, dc: null, queue: [], sending: false, rx: null, code: '',
      devId: null, auto: false, note: '', timer: 0, answered: false
    }, extra || {});
    p.role = role;
    peers.set(p.id, p);
    renderPeers();
    return p;
  }
  function safeSend(p, obj) {
    try { if (p.dc && p.dc.readyState === 'open') { p.dc.send(JSON.stringify(obj)); return true; } } catch (e) {}
    return false;
  }
  function newPC(p) {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.addEventListener('connectionstatechange', () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        if (p.dc && p.dc.readyState === 'open' && p.state !== 'closed') { p.state = 'open'; renderPeers(); }
      } else if (s === 'disconnected') {
        if (p.state === 'open') { p.state = 'unstable'; renderPeers(); }
      } else if (s === 'failed' || s === 'closed') { onClosed(p, s === 'failed'); }
    });
    p.pc = pc;
    return pc;
  }
  function iceDone(pc, ms = 4000) {
    return new Promise(res => {
      if (pc.iceGatheringState === 'complete') return res();
      const t = setTimeout(done, ms);
      function done() { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', chk); res(); }
      function chk() { if (pc.iceGatheringState === 'complete') done(); }
      pc.addEventListener('icegatheringstatechange', chk);
    });
  }
  function setupChannel(p, dc) {
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 1 << 20;
    p.dc = dc;
    const opened = () => {
      if (p.state === 'closed' || p.state === 'open') return;
      p.state = 'open';
      p.note = '';
      clearTimeout(p.timer);
      safeSend(p, { type: 'hello', name: myName, kind: myKind, id: myId });
      renderPeers();
      toast('已连接：' + p.name);
      if (modalPeer === p) closePair();
      if (p.auto) $('#askMask').hidden = true;
    };
    dc.addEventListener('open', opened);
    dc.addEventListener('close', () => onClosed(p, false));
    dc.addEventListener('message', e => onMessage(p, e.data));
    if (dc.readyState === 'open') opened();
  }
  function onClosed(p, failed) {
    if (p.state === 'closed') return;
    const wasPending = p.state === 'pending';
    p.state = 'closed';
    p.queue.length = 0;
    clearTimeout(p.timer);
    if (p.rx) { p.rx.item.status = 'error'; p.rx.item.err = '连接中断'; refreshItem(p.rx.item); p.rx = null; }
    try { p.dc && p.dc.close(); } catch (e) {}
    try { p.pc && p.pc.close(); } catch (e) {}
    renderPeers();
    if (wasPending && failed) {
      if (modalPeer === p) setMsg('连接失败，请看下方“连不上怎么办”，然后重新配对。');
      else toast('连接失败：双方可能不在同一局域网');
    } else if (!wasPending) {
      toast(p.name + ' 已断开');
    }
    cleanupAuto(p);
  }
  function cleanupAuto(p) {
    if (!p.auto) return;
    setTimeout(() => {
      if (peers.get(p.id) === p && p.state === 'closed') { peers.delete(p.id); renderPeers(); }
    }, 900);
  }
  function watchPeer(p, ms, msg) {
    clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      if (peers.get(p.id) !== p || p.state !== 'pending') return;
      p.state = 'closed';
      p.note = msg;
      try { p.pc && p.pc.close(); } catch (e) {}
      renderPeers();
      toast(msg);
      cleanupAuto(p);
    }, ms);
  }
  function removePeer(p) {
    onClosed(p, false);
    peers.delete(p.id);
    if (modalPeer === p) closePair();
    renderPeers();
  }

  /* ---------- 设备卡片 ---------- */
  const grid = $('#grid');
  const fileInput = $('#fileInput');
  let pickTarget = null;
  function pickFor(p) { pickTarget = p; fileInput.value = ''; fileInput.click(); }
  fileInput.addEventListener('change', () => {
    if (pickTarget && fileInput.files.length) enqueueFiles(pickTarget, [...fileInput.files]);
    fileInput.value = '';
  });
  function renderPeers() {
    grid.replaceChildren();
    const shown = new Set();
    for (const p of peers.values()) {
      grid.appendChild(peerCard(p));
      if (p.devId && p.state !== 'closed') shown.add(p.devId);
    }
    if (NET.state === 'online') {
      for (const d of disc.values()) {
        if (shown.has(d.id)) continue;
        grid.appendChild(nearCard(d));
      }
    }
    grid.appendChild(el('div', { class: 'card add', onclick: () => openPair(null) },
      el('div', { class: 'plus' }, '+'),
      el('div', {}, '手动添加设备'),
      el('div', { class: 'st' }, '自动发现不到时用连接码')));
  }
  function peerCard(p) {
    const open = p.state === 'open' || p.state === 'unstable';
    const map = {
      pending: [p.note || '等待配对…', 'warn'],
      open: ['已连接', 'ok'],
      unstable: ['连接不稳定', 'warn'],
      closed: ['已断开', 'err']
    };
    const [stText, stCls] = map[p.state];
    let btns;
    if (open) {
      btns = [
        el('button', { class: 'btn primary', onclick: () => pickFor(p) }, '发送文件'),
        el('button', { class: 'btn', onclick: () => openText(p) }, '发送文本'),
        el('button', { class: 'btn', onclick: () => removePeer(p) }, '断开')
      ];
    } else if (p.state === 'pending') {
      btns = [];
      if (!p.auto) btns.push(el('button', { class: 'btn primary', onclick: () => openPair(p) }, '继续配对'));
      btns.push(el('button', { class: 'btn', onclick: () => removePeer(p) }, '取消'));
    } else {
      btns = p.auto
        ? [el('button', { class: 'btn', onclick: () => removePeer(p) }, '移除')]
        : [
          el('button', { class: 'btn primary', onclick: () => { removePeer(p); openPair(null); } }, '重新配对'),
          el('button', { class: 'btn', onclick: () => removePeer(p) }, '移除')
        ];
    }
    const card = el('div', { class: 'card' + (open ? ' open' : '') },
      el('div', { class: 'avatar', title: open ? '点击选择文件发送' : '' }, p.kind === 'phone' ? '📱' : '💻'),
      el('div', { class: 'nm' }, p.name),
      el('div', { class: 'st ' + stCls }, stText),
      el('div', { class: 'btns' }, btns)
    );
    if (open) {
      card.querySelector('.avatar').addEventListener('click', () => pickFor(p));
      card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drop'); });
      card.addEventListener('dragleave', () => card.classList.remove('drop'));
      card.addEventListener('drop', e => {
        e.preventDefault(); e.stopPropagation(); card.classList.remove('drop');
        const fs = [...(e.dataTransfer?.files || [])];
        if (fs.length) enqueueFiles(p, fs);
      });
    }
    return card;
  }
  function nearCard(d) {
    return el('div', { class: 'card near' },
      el('div', { class: 'avatar' }, d.kind === 'phone' ? '📱' : '💻'),
      el('div', { class: 'nm' }, d.name),
      el('div', { class: 'st ok', title: '按公网出口 IP 判断，通常等于同一个路由器' }, '同局域网 · 在线'),
      el('div', { class: 'btns' },
        el('button', { class: 'btn primary', onclick: () => connectNearby(d) }, '连接')));
  }

  /* ---------- 传输记录 ---------- */
  const logList = $('#logList'), emptyLog = $('#emptyLog'), clearLogsBtn = $('#clearLogs');
  const logItems = []; // 保留引用：清空时要逐个 revokeObjectURL 释放接收到的文件
  function updateClearBtn() {
    if (clearLogsBtn) clearLogsBtn.disabled = logItems.length === 0;
  }
  function clearLogs() {
    if (!logItems.length) return;
    const busy = logItems.some(it => it.status === 'sending' || it.status === 'receiving' || it.status === 'queued');
    if (busy) { toast('还有传输没完成，完成后再清空'); return; }
    if (!confirm('清空全部传输记录？未保存的接收文件将无法再下载。')) return;
    for (const it of logItems) {
      if (!it.url) continue;
      try { URL.revokeObjectURL(it.url); } catch (e) {}
      it.url = '';
    }
    logItems.length = 0;
    logList.replaceChildren();
    emptyLog.hidden = false;
    updateClearBtn();
    toast('已清空记录，接收文件占用的内存已释放');
  }
  clearLogsBtn.addEventListener('click', clearLogs);
  function addLog(o) {
    const it = Object.assign({ status: '', done: 0, size: 0, t0: 0, speed: 0, lastUI: 0 }, o);
    const d = {};
    d.icon = el('div', { class: 'dir' }, o.dir === 'in' ? '⬇' : '⬆');
    d.thumb = el('img', { class: 'thumb', alt: '' }); d.thumb.hidden = true;
    d.nm = el('div', { class: 'nm' });
    d.meta = el('div', { class: 'meta' });
    d.bar = el('i'); d.barWrap = el('div', { class: 'bar' }, d.bar);
    d.act = el('div', { class: 'act' });
    it.dom = d;
    it.node = el('div', { class: 'log ' + o.dir }, d.icon, d.thumb, el('div', { class: 'info' }, d.nm, d.meta, d.barWrap), d.act);
    logList.prepend(it.node);
    logItems.push(it);
    emptyLog.hidden = true;
    updateClearBtn();
    refreshItem(it);
    return it;
  }
  function refreshItem(it) {
    const d = it.dom;
    const who = (it.dir === 'in' ? '来自 ' : '发给 ') + it.peerName;
    if (it.kind === 'text') {
      d.nm.textContent = it.text; d.nm.classList.add('txt');
      d.meta.textContent = who + ' · 文本'; d.barWrap.hidden = true;
      const b = el('button', { class: 'btn' }, '复制');
      b.addEventListener('click', async () => {
        const ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = it.text; document.body.append(ta);
        const ok = await copyText(it.text, ta); ta.remove(); toast(ok ? '已复制' : '复制失败，请手动选择文字');
      });
      d.act.replaceChildren(b);
      return;
    }
    d.nm.textContent = it.name;
    const pct = it.size ? Math.min(100, it.done / it.size * 100) : (it.status === 'done' ? 100 : 0);
    d.bar.style.width = pct + '%';
    let st = '';
    if (it.status === 'sending' || it.status === 'receiving') st = Math.floor(pct) + '% · ' + fmtSize(it.speed) + '/s';
    else if (it.status === 'queued') st = '排队中';
    else if (it.status === 'done') st = '完成';
    else if (it.status === 'error') st = '失败：' + (it.err || '未知错误');
    d.meta.textContent = [who, fmtSize(it.size), st].filter(Boolean).join(' · ');
    d.barWrap.hidden = (it.status === 'done' || it.status === 'error');
    if (it.dir === 'in' && it.status === 'done' && it.url) {
      if (/^image\//.test(it.mime || '') && it.size < 30 * 1048576) { d.thumb.src = it.url; d.thumb.hidden = false; }
      d.act.replaceChildren(el('a', { class: 'btn primary', href: it.url, download: it.name }, '保存'));
    } else if (it.status === 'error') {
      d.act.replaceChildren();
    }
  }
  function progress(it, done) {
    it.done = done;
    const now = performance.now();
    if (now - it.lastUI < 100 && done < it.size) return;
    it.lastUI = now;
    it.speed = done / Math.max(0.001, (now - it.t0) / 1000);
    refreshItem(it);
  }

  /* ---------- 发送 ---------- */
  function enqueueFiles(p, files) {
    if (p.state !== 'open' && p.state !== 'unstable') { toast('设备未连接'); return; }
    for (const f of files) {
      const item = addLog({ dir: 'out', peerName: p.name, kind: 'file', name: f.name, size: f.size, mime: f.type, status: 'queued' });
      p.queue.push({ file: f, item });
    }
    pump(p);
  }
  async function pump(p) {
    if (p.sending) return;
    p.sending = true;
    try {
      while (p.queue.length && p.dc && p.dc.readyState === 'open') {
        const job = p.queue.shift();
        await sendFile(p, job.file, job.item);
      }
    } finally { p.sending = false; }
  }
  function waitDrain(dc) {
    return new Promise(res => {
      const h = () => { dc.removeEventListener('bufferedamountlow', h); dc.removeEventListener('close', h); res(); };
      dc.addEventListener('bufferedamountlow', h); dc.addEventListener('close', h);
    });
  }
  async function sendFile(p, file, item) {
    const dc = p.dc;
    item.status = 'sending'; item.t0 = performance.now(); refreshItem(item);
    try {
      dc.send(JSON.stringify({ type: 'file-start', name: file.name, size: file.size, mime: file.type }));
      const BLOCK = 1 << 20, CH = 64 * 1024;
      let off = 0;
      while (off < file.size) {
        const block = await file.slice(off, off + BLOCK).arrayBuffer();
        for (let i = 0; i < block.byteLength; i += CH) {
          if (dc.readyState !== 'open') throw new Error('连接已断开');
          if (dc.bufferedAmount > 4 * 1048576) await waitDrain(dc);
          if (dc.readyState !== 'open') throw new Error('连接已断开');
          dc.send(block.slice(i, i + CH));
        }
        off += block.byteLength;
        progress(item, off);
      }
      dc.send(JSON.stringify({ type: 'file-end' }));
      item.status = 'done'; item.done = item.size; refreshItem(item);
    } catch (e) {
      item.status = 'error'; item.err = e.message || String(e); refreshItem(item);
      safeSend(p, { type: 'file-cancel' });
    }
  }

  /* ---------- 接收 ---------- */
  function onMessage(p, data) {
    if (typeof data !== 'string') {
      const r = p.rx; if (!r) return;
      r.chunks.push(data); r.got += data.byteLength;
      progress(r.item, r.got);
      return;
    }
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    switch (m.type) {
      case 'hello':
        p.name = (m.name || p.name).slice(0, 24);
        p.kind = m.kind || p.kind;
        if (m.id) p.devId = m.id;
        renderPeers(); break;
      case 'text':
        addLog({ dir: 'in', peerName: p.name, kind: 'text', text: String(m.text || '') });
        toast(p.name + ' 发来一段文本'); break;
      case 'file-start': {
        const item = addLog({ dir: 'in', peerName: p.name, kind: 'file', name: m.name || '未命名', size: m.size || 0, mime: m.mime || '', status: 'receiving' });
        item.t0 = performance.now();
        p.rx = { item, chunks: [], got: 0 }; break;
      }
      case 'file-end': {
        const r = p.rx; if (!r) break; p.rx = null;
        const it = r.item;
        if (r.got !== it.size) { it.status = 'error'; it.err = '数据不完整'; refreshItem(it); break; }
        const blob = new Blob(r.chunks, { type: it.mime || 'application/octet-stream' });
        it.url = URL.createObjectURL(blob); it.done = it.size; it.status = 'done';
        refreshItem(it);
        toast('收到文件：' + it.name);
        break;
      }
      case 'file-cancel': {
        const r = p.rx; if (!r) break; p.rx = null;
        r.item.status = 'error'; r.item.err = '对方取消了发送'; refreshItem(r.item); break;
      }
    }
  }

  /* ---------- 文本弹窗 ---------- */
  let textPeer = null;
  function openText(p) { textPeer = p; $('#textTitle').textContent = '发送文本给 ' + p.name; $('#textIn').value = ''; $('#textMask').hidden = false; setTimeout(() => $('#textIn').focus(), 50); }
  $('#textClose').onclick = () => { $('#textMask').hidden = true; };
  $('#textSend').onclick = () => {
    const t = $('#textIn').value;
    if (!t.trim()) return;
    if (textPeer && safeSend(textPeer, { type: 'text', text: t })) {
      addLog({ dir: 'out', peerName: textPeer.name, kind: 'text', text: t });
      $('#textMask').hidden = true;
    } else toast('发送失败，设备未连接');
  };

  /* ---------- 手动配对弹窗 ---------- */
  let modalPeer = null;
  const setMsg = t => { $('#pairMsg').textContent = t || ''; };
  function switchTab(t) {
    $('#tabHost').classList.toggle('on', t === 'host');
    $('#tabJoin').classList.toggle('on', t === 'join');
    $('#panelHost').hidden = t !== 'host';
    $('#panelJoin').hidden = t !== 'join';
  }
  function resetPairUI() {
    for (const id of ['offerCode', 'answerIn', 'offerIn', 'answerCode']) $('#' + id).value = '';
    $('#hostOut').hidden = true; $('#joinOut').hidden = true;
    $('#btnGen').hidden = false; $('#btnGen').disabled = false; $('#btnJoin').disabled = false;
    setMsg(''); switchTab('host');
    closeQr(); stopScan(true);
  }
  function openPair(peer) {
    resetPairUI();
    modalPeer = peer || null;
    $('#pairMask').hidden = false;
    if (peer && peer.state === 'pending') {
      if (peer.role === 'host') {
        switchTab('host'); $('#hostOut').hidden = false; $('#btnGen').hidden = true; $('#offerCode').value = peer.code;
      } else {
        switchTab('join'); $('#joinOut').hidden = false; $('#btnJoin').disabled = true; $('#answerCode').value = peer.code;
      }
    }
  }
  function closePair() { $('#pairMask').hidden = true; modalPeer = null; closeQr(); stopScan(true); }
  $('#pairClose').onclick = closePair;
  $('#tabHost').onclick = () => switchTab('host');
  $('#tabJoin').onclick = () => switchTab('join');

  $('#btnGen').onclick = async () => {
    if (!window.RTCPeerConnection) { setMsg('当前浏览器不支持 WebRTC，请换用 Chrome / Edge。'); return; }
    const btn = $('#btnGen'); btn.disabled = true; setMsg('正在生成…');
    try {
      const p = makePeer('host'); modalPeer = p;
      const pc = newPC(p);
      setupChannel(p, pc.createDataChannel('file'));
      await pc.setLocalDescription(await pc.createOffer());
      await iceDone(pc);
      p.code = await pack({ t: 'offer', sdp: pc.localDescription.sdp, name: myName, kind: myKind });
      $('#offerCode').value = p.code; $('#hostOut').hidden = false; btn.hidden = true; setMsg('');
    } catch (e) { setMsg('生成失败：' + (e.message || e)); }
    finally { btn.disabled = false; }
  };
  $('#copyOffer').onclick = async () => { toast(await copyText($('#offerCode').value, $('#offerCode')) ? '已复制邀请码' : '请手动长按选择并复制'); };
  $('#pasteAnswer').onclick = () => pasteInto($('#answerIn'));
  $('#btnConnect').onclick = async () => {
    const p = modalPeer;
    if (!p || p.role !== 'host' || p.state !== 'pending') { setMsg('请先生成邀请码。'); return; }
    try {
      const o = await unpack($('#answerIn').value);
      if (o.t === 'offer') throw new Error('这是邀请码，这里需要粘贴对方生成的回复码。');
      if (o.t !== 'answer') throw new Error('连接码类型不对。');
      p.name = o.name || p.name; p.kind = o.kind || p.kind;
      await p.pc.setRemoteDescription({ type: 'answer', sdp: o.sdp });
      setMsg('正在建立连接…'); renderPeers();
    } catch (e) { setMsg(e.message || String(e)); }
  };

  $('#pasteOffer').onclick = () => pasteInto($('#offerIn'));
  $('#btnJoin').onclick = async () => {
    if (!window.RTCPeerConnection) { setMsg('当前浏览器不支持 WebRTC，请换用 Chrome / Edge。'); return; }
    const btn = $('#btnJoin'); btn.disabled = true;
    try {
      const o = await unpack($('#offerIn').value);
      if (o.t === 'answer') throw new Error('这是回复码，请把它发回给发起方；这里需要粘贴对方的邀请码。');
      if (o.t !== 'offer') throw new Error('连接码类型不对。');
      setMsg('正在生成…');
      const p = makePeer('join'); p.name = o.name || p.name; p.kind = o.kind || p.kind; modalPeer = p; renderPeers();
      const pc = newPC(p);
      pc.addEventListener('datachannel', e => setupChannel(p, e.channel));
      await pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await iceDone(pc);
      p.code = await pack({ t: 'answer', sdp: pc.localDescription.sdp, name: myName, kind: myKind });
      $('#answerCode').value = p.code; $('#joinOut').hidden = false;
      setMsg('回复码已生成，发回给对方并等待连接…');
    } catch (e) { setMsg(e.message || String(e)); btn.disabled = false; }
  };
  $('#copyAnswer').onclick = async () => { toast(await copyText($('#answerCode').value, $('#answerCode')) ? '已复制回复码' : '请手动长按选择并复制'); };

  /* ---------- 二维码配对 ---------- */
  const qrCanvas = $('#qrCanvas');
  let scanStream = null, scanRAF = 0, scanTarget = '', scanLast = 0, scanToken = 0;

  function closeQr() { $('#qrMask').hidden = true; }

  function showQr(text, title) {
    text = (text || '').trim();
    if (!text) { toast('先生成连接码'); return; }
    if (typeof qrcode !== 'function') { toast('二维码组件没加载成功，请刷新页面'); return; }
    try {
      const qr = qrcode(0, 'L'); // 0 = 自动选择版本，L = 最低容错（容量最大）
      qr.addData(text, 'Byte');
      qr.make();
      const n = qr.getModuleCount();
      const quiet = 4;
      const scale = Math.max(2, Math.floor(760 / (n + quiet * 2)));
      const size = (n + quiet * 2) * scale;
      qrCanvas.width = size;
      qrCanvas.height = size;
      const ctx = qrCanvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#000';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
        }
      }
      $('#qrTitle').textContent = title;
      $('#qrMask').hidden = false;
    } catch (e) {
      toast('连接码太长，二维码放不下，请用复制粘贴');
    }
  }

  function stopScan(close) {
    scanToken++;
    if (scanRAF) { cancelAnimationFrame(scanRAF); scanRAF = 0; }
    if (scanStream) {
      for (const t of scanStream.getTracks()) { try { t.stop(); } catch (e) {} }
      scanStream = null;
    }
    const v = $('#scanVideo');
    if (v) v.srcObject = null;
    if (close) { $('#scanMask').hidden = true; scanTarget = ''; }
  }

  function acceptScan(text) {
    text = String(text || '').trim();
    if (!/^LT[01]\.[A-Za-z0-9_-]+$/.test(text)) {
      $('#scanMsg').textContent = '识别到了内容，但不是本工具的连接码，请对准正确的二维码。';
      return;
    }
    const target = scanTarget;
    stopScan(true);
    const ta = target ? $('#' + target) : null;
    if (ta) {
      ta.value = text;
      try { ta.scrollIntoView({ block: 'center' }); } catch (e) {}
    }
    toast('已扫入连接码');
  }

  function scanLoop(ts) {
    if ($('#scanMask').hidden) return;
    const v = $('#scanVideo');
    if (v && v.readyState >= 2 && v.videoWidth && (!scanLast || ts - scanLast > 250)) {
      scanLast = ts;
      const w = v.videoWidth, h = v.videoHeight;
      const scale = Math.min(1, 800 / Math.max(w, h));
      const c = $('#scanCanvas');
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const code = typeof window.jsQR === 'function' ? jsQR(img.data, c.width, c.height, { inversionAttempts: 'dontInvert' }) : null;
      if (code && code.data) { acceptScan(code.data); return; }
    }
    scanRAF = requestAnimationFrame(scanLoop);
  }

  async function openScan(targetId) {
    stopScan(false);
    const token = ++scanToken;
    $('#scanMask').hidden = false;
    $('#scanFile').value = '';
    $('#scanMsg').textContent = '正在打开摄像头…';
    scanTarget = targetId;
    if (typeof window.jsQR !== 'function') {
      $('#scanMsg').textContent = '扫码组件没加载成功，请刷新页面后重试。';
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('#scanMsg').textContent = '当前页面不能调用摄像头（需要 HTTPS 或 localhost），可以点“从相册选择”。';
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      if (token !== scanToken || $('#scanMask').hidden) {
        for (const t of stream.getTracks()) { try { t.stop(); } catch (e) {} }
        return;
      }
      scanStream = stream;
      const v = $('#scanVideo');
      v.srcObject = stream;
      await v.play();
      if (token !== scanToken) return;
      $('#scanMsg').textContent = '把二维码放进框里，尽量让屏幕亮一些…';
      scanLast = 0;
      scanRAF = requestAnimationFrame(scanLoop);
    } catch (e) {
      if (token !== scanToken) return;
      stopScan(false);
      const why = e.name === 'NotAllowedError' ? '没有授权' : e.name === 'NotFoundError' ? '没有找到摄像头' : (e.message || e.name);
      $('#scanMsg').textContent = '打不开摄像头（' + why + '），可以点“从相册选择”。';
    }
  }

  $('#qrOffer').onclick = () => showQr($('#offerCode').value, '邀请码二维码');
  $('#qrAnswer').onclick = () => showQr($('#answerCode').value, '回复码二维码');
  $('#scanOffer').onclick = () => openScan('offerIn');
  $('#scanAnswer').onclick = () => openScan('answerIn');
  $('#qrClose').onclick = closeQr;
  $('#scanClose').onclick = () => stopScan(true);
  $('#qrMask').addEventListener('click', e => { if (e.target === $('#qrMask')) closeQr(); });
  $('#scanMask').addEventListener('click', e => { if (e.target === $('#scanMask')) stopScan(true); });

  $('#scanPick').onclick = () => { $('#scanFile').value = ''; $('#scanFile').click(); };
  $('#scanFile').addEventListener('change', async () => {
    const file = $('#scanFile').files && $('#scanFile').files[0];
    if (!file) return;
    if (typeof window.jsQR !== 'function') { $('#scanMsg').textContent = '扫码组件没加载成功，请刷新页面'; return; }
    $('#scanMsg').textContent = '正在识别图片…';
    let source;
    try {
      if (typeof createImageBitmap === 'function') {
        source = await createImageBitmap(file);
      } else {
        const url = URL.createObjectURL(file);
        const im = new Image();
        await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; });
        source = im;
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      $('#scanMsg').textContent = '图片读取失败，换一张试试。';
      return;
    }
    const iw = source.width || source.naturalWidth || 0;
    const ih = source.height || source.naturalHeight || 0;
    if (!iw || !ih) { $('#scanMsg').textContent = '图片读取失败，换一张试试。'; return; }
    const scale = Math.min(1, 1200 / Math.max(iw, ih));
    const c = $('#scanCanvas');
    c.width = Math.max(1, Math.round(iw * scale));
    c.height = Math.max(1, Math.round(ih * scale));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, c.width, c.height);
    if (typeof source.close === 'function') source.close();
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const code = jsQR(data.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
    if (code && code.data) acceptScan(code.data);
    else $('#scanMsg').textContent = '没有识别到二维码，换一张更清晰、二维码更完整的图片试试。';
  });
  window.addEventListener('pagehide', () => stopScan(true));

  /* ---------- 自动发现与配对信令（MQTT over WebSocket） ---------- */
  /* 同时连接多个公共 MQTT 服务：只要两边有任意一个相同的服务可用，就能互相发现，
     避免单个公共服抖动时“两边都显示在线却看不到对方”。 */
  const textEnc = new TextEncoder();
  const textDec = new TextDecoder();
  const NET = {
    brokers: [
      'wss://broker.emqx.io:8084/mqtt',
      'wss://broker.hivemq.com:8884/mqtt',
      'wss://test.mosquitto.org:8081/mqtt'
    ],
    conns: [], state: 'idle', topic: '', room: 'lan', lastSay: 0, enabled: true,
    scope: '', scopeBusy: false, scopeToken: 0, lastProbe: 0
  };
  const disc = new Map(); // 同局域网设备：id -> {id,name,kind,last}
  const seenSig = new Set(); // 多通道去重：同一条配对消息只处理一次
  let askOffer = null;
  let sigSeq = 0;

  const roomOk = s => /^[A-Za-z0-9_-]{1,32}$/.test(s);
  function roomNow() {
    const r = (store.get('lt_room') || 'lan').trim();
    return roomOk(r) ? r : 'lan';
  }
  function cat(...arrs) {
    let n = 0;
    for (const a of arrs) n += a.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }
  const u16 = n => new Uint8Array([n >> 8, n & 255]);
  function mqttStr(s) {
    const b = textEnc.encode(s);
    return cat(u16(b.length), b);
  }
  function mqttPacket(type, flags, body) {
    const head = [(type << 4) | flags];
    let x = body.length;
    do { let d = x % 128; x = Math.floor(x / 128); if (x > 0) d |= 0x80; head.push(d); } while (x > 0);
    return cat(Uint8Array.from(head), body);
  }
  function rawSend(conn, pkt) {
    if (conn.ws && conn.ws.readyState === 1) { conn.ws.send(pkt); return true; }
    return false;
  }
  function connectPacket() {
    return mqttPacket(1, 0, cat(mqttStr('MQTT'), Uint8Array.of(4, 0x02, 0, 60),
      mqttStr(myId + '-' + Math.random().toString(36).slice(2, 8))));
  }
  function subscribePacket(topic) {
    return mqttPacket(8, 2, cat(u16(1), mqttStr(topic), Uint8Array.of(0)));
  }
  function publishPacket(topic, bytes) {
    return mqttPacket(3, 0, cat(mqttStr(topic), bytes));
  }

  /* ---------- 同局域网判定（公网出口近似） ---------- */
  /* 浏览器不能真的扫描局域网；这里用 STUN 探测公网出口 IP，把出口相同的设备分到同一个
     MQTT topic。同一个路由器下的设备出口相同，不同网络即使房间名相同也互相看不到。 */
  const STUN_URLS = [
    'stun:stun.cloudflare.com:3478',
    'stun:stun.nextcloud.com:443',
    'stun:stun.l.google.com:19302'
  ];
  function v6Prefix64(ip) {
    ip = ip.split('%')[0];
    if (!ip.includes(':') || ip.includes('.')) return '';
    const parts = ip.split('::');
    let groups;
    if (parts.length === 2) {
      const left = parts[0] ? parts[0].split(':') : [];
      const right = parts[1] ? parts[1].split(':') : [];
      const fill = 8 - left.length - right.length;
      if (fill < 0) return '';
      groups = [...left, ...Array(fill).fill('0'), ...right];
    } else {
      groups = ip.split(':');
      if (groups.length !== 8) return '';
    }
    if (groups.some(g => !/^[0-9a-fA-F]{1,4}$/.test(g))) return '';
    return groups.slice(0, 4).map(g => g.toLowerCase().padStart(4, '0')).join(':');
  }
  async function scopeHash(key) {
    const data = textEnc.encode(NET.room + '|' + key);
    try {
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const d = await crypto.subtle.digest('SHA-256', data);
        return [...new Uint8Array(d).slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) {}
    let h = 2166136261;
    for (const b of data) { h ^= b; h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  async function probeScope() {
    if (typeof RTCPeerConnection !== 'function') return '';
    const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_URLS }] });
    try {
      pc.createDataChannel('scope');
      await pc.setLocalDescription(await pc.createOffer());
      await iceDone(pc, 4000);
      const sdp = (pc.localDescription && pc.localDescription.sdp) || '';
      let v4 = '', v6 = '';
      for (const line of sdp.split('\n')) {
        if (!line.startsWith('a=candidate:')) continue;
        const p = line.split(' ');
        if (p[2] !== 'udp' || p[7] !== 'srflx') continue;
        const ip = p[4];
        if (!ip) continue;
        if (!v4 && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) v4 = ip;
        else if (!v6 && ip.includes(':')) v6 = ip;
      }
      let key = '';
      if (v4) key = 'v4:' + v4;
      else if (v6) {
        const prefix = v6Prefix64(v6);
        if (prefix) key = 'v6:' + prefix;
      }
      if (!key) return '';
      NET.lastProbe = Date.now();
      return await scopeHash(key);
    } catch (e) {
      return '';
    } finally {
      try { pc.close(); } catch (e) {}
    }
  }
  function topicFor() {
    return NET.scope ? 'lt/v2/' + NET.scope + '/' + NET.room : '';
  }
  async function startDiscovery(forceProbe) {
    if (!NET.enabled) return;
    if (!NET.scope || forceProbe) {
      const token = ++NET.scopeToken;
      NET.scopeBusy = true;
      netStatus();
      const s = await probeScope();
      if (token !== NET.scopeToken) return;
      NET.scopeBusy = false;
      if (!NET.enabled) { netStatus(); return; }
      if (!s) { netStatus(); return; }
      if (s !== NET.scope) {
        NET.scope = s;
        disc.clear();
        renderPeers();
      }
    }
    NET.topic = topicFor();
    for (const c of NET.conns) connectConn(c);
    netStatus();
  }
  async function recheckScope() {
    if (!NET.enabled || NET.scopeBusy || !NET.scope) return;
    if (Date.now() - NET.lastProbe < 120000) return;
    const token = NET.scopeToken;
    NET.lastProbe = Date.now();
    const s = await probeScope();
    if (token !== NET.scopeToken || !NET.enabled || !s || s === NET.scope) return;
    NET.scope = s;
    NET.topic = topicFor();
    disc.clear();
    renderPeers();
    restartNet();
  }

  function sendSig(obj) {
    if (!NET.conns.length) return false;
    const msg = Object.assign({ n: myId + ':' + (++sigSeq) }, obj);
    const bytes = textEnc.encode(JSON.stringify(msg));
    let sent = false;
    for (const c of NET.conns) {
      if (!c.ready) continue;
      try { if (rawSend(c, publishPacket(NET.topic, bytes))) sent = true; } catch (e) {}
    }
    return sent;
  }
  function netStatus() {
    const ready = NET.conns.filter(c => c.ready).length;
    const connecting = NET.conns.some(c => !c.ready && c.ws && c.ws.readyState === 0);
    let kind = 'offline', text = '发现服务连不上（检查网络 / 代理），可继续用扫码 / 手动连接码';
    if (!NET.enabled) {
      kind = 'off';
      text = '自动发现已关闭，扫码 / 手动配对仍可用';
    } else if (NET.scopeBusy) {
      kind = 'locating';
      text = '正在判断所在局域网…';
    } else if (!NET.scope) {
      kind = 'unknown';
      text = '无法判断所在局域网（STUN 不可用），自动发现已暂停，可用扫码 / 手动配对';
    } else if (ready) {
      kind = 'online';
      text = '同局域网发现已开启' + (ready > 1 ? '（' + ready + ' 个通道）' : '');
    } else if (connecting) {
      kind = 'connecting';
      text = '正在连接发现服务…';
    }
    const changed = NET.state !== kind;
    NET.state = kind;
    const dot = $('#discDot');
    if (dot) dot.className = 'dot ' + kind;
    const label = $('#discText');
    if (label) label.textContent = text;
    const room = $('#roomBtn');
    if (room) {
      room.textContent = '房间：' + NET.room;
      room.hidden = !NET.enabled || !NET.scope;
    }
    const retry = $('#discRetry');
    if (retry) retry.hidden = kind !== 'offline' && kind !== 'unknown';
    if (!changed) return;
    if (kind === 'online') {
      sendSig({ t: 'who', id: myId });
      sayHi(true);
    } else if (kind === 'off' || kind === 'unknown') {
      disc.clear();
      renderPeers();
    }
  }
  function connectConn(c) {
    if (!NET.enabled || !NET.scope) return;
    const token = ++c.token;
    clearTimeout(c.retryTimer);
    clearTimeout(c.connectTimer);
    clearInterval(c.pingTimer);
    try { if (c.ws) c.ws.close(); } catch (e) {}
    c.ws = null;
    c.ready = false;
    c.buf = new Uint8Array(0);
    let ws;
    try { ws = new WebSocket(c.url, 'mqtt'); }
    catch (e) { connFail(c, token); return; }
    ws.binaryType = 'arraybuffer';
    c.ws = ws;
    netStatus();
    c.connectTimer = setTimeout(() => {
      if (token !== c.token) return;
      try { ws.close(); } catch (e) {}
      connFail(c, token);
    }, 7000);
    ws.onopen = () => {
      if (token !== c.token) return;
      c.buf = new Uint8Array(0);
      rawSend(c, connectPacket());
    };
    ws.onmessage = ev => {
      if (token !== c.token || typeof ev.data === 'string') return;
      c.lastRecv = Date.now();
      pushBuf(c, new Uint8Array(ev.data));
      readBuf(c);
    };
    ws.onclose = () => { if (token === c.token) connFail(c, token); };
    ws.onerror = () => { if (token === c.token) connFail(c, token); };
  }
  function connFail(c, token) {
    if (token !== c.token || !NET.enabled) return;
    c.token++;
    clearTimeout(c.connectTimer);
    clearInterval(c.pingTimer);
    c.ready = false;
    try { if (c.ws) c.ws.close(); } catch (e) {}
    c.ws = null;
    c.tries++;
    netStatus();
    clearTimeout(c.retryTimer);
    c.retryTimer = setTimeout(() => connectConn(c), Math.min(30000, 3000 + c.tries * 3000));
  }
  function onConnack(c, ok) {
    clearTimeout(c.connectTimer);
    if (!ok) { connFail(c, c.token); return; }
    c.ready = true;
    c.tries = 0;
    c.lastRecv = Date.now();
    rawSend(c, subscribePacket(NET.topic));
    startPing(c);
    netStatus();
  }
  function startPing(c) {
    clearInterval(c.pingTimer);
    c.pingTimer = setInterval(() => {
      if (!rawSend(c, mqttPacket(12, 0, new Uint8Array(0)))) connFail(c, c.token);
    }, 25000);
  }
  function pushBuf(c, chunk) {
    const b = new Uint8Array(c.buf.length + chunk.length);
    b.set(c.buf); b.set(chunk, c.buf.length);
    c.buf = b;
  }
  function readBuf(c) {
    for (;;) {
      const buf = c.buf;
      if (buf.length < 2) return;
      let i = 1, mult = 1, len = 0, b;
      do {
        if (i >= buf.length) return;
        b = buf[i++]; len += (b & 127) * mult; mult *= 128;
        if (i > 5) return;
      } while (b & 128);
      const end = i + len;
      if (buf.length < end) return;
      handlePacket(c, buf[0] >> 4, (buf[0] >> 1) & 3, buf.subarray(i, end));
      c.buf = buf.subarray(end);
    }
  }
  function sigDup(n) {
    if (seenSig.has(n)) return true;
    seenSig.add(n);
    if (seenSig.size > 800) seenSig.delete(seenSig.values().next().value);
    return false;
  }
  function handlePacket(c, type, qos, body) {
    c.lastRecv = Date.now();
    if (type === 2) {
      onConnack(c, body.length > 1 && body[1] === 0);
      return;
    }
    if (type !== 3 || body.length < 2) return;
    const tl = (body[0] << 8) | body[1];
    if (body.length < 2 + tl) return;
    const topic = textDec.decode(body.subarray(2, 2 + tl));
    let off = 2 + tl;
    if (qos > 0) off += 2;
    if (topic !== NET.topic) return;
    let m;
    try { m = JSON.parse(textDec.decode(body.subarray(off))); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.n && sigDup(m.n)) return;
    onSig(m);
  }
  function sayHi(force) {
    if (NET.state !== 'online') return;
    const now = Date.now();
    if (!force && now - NET.lastSay < 15000) return;
    NET.lastSay = now;
    sendSig({ t: 'hi', id: myId, name: myName, kind: myKind });
  }
  function heartbeat() {
    if (!NET.enabled || NET.state !== 'online') return;
    for (const c of NET.conns) {
      if (c.ready && Date.now() - c.lastRecv > 90000) connFail(c, c.token);
    }
    sayHi(false);
    let changed = false;
    const now = Date.now();
    for (const [id, d] of disc) {
      if (now - d.last > 40000) { disc.delete(id); changed = true; }
    }
    if (changed) renderPeers();
  }
  function restartNet() {
    if (!NET.enabled) { netStatus(); return; }
    if (!NET.scope) { startDiscovery(); return; }
    NET.topic = topicFor();
    for (const c of NET.conns) {
      c.token++;
      clearTimeout(c.connectTimer);
      clearTimeout(c.retryTimer);
      clearInterval(c.pingTimer);
      try { if (c.ws) c.ws.close(); } catch (e) {}
      c.ws = null;
      c.ready = false;
      c.buf = new Uint8Array(0);
      c.tries = 0;
    }
    netStatus();
    for (const c of NET.conns) connectConn(c);
  }
  function initNet() {
    NET.enabled = store.get('lt_disc') !== '0';
    const toggle = $('#discToggle');
    if (toggle) toggle.checked = NET.enabled;
    NET.room = roomNow();
    NET.scope = '';
    NET.scopeBusy = false;
    NET.scopeToken = 0;
    NET.lastProbe = 0;
    NET.conns = NET.brokers.map(url => ({
      url, ws: null, buf: new Uint8Array(0), ready: false, token: 0,
      retryTimer: 0, pingTimer: 0, connectTimer: 0, tries: 0, lastRecv: 0
    }));
    if (NET.enabled) startDiscovery();
    else netStatus();
    setInterval(heartbeat, 6000);
    setInterval(() => { if (NET.enabled) recheckScope(); }, 300000);
    window.addEventListener('focus', () => { sayHi(true); recheckScope(); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { sayHi(true); recheckScope(); }
    });
  }
  function shutdownNet() {
    NET.scopeToken++;
    NET.scopeBusy = false;
    NET.scope = '';
    NET.topic = '';
    if (askOffer) {
      sendSig({ t: 'reject', from: myId, to: askOffer.from });
      askOffer = null;
      $('#askMask').hidden = true;
    }
    for (const c of NET.conns) {
      c.token++;
      clearTimeout(c.connectTimer);
      clearTimeout(c.retryTimer);
      clearInterval(c.pingTimer);
      try { if (c.ws) c.ws.close(); } catch (e) {}
      c.ws = null;
      c.ready = false;
      c.buf = new Uint8Array(0);
      c.tries = 0;
    }
    for (const p of [...peers.values()]) {
      if (p.auto && p.state === 'pending') {
        p.state = 'closed';
        p.note = '自动发现已关闭';
        try { p.pc && p.pc.close(); } catch (e) {}
        cleanupAuto(p);
      }
    }
    disc.clear();
    renderPeers();
    netStatus();
  }
  const discToggle = $('#discToggle');
  if (discToggle) {
    discToggle.addEventListener('change', () => {
      NET.enabled = discToggle.checked;
      store.set('lt_disc', NET.enabled ? '1' : '0');
      if (NET.enabled) startDiscovery(true);
      else shutdownNet();
    });
  }
  function upsertDevice(id, name, kind) {
    const cur = disc.get(id);
    const nm = String(name || '设备').slice(0, 24) || '设备';
    const kd = kind === 'phone' ? 'phone' : 'pc';
    const changed = !cur || cur.name !== nm || cur.kind !== kd;
    disc.set(id, { id, name: nm, kind: kd, last: Date.now() });
    if (changed) renderPeers();
  }
  function onSig(m) {
    if (!m || typeof m !== 'object') return;
    if (m.to !== undefined && m.to !== myId) return;
    switch (m.t) {
      case 'hi':
        if (m.id === myId || !idOk(m.id)) return;
        upsertDevice(m.id, m.name, m.kind);
        break;
      case 'who':
        if (m.id !== myId && idOk(m.id)) sayHi(true);
        break;
      case 'bye':
        if (idOk(m.id) && disc.delete(m.id)) renderPeers();
        break;
      case 'offer': handleOffer(m); break;
      case 'answer': handleAnswer(m); break;
      case 'reject': handleReject(m); break;
      case 'busy': handleBusy(m); break;
    }
  }
  const activePeerFor = id => [...peers.values()].find(p => p.devId === id && p.state !== 'closed');
  const pendingPeerFor = id => [...peers.values()].find(p => p.devId === id && p.state === 'pending');
  const idOk = s => typeof s === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s);

  function connectNearby(d) {
    if (NET.state !== 'online') { toast('发现服务未连接，请稍后再试'); return; }
    const busy = activePeerFor(d.id);
    if (busy) { toast('已经和该设备建立或正在建立连接'); return; }
    const p = makePeer('host', { devId: d.id, name: d.name, kind: d.kind, auto: true, note: '正在准备连接…' });
    (async () => {
      try {
        const pc = newPC(p);
        setupChannel(p, pc.createDataChannel('file'));
        await pc.setLocalDescription(await pc.createOffer());
        await iceDone(pc, 3000);
        if (p.state === 'closed' || peers.get(p.id) !== p) return;
        p.note = '等待对方接受…';
        renderPeers();
        if (!sendSig({ t: 'offer', from: myId, to: d.id, sdp: pc.localDescription.sdp, name: myName, kind: myKind })) {
          throw new Error('发现服务已断开');
        }
        watchPeer(p, 30000, '连接超时：对方未响应，或不在同一局域网');
      } catch (e) {
        if (p.state !== 'closed') { p.state = 'closed'; p.note = '发起失败'; }
        try { p.pc && p.pc.close(); } catch (_) {}
        renderPeers();
        toast('发起连接失败：' + (e.message || e));
        cleanupAuto(p);
      }
    })();
  }
  async function handleOffer(m) {
    if (!idOk(m.from) || m.from === myId || typeof m.sdp !== 'string' || !m.sdp) return;
    if (activePeerFor(m.from) || askOffer) { sendSig({ t: 'busy', from: myId, to: m.from }); return; }
    upsertDevice(m.from, m.name, m.kind);
    askOffer = m;
    $('#askText').textContent = String(m.name || '一台设备').slice(0, 24) + ' 想和你连接';
    $('#askMsg').textContent = '接受后对方就能直接给你发文件和文本；不认识的设备请点拒绝。对方可能不在同一局域网，跨网络时可能连不上。';
    $('#askYes').disabled = false;
    $('#askNo').disabled = false;
    $('#askMask').hidden = false;
  }
  async function acceptAsk() {
    const m = askOffer;
    if (!m) return;
    $('#askYes').disabled = true;
    $('#askNo').disabled = true;
    $('#askMsg').textContent = '正在建立连接…';
    try {
      const p = makePeer('join', {
        devId: m.from,
        name: String(m.name || '同局域网设备').slice(0, 24),
        kind: m.kind === 'phone' ? 'phone' : 'pc',
        auto: true,
        note: '正在建立连接…'
      });
      const pc = newPC(p);
      pc.addEventListener('datachannel', e => setupChannel(p, e.channel));
      await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await iceDone(pc, 3000);
      if (!sendSig({ t: 'answer', from: myId, to: m.from, sdp: pc.localDescription.sdp, name: myName, kind: myKind })) {
        throw new Error('发现服务已断开');
      }
      askOffer = null;
      $('#askMask').hidden = true;
      renderPeers();
      watchPeer(p, 20000, '连接超时：可能不在同一局域网');
    } catch (e) {
      const p = pendingPeerFor(m.from);
      if (p) {
        p.state = 'closed'; p.note = '建立连接失败';
        try { p.pc && p.pc.close(); } catch (_) {}
        cleanupAuto(p); renderPeers();
      }
      $('#askMsg').textContent = '建立连接失败：' + (e.message || e);
      $('#askYes').disabled = false;
      $('#askNo').disabled = false;
    }
  }
  function rejectAsk() {
    const m = askOffer;
    askOffer = null;
    $('#askMask').hidden = true;
    if (m) sendSig({ t: 'reject', from: myId, to: m.from });
  }
  async function handleAnswer(m) {
    const p = pendingPeerFor(m.from);
    if (!p || !m.sdp || p.answered) return;
    p.answered = true;
    p.name = String(m.name || p.name).slice(0, 24);
    p.kind = m.kind === 'phone' ? 'phone' : 'pc';
    try {
      await p.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      p.note = '正在建立连接…';
      renderPeers();
    } catch (e) {
      p.state = 'closed'; p.note = '连接失败';
      try { p.pc && p.pc.close(); } catch (_) {}
      renderPeers(); toast('连接失败：' + (e.message || e));
      cleanupAuto(p);
    }
  }
  function handleReject(m) {
    const p = pendingPeerFor(m.from);
    if (!p) return;
    p.state = 'closed'; p.note = '对方拒绝了连接';
    try { p.pc && p.pc.close(); } catch (e) {}
    renderPeers(); toast('对方拒绝了连接');
    cleanupAuto(p);
  }
  function handleBusy(m) {
    const p = pendingPeerFor(m.from);
    if (!p) return;
    p.state = 'closed'; p.note = '对方正忙';
    try { p.pc && p.pc.close(); } catch (e) {}
    renderPeers(); toast('对方正在处理另一个连接');
    cleanupAuto(p);
  }
  $('#askYes').onclick = acceptAsk;
  $('#askNo').onclick = rejectAsk;
  $('#roomBtn').onclick = () => {
    const v = prompt('发现房间：只有同一房间的设备会互相出现（字母、数字、-、_）', NET.room);
    if (v === null) return;
    const r = v.trim();
    if (!roomOk(r)) { toast('房间名只能用字母、数字、- 和 _'); return; }
    store.set('lt_room', r);
    NET.room = r;
    NET.topic = topicFor();
    disc.clear();
    askOffer = null;
    $('#askMask').hidden = true;
    renderPeers();
    if (!NET.scope) startDiscovery(true);
    else restartNet();
  };
  $('#discRetry').onclick = () => {
    for (const c of NET.conns) c.tries = 0;
    if (!NET.enabled) return;
    if (!NET.scope) startDiscovery(true);
    else restartNet();
  };

  /* ---------- 全局：拖拽 / 粘贴 / 退出 ---------- */
  const onlyOpenPeer = () => { const a = [...peers.values()].filter(p => p.state === 'open'); return a.length === 1 ? a[0] : null; };
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    const fs = [...(e.dataTransfer?.files || [])];
    const p = onlyOpenPeer();
    if (fs.length && p) enqueueFiles(p, fs);
  });
  document.addEventListener('paste', e => {
    if (!$('#pairMask').hidden || !$('#textMask').hidden || !$('#askMask').hidden) return;
    const fs = [...(e.clipboardData?.files || [])];
    const p = onlyOpenPeer();
    if (fs.length && p) enqueueFiles(p, fs);
  });
  window.addEventListener('pagehide', () => {
    sendSig({ t: 'bye', id: myId });
    for (const p of peers.values()) { try { p.pc && p.pc.close(); } catch (e) {} }
  });

  renderPeers();
  initNet();
})();

