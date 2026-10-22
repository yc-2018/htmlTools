'use strict';

/* =====================================================================
   状态
   ===================================================================== */
const state = {
  rows: 10,
  cols: 10,
  data: [],                 // 二维字符串数组，data[r][c]
  sel: null,                // {r1,c1,r2,c2}
  anchor: null,             // 拖选起点
  highlight: '',            // 高亮关键词
  align: 'none',
  history: [],
  future: [],
  editing: null             // 当前进入编辑的 {r,c,value}
};

const $ = id => document.getElementById(id);
const el = {
  srcText: $('srcText'), srcLn: $('srcLn'), srcFormat: $('srcFormat'),
  srcCount: $('srcCount'), srcHint: $('srcHint'), srcBody: $('srcBody'),
  fileInput: $('fileInput'), sheetPick: $('sheetPick'), sheetSelect: $('sheetSelect'),
  sheetHead: $('sheetHead'), sheetBody: $('sheetBody'), gridScroll: $('gridScroll'),
  sizeChip: $('sizeChip'), cellPos: $('cellPos'), selInfo: $('selInfo'), gridMsg: $('gridMsg'),
  codeText: $('codeText'), codePre: $('codePre'), codeArea: $('codeArea'),
  outFormat: $('outFormat'), outStat: $('outStat'), previewWrap: $('previewWrap'),
  previewPane: $('previewPane'), outTabs: $('outTabs'), outSettings: $('outSettings'),
  escapeChars: $('escapeChars'), alignSeg: $('alignSeg'),
  optHeader: $('optHeader'), optFormat: $('optFormat'), optCompact: $('optCompact'),
  optBoldRow: $('optBoldRow'), optBoldCol: $('optBoldCol'),
  findInput: $('findInput'), repFind: $('repFind'), repTo: $('repTo'),
  syncText: $('syncText'), toast: $('toast')
};
/* =====================================================================
   工具函数
   ===================================================================== */
const escHtml = s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const colName = i => { let s=''; i++; while(i>0){ const m=(i-1)%26; s=String.fromCharCode(65+m)+s; i=Math.floor((i-1)/26);} return s; };
const isWide = ch => /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch);
const vw = s => { let w=0; for(const ch of String(s)) w += isWide(ch)?2:1; return w; };
const padEnd = (s,n)=>{ const d=n-vw(s); return d>0 ? s+' '.repeat(d) : s; };
function toast(msg){
  el.toast.textContent=msg; el.toast.classList.add('show');
  clearTimeout(toast._t); toast._t=setTimeout(()=>el.toast.classList.remove('show'),1600);
}
function normSel(a,b){
  return { r1: Math.min(a.r,b.r), c1: Math.min(a.c,b.c), r2: Math.max(a.r,b.r), c2: Math.max(a.c,b.c) };
}
function blankGrid(rows,cols){ return Array.from({length:rows},()=>Array(cols).fill('')); }
function cloneGrid(g){ return g.map(r=>r.slice()); }

/* ---------- 历史记录 ---------- */
const MAX_HISTORY = 80;
function snapshot(){
  state.history.push({rows:state.rows, cols:state.cols, data:cloneGrid(state.data)});
  if(state.history.length>MAX_HISTORY) state.history.shift();
  state.future = [];
}
function restore(snap){
  state.rows=snap.rows; state.cols=snap.cols; state.data=cloneGrid(snap.data);
  state.sel=null; renderGrid(); syncExport();
}
function undo(){
  if(!state.history.length){ toast('没有可撤销的操作'); return; }
  state.future.push({rows:state.rows, cols:state.cols, data:cloneGrid(state.data)});
  restore(state.history.pop());
  toast('已撤销');
}
function redo(){
  if(!state.future.length){ toast('没有可重做的操作'); return; }
  state.history.push({rows:state.rows, cols:state.cols, data:cloneGrid(state.data)});
  restore(state.future.pop());
  toast('已重做');
}

/* =====================================================================
   方格渲染
   ===================================================================== */
function renderGrid(){
  const head = ['<th class="corner">#</th>'];
  for(let c=0;c<state.cols;c++) head.push('<th data-col="'+c+'">'+colName(c)+'</th>');
  el.sheetHead.innerHTML = head.join('');

  const rowsHtml = [];
  for(let r=0;r<state.rows;r++){
    const cells=['<th data-row="'+r+'">'+(r+1)+'</th>'];
    for(let c=0;c<state.cols;c++){
      cells.push('<td data-r="'+r+'" data-c="'+c+'"><div class="cell" contenteditable="plaintext-only" tabindex="-1">'
        + escHtml(state.data[r][c]) + '</div></td>');
    }
    rowsHtml.push('<tr>'+cells.join('')+'</tr>');
  }
  el.sheetBody.innerHTML = rowsHtml.join('');
  el.sizeChip.textContent = state.rows+' × '+state.cols;
  el.syncText.textContent = '已同步 · '+state.rows+'×'+state.cols;
  paintSelection();
  applyHighlight();
  syncExport();
}

function cellOf(r,c){ return el.sheetBody.querySelector('td[data-r="'+r+'"][data-c="'+c+'"] .cell'); }

function paintSelection(){
  el.sheetBody.querySelectorAll('td.in-sel').forEach(td=>td.classList.remove('in-sel'));
  el.sheetBody.querySelectorAll('th.row-on').forEach(th=>th.classList.remove('row-on'));
  el.sheetHead.querySelectorAll('th.col-on').forEach(th=>th.classList.remove('col-on'));
  const s=state.sel;
  if(!s){ el.selInfo.textContent='未选择区域'; return; }
  for(let r=s.r1;r<=s.r2;r++){
    for(let c=s.c1;c<=s.c2;c++){
      const td=el.sheetBody.querySelector('td[data-r="'+r+'"][data-c="'+c+'"]');
      if(td) td.classList.add('in-sel');
    }
  }
  if(s.r1===s.r2 && s.c1===s.c2){
    el.selInfo.textContent='已选 '+colName(s.c1)+(s.r1+1);
  } else {
    el.selInfo.textContent='已选 '+colName(s.c1)+(s.r1+1)+':'+colName(s.c2)+(s.r2+1)
      +'（'+(s.r2-s.r1+1)+' 行 × '+(s.c2-s.c1+1)+' 列）';
  }
}
function setSel(a,b){
  state.sel = normSel(a,b||a);
  paintSelection();
}
/* 选区为空时返回整表 */
function activeRange(){
  const s=state.sel;
  if(!s || (s.r1===s.r2 && s.c1===s.c2))
    return {r1:0,c1:0,r2:state.rows-1,c2:state.cols-1};
  return s;
}

/* ---------- 高亮 ---------- */
function applyHighlight(){
  el.sheetBody.querySelectorAll('td.hit').forEach(td=>td.classList.remove('hit'));
  const kw=state.highlight.trim();
  if(!kw) return;
  const low=kw.toLowerCase();
  el.sheetBody.querySelectorAll('.cell').forEach(c=>{
    if(c.textContent.toLowerCase().includes(low)) c.parentElement.classList.add('hit');
  });
}

/* ---------- 单元格编辑 ---------- */
function setCell(r,c,val){
  if(r<0||r>=state.rows||c<0||c>=state.cols) return;
  state.data[r][c]=val;
}
function focusCell(r,c){
  r=Math.max(0,Math.min(state.rows-1,r));
  c=Math.max(0,Math.min(state.cols-1,c));
  const cell=cellOf(r,c);
  if(!cell) return;
  cell.focus();
  el.cellPos.textContent=colName(c)+(r+1);
}

/* 记录编辑前快照：同一个单元格连续输入只记一次 */
let editGuard=null;
el.sheetBody.addEventListener('focusin', e=>{
  const cell=e.target.closest('.cell'); if(!cell) return;
  const td=cell.parentElement, r=+td.dataset.r, c=+td.dataset.c;
  if(!editGuard || editGuard.r!==r || editGuard.c!==c){
    
    editGuard={r,c,snapped:false};
  }
  const a=state.anchor;
  if(!a || !e.shiftKey){ state.anchor={r,c}; setSel({r,c}); }
  el.cellPos.textContent=colName(c)+(r+1);
});
el.sheetBody.addEventListener('focusout', e=>{
  const cell=e.target.closest('.cell'); if(!cell) return;
  state.data[+cell.parentElement.dataset.r][+cell.parentElement.dataset.c]=cell.innerText.replace(/ /g,' ');
  editGuard=null;
  syncExport();
});

el.sheetBody.addEventListener('input', e=>{
  const cell=e.target.closest('.cell'); if(!cell) return;
  const td=cell.parentElement, r=+td.dataset.r, c=+td.dataset.c;
  if(!editGuard || editGuard.r!==r || editGuard.c!==c) editGuard={r,c,snapped:false};
  if(!editGuard.snapped){ snapshot(); editGuard.snapped=true; }
  state.data[r][c]=cell.innerText.replace(/ /g,' ');
  syncExport();
});

/* 键盘：Enter 下移，Shift+Enter 换行，Tab 右移 */
el.sheetBody.addEventListener('keydown', e=>{
  const cell=e.target.closest('.cell'); if(!cell) return;
  const td=cell.parentElement, r=+td.dataset.r, c=+td.dataset.c;
  if(e.key==='Enter' && !e.shiftKey){
    e.preventDefault(); focusCell(r+1,c);
  } else if(e.key==='Tab'){
    e.preventDefault(); focusCell(r, c + (e.shiftKey?-1:1));
  } else if(e.key==='ArrowDown' && !e.altKey && e.ctrlKey){
    e.preventDefault(); focusCell(r+1,c);
  }
});

/* 粘贴矩阵文本：从当前单元格向右下铺开 */
el.sheetBody.addEventListener('paste', e=>{
  const cell=e.target.closest('.cell'); if(!cell) return;
  const text=(e.clipboardData||window.clipboardData).getData('text/plain');
  if(text==null) return;
  if(!/[\t\n]/.test(text)){
    return; // 单格文本交给浏览器默认插入
  }
  e.preventDefault();
  const m=parseDelimited(text,'auto');
  if(!m.length) return;
  const r0=+cell.parentElement.dataset.r, c0=+cell.parentElement.dataset.c;
  snapshot();
  const needR=r0+m.length, needC=c0+Math.max(...m.map(x=>x.length));
  if(needR>state.rows || needC>state.cols) growTo(Math.max(needR,state.rows), Math.max(needC,state.cols), false);
  m.forEach((row,i)=>row.forEach((v,j)=>setCell(r0+i,c0+j,v)));
  refreshCells();
  toast('已粘贴 '+m.length+' 行 × '+Math.max(...m.map(x=>x.length))+' 列');
});

/* 只刷新已有表格的文本，不重建 DOM，避免打断输入 */
function refreshCells(){
  el.sheetBody.querySelectorAll('td[data-r]').forEach(td=>{
    const r=+td.dataset.r, c=+td.dataset.c;
    const cell=td.firstElementChild;
    if(document.activeElement!==cell) cell.textContent=state.data[r][c];
  });
  applyHighlight(); syncExport();
}

function growTo(rows,cols,withSnapshot){
  if(rows===state.rows && cols===state.cols) return;
  if(withSnapshot!==false) snapshot();
  const next=blankGrid(rows,cols);
  for(let r=0;r<Math.min(rows,state.rows);r++)
    for(let c=0;c<Math.min(cols,state.cols);c++) next[r][c]=state.data[r][c];
  state.rows=rows; state.cols=cols; state.data=next;
  state.sel=null; renderGrid();
}

/* =====================================================================
   解析：TSV / CSV
   ===================================================================== */
function detectDelimiter(text){
  const sample=text.split(/\r?\n/).slice(0,8).join('\n');
  const counts={'\t':(sample.match(/\t/g)||[]).length, ',':(sample.match(/,/g)||[]).length, ';':(sample.match(/;/g)||[]).length};
  if(counts['\t']) return '\t';
  if(counts[',']>=counts[';']) return ',';
  return ';';
}
function parseDelimited(text, fmt){
  const delim = fmt==='tsv' ? '\t' : fmt==='csv' ? detectDelimiter(text) : detectDelimiter(text);
  const rows=[]; let row=[], field='', inQ=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(inQ){
      if(ch==='"'){
        if(text[i+1]==='"'){ field+='"'; i++; }
        else inQ=false;
      } else field+=ch;
      continue;
    }
    if(ch==='"' && field===''){ inQ=true; continue; }
    if(ch===delim){ row.push(field); field=''; continue; }
    if(ch==='\r') continue;
    if(ch==='\n'){ row.push(field); rows.push(row); row=[]; field=''; continue; }
    field+=ch;
  }
  row.push(field);
  if(row.length>1 || row[0]!=='' || rows.length===0) rows.push(row);
  // 去掉末尾因换行产生的空行
  while(rows.length && rows[rows.length-1].every(v=>v==='')) rows.pop();
  const width=Math.max(0,...rows.map(r=>r.length));
  return rows.map(r=>{ while(r.length<width) r.push(''); return r; });
}

/* =====================================================================
   解析：Markdown 表格
   ===================================================================== */
function parseMarkdownTable(text){
  const lines=text.split(/\r?\n/).filter(l=>l.includes('|'));
  if(!lines.length) return [];
  const splitLine=line=>{
    let s=line.trim();
    if(s.startsWith('|')) s=s.slice(1);
    if(s.endsWith('|') && !s.endsWith('\\|')) s=s.slice(0,-1);
    const out=[]; let cur='';
    for(let i=0;i<s.length;i++){
      if(s[i]==='\\' && s[i+1]==='|'){ cur+='|'; i++; continue; }
      if(s[i]==='|'){ out.push(cur.trim()); cur=''; continue; }
      cur+=s[i];
    }
    out.push(cur.trim().replace(/<br\s*\/?>/gi,'\n'));
    return out;
  };
  const isSep=row=>row.every(c=>/^:?-{1,}:?$/.test(c.replace(/\s/g,'')));
  const table=lines.map(splitLine).filter(r=>!isSep(r));
  return table;
}

/* =====================================================================
   解析：HTML 表格
   ===================================================================== */
function parseHtmlTable(text){
  const doc=new DOMParser().parseFromString(text,'text/html');
  const tables=[...doc.querySelectorAll('table')];
  if(!tables.length) return [];
  // 选行数最多的那张表
  const table=tables.sort((a,b)=>b.rows.length-a.rows.length)[0];
  const rows=[];
  for(const tr of table.rows){
    const row=[];
    for(const cell of tr.cells){
      let v=cell.textContent.replace(/ /g,' ').replace(/\s*\n\s*/g,' ').trim();
      const span=Math.min(cell.colSpan||1, 40);
      row.push(v);
      for(let k=1;k<span;k++) row.push('');
    }
    rows.push(row);
  }
  const width=Math.max(0,...rows.map(r=>r.length));
  return rows.map(r=>{ while(r.length<width) r.push(''); return r; });
}

/* 自动识别 */
function parseAny(text){
  const trimmed=text.trim();
  if(!trimmed) return [];
  const fmt=el.srcFormat.value;
  if(fmt==='md') return parseMarkdownTable(text);
  if(fmt==='html') return parseHtmlTable(text);
  if(fmt==='tsv' || fmt==='csv') return parseDelimited(text,fmt);
  if(/^<(table|tbody|tr|thead)[\s>]/i.test(trimmed) || /<table[\s>]/i.test(trimmed)) return parseHtmlTable(text);
  const mdLines=trimmed.split('\n').filter(l=>l.trim());
  const pipeLines=mdLines.filter(l=>/^\s*\|.*\|\s*$/.test(l)).length;
  const hasSep=mdLines.some(l=>/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l));
  if(hasSep || (pipeLines>=2 && pipeLines>=mdLines.length*0.6)) return parseMarkdownTable(text);
  return parseDelimited(text,'auto');
}

/* =====================================================================
   解析：xlsx（原生解析 ZIP，不依赖第三方库）
   ===================================================================== */
async function unzip(buf){
  const u8=new Uint8Array(buf), dv=new DataView(buf);
  // 找 End Of Central Directory
  let eocd=-1;
  for(let i=u8.length-22;i>=Math.max(0,u8.length-65558);i--){
    if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; }
  }
  if(eocd<0) throw new Error('不是有效的 xlsx（ZIP）文件');
  const count=dv.getUint16(eocd+10,true);
  let p=dv.getUint32(eocd+16,true);
  const files=[];
  for(let k=0;k<count;k++){
    if(dv.getUint32(p,true)!==0x02014b50) break;
    const method=dv.getUint16(p+10,true);
    const csize=dv.getUint32(p+20,true);
    const nameLen=dv.getUint16(p+28,true);
    const extraLen=dv.getUint16(p+30,true);
    const commentLen=dv.getUint16(p+32,true);
    const offset=dv.getUint32(p+42,true);
    const name=new TextDecoder().decode(u8.subarray(p+46,p+46+nameLen));
    files.push({name,method,csize,offset});
    p+=46+nameLen+extraLen+commentLen;
  }
  async function read(name){
    const f=files.find(x=>x.name===name) || files.find(x=>x.name.endsWith('/'+name));
    if(!f) return null;
    if(dv.getUint32(f.offset,true)!==0x04034b50) return null;
    const nameLen=dv.getUint16(f.offset+26,true);
    const extraLen=dv.getUint16(f.offset+28,true);
    const start=f.offset+30+nameLen+extraLen;
    const raw=u8.subarray(start,start+f.csize);
    if(f.method===0) return new TextDecoder().decode(raw);
    if(typeof DecompressionStream==='undefined')
      throw new Error('当前浏览器不支持解压 xlsx，请换用新版 Chrome/Edge，或先另存为 CSV');
    const ds=new DecompressionStream('deflate-raw');
    const stream=new Blob([raw]).stream().pipeThrough(ds);
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }
  return {files,read};
}

const txtOf = n => n ? n.textContent : '';
function colToIndex(ref){
  const m=/^([A-Z]+)/.exec(ref); if(!m) return 0;
  let n=0; for(const ch of m[1]) n=n*26+(ch.charCodeAt(0)-64);
  return n-1;
}
const REL_NS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
function sheetFileOf(target){
  if(!target) return '';
  let p=target.replace(/\\/g,'/');
  if(p.startsWith('/')) p=p.slice(1);
  else if(!p.startsWith('xl/')) p='xl/'+p;
  return /^xl\/worksheets\/[^/]+\.xml$/i.test(p) ? p : '';
}
async function parseXlsx(file){
  const zip=await unzip(await file.arrayBuffer());
  const sharedXml=await zip.read('xl/sharedStrings.xml');
  let shared=[];
  if(sharedXml){
    const doc=new DOMParser().parseFromString(sharedXml,'application/xml');
    shared=[...doc.getElementsByTagName('si')].map(si=>
      [...si.getElementsByTagName('t')].map(txtOf).join('')
    );
  }
  const sheetFiles=zip.files.map(f=>f.name).filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if(!sheetFiles.length) throw new Error('xlsx 中没有找到工作表');

  const relMap={};
  const relsXml=await zip.read('xl/_rels/workbook.xml.rels');
  if(relsXml){
    const doc=new DOMParser().parseFromString(relsXml,'application/xml');
    for(const rel of doc.getElementsByTagName('Relationship')){
      const id=rel.getAttribute('Id');
      const path=sheetFileOf(rel.getAttribute('Target'));
      if(id && path) relMap[id]=path;
    }
  }
  const sheets=[];
  const wbXml=await zip.read('xl/workbook.xml');
  if(wbXml){
    const doc=new DOMParser().parseFromString(wbXml,'application/xml');
    for(const s of doc.getElementsByTagName('sheet')){
      const rid=s.getAttribute('r:id') || s.getAttributeNS(REL_NS,'id');
      const path=relMap[rid];
      if(!path) continue;
      const hideState=s.getAttribute('state');
      sheets.push({
        name:s.getAttribute('name') || ('Sheet'+(sheets.length+1)),
        path,
        hidden:hideState==='hidden' || hideState==='veryHidden'
      });
    }
  }
  if(!sheets.length){
    sheetFiles
      .slice()
      .sort((a,b)=>Number(/(\d+)\.xml$/.exec(a)[1])-Number(/(\d+)\.xml$/.exec(b)[1]))
      .forEach((path,i)=>sheets.push({name:'Sheet'+(i+1), path, hidden:false}));
  }

  async function readSheet(index){
    const sheet=sheets[index];
    const sheetXml=await zip.read(sheet.path);
    if(!sheetXml) throw new Error('读取工作表「'+sheet.name+'」失败');
    const doc=new DOMParser().parseFromString(sheetXml,'application/xml');
    const rows=[];
    for(const row of doc.getElementsByTagName('row')){
      const r=parseInt(row.getAttribute('r')||'0',10)-1;
      const arr=[];
      let cursor=0;
      for(const cell of row.getElementsByTagName('c')){
        const ref=cell.getAttribute('r');
        const c=ref ? colToIndex(ref) : cursor;
        cursor=c+1;
        const t=cell.getAttribute('t');
        let v='';
        if(t==='inlineStr'){
          v=[...cell.getElementsByTagName('t')].map(txtOf).join('');
        } else {
          const vs=cell.getElementsByTagName('v')[0];
          const raw=vs?txtOf(vs):'';
          if(t==='s') v=shared[+raw] ?? '';
          else if(t==='b') v=raw==='1'?'TRUE':'FALSE';
          else v=raw;
        }
        arr[c]=v;
      }
      if(Number.isFinite(r)) rows[r]=arr;
    }
    const grid=Array.from(rows,r=>{ r=r||[]; const out=[]; for(let i=0;i<r.length;i++) out[i]=r[i]==null?'':String(r[i]); return out; });
    const width=Math.max(0,...grid.map(r=>r.length));
    return grid.map(r=>{ while(r.length<width) r.push(''); return r; });
  }
  return {sheets, readSheet, fileName:file.name};
}

/* =====================================================================
   输出：Markdown
   ===================================================================== */
function escapeCell(text){
  const chars=[...new Set(el.escapeChars.value.split(''))];
  let s=String(text).replace(/\r\n?/g,'\n').trim();
  if(chars.length){
    let out='';
    for(let i=0;i<s.length;i++){
      const ch=s[i];
      if(ch!=='\n' && chars.includes(ch) && s[i-1]!=='\\') out+='\\';
      out+=ch;
    }
    s=out;
  }
  return s.replace(/\n/g,'<br>');
}
function outputSize(){
  let lastR=-1,lastC=-1;
  for(let r=0;r<state.rows;r++) for(let c=0;c<state.cols;c++){
    if(state.data[r][c].trim()!==''){ lastR=Math.max(lastR,r); lastC=Math.max(lastC,c); }
  }
  return {rows:lastR+1, cols:lastC+1};
}
function buildMarkdown(){
  const {rows,cols}=outputSize();
  if(!rows || !cols) return '';
  const fmt=el.optFormat.checked, compact=el.optCompact.checked;
  const header=el.optHeader.checked;
  const boldRow=el.optBoldRow.checked, boldCol=el.optBoldCol.checked;
  const align=state.align;

  const cells=[];
  for(let r=0;r<rows;r++){
    const row=[];
    for(let c=0;c<cols;c++){
      let v=escapeCell(state.data[r][c]);
      if((boldRow && r===0) || (boldCol && c===0)) v = v ? '**'+v+'**' : '****';
      row.push(v);
    }
    cells.push(row);
  }
  const widths=[];
  for(let c=0;c<cols;c++){
    let w=3;
    for(let r=0;r<rows;r++) w=Math.max(w,vw(cells[r][c]));
    widths.push(w);
  }
  const sepFor = w => {
    const min=Math.max(3,w);
    if(align==='center') return ':'+'-'.repeat(Math.max(1,min-2))+':';
    if(align==='right') return '-'.repeat(Math.max(2,min-1))+':';
    if(align==='left') return ':'+'-'.repeat(Math.max(1,min-1));
    return '-'.repeat(min);
  };

  const line = arr => {
    const body = arr.map((v,i)=> fmt ? padEnd(v,widths[i]) : v).join(' | ');
    return compact ? body : '| '+body+' |';
  };
  const lines=[];
  if(!header){
    lines.push(line(Array(cols).fill('')));
    lines.push(line(Array.from({length:cols},(_,i)=>sepFor(widths[i]))));
  }
  for(let r=0;r<rows;r++){
    lines.push(line(cells[r]));
    if(r===0 && header) lines.push(line(Array.from({length:cols},(_,i)=>sepFor(widths[i]))));
  }
  return lines.join('\n');
}

/* ---------- TSV / CSV / HTML ---------- */
function csvCell(v, delim){
  const s=String(v);
  if(/["\n\r\t]/.test(s) || s.includes(delim)) return '"'+s.replace(/"/g,'""')+'"';
  return s;
}
function buildDelimited(fmt){
  const {rows,cols}=outputSize();
  if(!rows||!cols) return '';
  const delim=fmt==='csv'?',':'\t';
  const out=[];
  for(let r=0;r<rows;r++){
    const arr=[];
    for(let c=0;c<cols;c++) arr.push(csvCell(state.data[r][c],delim));
    out.push(arr.join(delim));
  }
  return out.join('\n');
}
function buildHtml(){
  const {rows,cols}=outputSize();
  if(!rows||!cols) return '';
  const header=el.optHeader.checked;
  const out=['<table>'];
  for(let r=0;r<rows;r++){
    const tagname=(r===0&&header)?'th':'td';
    out.push('  <tr>');
    for(let c=0;c<cols;c++) out.push('    <'+tagname+'>'+escHtml(state.data[r][c]).replace(/\n/g,'<br>')+'</'+tagname+'>');
    out.push('  </tr>');
  }
  out.push('</table>');
  return out.join('\n');
}
function buildOutput(){
  const f=el.outFormat.value;
  if(f==='tsv') return buildDelimited('tsv');
  if(f==='csv') return buildDelimited('csv');
  if(f==='html') return buildHtml();
  return buildMarkdown();
}

/* =====================================================================
   导出区同步
   ===================================================================== */
let syncing=false;
/* 只显示当前格式真正生效的输出设置 */
function updateOutSettings(){
  const fmt=el.outFormat.value;
  let any=false;
  el.outSettings.querySelectorAll('[data-formats]').forEach(node=>{
    const show=node.dataset.formats.split(' ').includes(fmt);
    node.hidden=!show;
    if(show) any=true;
  });
  el.outSettings.classList.toggle('hidden', !any);
  el.outSettings.classList.toggle('slim', fmt==='html');
}
function syncExport(){
  if(syncing) return;
  syncing=true;
  updateOutSettings();
  const text=buildOutput();
  el.codeText.value=text;
  el.codePre.innerHTML=highlightCode(text, el.outFormat.value);
  el.codeText.scrollTop=0; el.codeText.scrollLeft=0;
  syncCodeScroll();
  const {rows,cols}=outputSize();
  el.outStat.textContent=rows+' 行 × '+cols+' 列 · '+text.length+' 字符';
  el.srcCount.textContent=el.srcText.value.split('\n').length+' 行';
  renderPreview();
  syncing=false;
}
function highlightCode(text, fmt){
  if(fmt!=='md') return escHtml(text);
  return text.split('\n').map(line=>{
    let html='';
    let inCode=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='\\'){ html+=escHtml(ch+(line[i+1]||'')); i++; continue; }
      if(ch==='|'){ html+='<span class="tok-pipe">|</span>'; continue; }
      html+=escHtml(ch);
    }
    if(/^\s*\|?\s*:?-{1,}:?/.test(line) || /^\s*[-:]+(\s*\|\s*[-:]+)+/.test(line))
      return '<span class="tok-dash">'+html+'</span>';
    return html;
  }).join('\n');
}
function renderPreview(){
  const fmt=el.outFormat.value;
  if(fmt==='tsv'||fmt==='csv'){
    el.previewWrap.innerHTML='<div class="preview-empty">TSV / CSV 为纯文本，暂无渲染预览</div>';
    return;
  }
  const {rows,cols}=outputSize();
  if(!rows||!cols){ el.previewWrap.innerHTML='<div class="preview-empty">方格为空</div>'; return; }
  if(fmt==='html'){
    el.previewWrap.innerHTML=buildHtml();
    return;
  }
  // 从状态直接生成预览表格（比解析 Markdown 更可靠）
  const boldRow=el.optBoldRow.checked, boldCol=el.optBoldCol.checked;
  const header=el.optHeader.checked;
  const al=state.align;
  const alignCss = al==='center'?'center':al==='right'?'right':al==='left'?'left':'';
  let html='<table>';
  for(let r=0;r<rows;r++){
    html+='<tr>';
    for(let c=0;c<cols;c++){
      const tag=(r===0&&header)?'th':'td';
      const bold=(boldRow&&r===0)||(boldCol&&c===0);
      const style=(alignCss?'text-align:'+alignCss+';':'')+(bold?'font-weight:700;':'');
      html+='<'+tag+(style?' style="'+style+'"':'')+'>'+escHtml(state.data[r][c]).replace(/\n/g,'<br>')+'</'+tag+'>';
    }
    html+='</tr>';
  }
  html+='</table>';
  el.previewWrap.innerHTML=html;
}

/* =====================================================================
   复制与下载
   ===================================================================== */
const EXT={md:'md',tsv:'tsv',csv:'csv',html:'html'};
function stamp(){
  const d=new Date(), p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());
}
async function copyOutput(){
  const text=el.codeText.value;
  if(!text){ toast('没有可复制的内容'); return; }
  try{
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板');
  }catch(e){
    el.codeText.select();
    document.execCommand('copy');
    toast('已复制到剪贴板');
  }
}
function downloadOutput(){
  const text=el.codeText.value;
  if(!text){ toast('没有可下载的内容'); return; }
  const fmt=el.outFormat.value;
  const blob=new Blob([text],{type:'text/plain;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='table-'+stamp()+'.'+EXT[fmt];
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  toast('已下载 '+a.download);
}

/* =====================================================================
   鼠标选择
   ===================================================================== */
/* 点单元格内任意位置都能选中：以 td 为命中目标，而不是只认文字所在的 .cell */
let dragSel=false;
el.sheetBody.addEventListener('pointerdown', e=>{
  const td=e.target.closest('td[data-r]'); if(!td) return;
  const r=+td.dataset.r, c=+td.dataset.c;
  const cell=td.querySelector('.cell');
  if(e.shiftKey && state.anchor){
    e.preventDefault();
    setSel(state.anchor,{r,c});
    dragSel=true;
    return;
  }
  state.anchor={r,c};
  setSel({r,c});
  if(cell && !e.target.closest('.cell')) cell.focus();
  dragSel=true;
});
window.addEventListener('pointerup', ()=>{ dragSel=false; });
window.addEventListener('pointercancel', ()=>{ dragSel=false; });
/* 拖拽扩选：用坐标命中，鼠标移出单元格/文字区也能继续选 */
window.addEventListener('pointermove', e=>{
  if(!dragSel || !state.anchor) return;
  const node=document.elementFromPoint(e.clientX,e.clientY);
  const td=node && node.closest ? node.closest('td[data-r]') : null;
  if(td) setSel(state.anchor,{r:+td.dataset.r,c:+td.dataset.c});
});

/* 行号 / 列标：按下即选中，拖动可连续多选 */
let headerDrag=null;
function headerHit(x,y){
  const node=document.elementFromPoint(x,y); if(!node) return null;
  const th=node.closest('th[data-row],th[data-col]'); if(!th) return null;
  if(th.dataset.row!==undefined) return {type:'row', i:+th.dataset.row};
  return {type:'col', i:+th.dataset.col};
}
function applyHeaderDrag(i){
  if(!headerDrag) return;
  headerDrag.last=i;
  if(headerDrag.type==='row'){
    const r1=Math.min(headerDrag.start,i), r2=Math.max(headerDrag.start,i);
    state.anchor={r:headerDrag.start,c:0};
    setSel({r:r1,c:0},{r:r2,c:state.cols-1});
    el.sheetBody.querySelectorAll('th.row-on').forEach(th=>th.classList.remove('row-on'));
    for(let r=r1;r<=r2;r++){
      const th=el.sheetBody.querySelector('th[data-row="'+r+'"]');
      if(th) th.classList.add('row-on');
    }
  } else {
    const c1=Math.min(headerDrag.start,i), c2=Math.max(headerDrag.start,i);
    state.anchor={r:0,c:headerDrag.start};
    setSel({r:0,c:c1},{r:state.rows-1,c:c2});
    el.sheetHead.querySelectorAll('th.col-on').forEach(th=>th.classList.remove('col-on'));
    for(let c=c1;c<=c2;c++){
      const th=el.sheetHead.querySelector('th[data-col="'+c+'"]');
      if(th) th.classList.add('col-on');
    }
  }
}
function startHeaderDrag(e,type,i){
  e.preventDefault();
  headerDrag={type,start:i,last:i};
  applyHeaderDrag(i);
  document.body.classList.add('header-drag');
}
el.sheetBody.addEventListener('pointerdown', e=>{
  const th=e.target.closest('th[data-row]'); if(!th) return;
  startHeaderDrag(e,'row',+th.dataset.row);
});
el.sheetHead.addEventListener('pointerdown', e=>{
  const th=e.target.closest('th[data-col]'); if(!th) return;
  startHeaderDrag(e,'col',+th.dataset.col);
});
window.addEventListener('pointermove', e=>{
  if(!headerDrag) return;
  const hit=headerHit(e.clientX,e.clientY);
  if(hit && hit.type===headerDrag.type) applyHeaderDrag(hit.i);
});
window.addEventListener('pointerup', ()=>{
  if(!headerDrag) return;
  headerDrag=null;
  document.body.classList.remove('header-drag');
});

/* =====================================================================
   工具栏
   ===================================================================== */
function forRange(fn){
  const s=activeRange();
  snapshot();
  for(let r=s.r1;r<=s.r2;r++) for(let c=s.c1;c<=s.c2;c++) fn(state.data,r,c);
  refreshCells();
}
function selectionOrAllMsg(){
  const s=state.sel;
  return (s && !(s.r1===s.r2 && s.c1===s.c2)) ? '选区' : '全表';
}
$('btnTrim').addEventListener('click', ()=>{
  const keepR=[], keepC=[];
  for(let r=0;r<state.rows;r++) if(state.data[r].some(v=>v.trim()!=='')) keepR.push(r);
  for(let c=0;c<state.cols;c++) if(state.data.some(row=>row[c].trim()!=='')) keepC.push(c);
  if(!keepR.length){ toast('全是空白，无需删除'); return; }
  if(keepR.length===state.rows && keepC.length===state.cols){ toast('没有空白行列'); return; }
  const removed=(state.rows-keepR.length)+(state.cols-keepC.length);
  snapshot();
  const next=keepR.map(r=>keepC.map(c=>state.data[r][c]));
  state.rows=next.length; state.cols=next[0].length; state.data=next;
  state.sel=null; renderGrid();
  toast('已删除 '+removed+' 个空白行/列 → '+state.rows+' × '+state.cols);
});

$('btnUndo').addEventListener('click', undo);
$('btnRedo').addEventListener('click', redo);

$('btnClearGrid').addEventListener('click', ()=>{
  if(!state.data.some(r=>r.some(v=>v.trim()!==''))){ toast('方格已经是空的'); return; }
  snapshot();
  state.data=blankGrid(state.rows,state.cols);
  state.sel=null; renderGrid(); toast('已清空内容');
});

$('btnUpper').addEventListener('click', ()=>{
  forRange((d,r,c)=>{ d[r][c]=d[r][c].toLocaleUpperCase(); });
  toast('已转大写（'+selectionOrAllMsg()+'）');
});
$('btnLower').addEventListener('click', ()=>{
  forRange((d,r,c)=>{ d[r][c]=d[r][c].toLocaleLowerCase(); });
  toast('已转小写（'+selectionOrAllMsg()+'）');
});

$('btnTranspose').addEventListener('click', ()=>{
  snapshot();
  const next=blankGrid(state.cols,state.rows);
  for(let r=0;r<state.rows;r++) for(let c=0;c<state.cols;c++) next[c][r]=state.data[r][c];
  state.rows=next.length; state.cols=next[0]?next[0].length:0;
  state.data=next; state.sel=null; renderGrid();
  toast('已转置 → '+state.rows+' × '+state.cols);
});

/* 查找高亮 */
function doFind(){
  state.highlight=el.findInput.value;
  applyHighlight();
  const n=el.sheetBody.querySelectorAll('td.hit').length;
  el.gridMsg.textContent=state.highlight.trim()? (n? n+' 处匹配':'无匹配') : '';
}
$('btnFind').addEventListener('click', doFind);
el.findInput.addEventListener('input', doFind);
el.findInput.addEventListener('keydown', e=>{ if(e.key==='Enter') doFind(); });

/* 搜索替换 */
$('btnReplace').addEventListener('click', ()=>{
  const kw=el.repFind.value, to=el.repTo.value;
  if(!kw){ toast('请先输入关键词'); el.repFind.focus(); return; }
  const s=activeRange();
  let n=0;
  snapshot();
  for(let r=s.r1;r<=s.r2;r++) for(let c=s.c1;c<=s.c2;c++){
    const v=state.data[r][c];
    if(v.includes(kw)){ const parts=v.split(kw); n+=parts.length-1; state.data[r][c]=parts.join(to); }
  }
  refreshCells();
  toast(n? '已替换 '+n+' 处（'+selectionOrAllMsg()+'）' : '没有找到「'+kw+'」');
});

/* =====================================================================
   数据源
   ===================================================================== */
function updateLineNumbers(){
  const lines=el.srcText.value.split('\n').length;
  let out='';
  for(let i=1;i<=lines;i++) out+=i+'\n';
  el.srcLn.textContent=out.trimEnd();
  el.srcLn.scrollTop=el.srcText.scrollTop;
  el.srcCount.textContent=lines+' 行';
  el.syncText.textContent='已同步 · '+state.rows+'×'+state.cols;
}
el.srcText.addEventListener('input', updateLineNumbers);
el.srcText.addEventListener('scroll', ()=>{ el.srcLn.scrollTop=el.srcText.scrollTop; });

const SAMPLE = [
  '数据库字段名称\t字段位置\t表现形式\t字段类型\t显示顺序\t所属分组',
  '流程编号\tFlowNum\t主表\t单行文本框\t文本\t0',
  '发起人\tInitiator\t主表\t浏览按钮\t人力资源\t1',
  '发起时间\tStartTime\t主表\t浏览按钮\t日期\t2',
  '发起仓位\tForgName\t主表\t浏览按钮\t自定义单选\t3',
  '年度计划车辆数\tAnnualPlanNumber\t主表\t单行文本框\t文本\t4',
  '现有车辆数\tExistingNumber\t主表\t单行文本框\t文本\t5'
].join('\n');

$('btnSample').addEventListener('click', ()=>{
  if(el.srcText.value.trim() && !confirm('用示例数据覆盖当前文本？')) return;
  el.srcText.value=SAMPLE;
  updateLineNumbers();
  el.srcFormat.value='auto';
  ingest(el.srcText.value, '示例数据');
});
$('btnClearSrc').addEventListener('click', ()=>{
  el.srcText.value=''; updateLineNumbers(); el.srcHint.textContent='已清空文本，方格内容保留。';
});
$('btnParse').addEventListener('click', ()=>{
  if(!el.srcText.value.trim()){ toast('请先粘贴或导入数据'); el.srcText.focus(); return; }
  ingest(el.srcText.value, '文本');
});

/* 将二维数组写入方格 */
function loadMatrix(matrix, sourceLabel){
  if(!matrix.length || !matrix[0].length){ toast('没有解析到表格数据'); return; }
  snapshot();
  const rows=Math.max(3,matrix.length), cols=Math.max(3,Math.max(...matrix.map(r=>r.length)));
  state.rows=rows; state.cols=cols;
  state.data=blankGrid(rows,cols);
  for(let r=0;r<matrix.length;r++)
    for(let c=0;c<matrix[r].length;c++) state.data[r][c]=matrix[r][c];
  state.sel=null;
  renderGrid();
  el.gridMsg.textContent='';
  toast('已载入 '+matrix.length+' 行 × '+Math.max(...matrix.map(r=>r.length))+' 列（'+sourceLabel+'）');
}
function ingest(text, label){
  xlsxBook=null;
  setSheetPicker(null);
  try{
    loadMatrix(parseAny(text), label+'解析');
  }catch(err){
    console.error(err);
    alert('解析失败：'+err.message);
  }
}

/* 导入文件（xlsx 支持多工作表切换） */
let xlsxBook=null;
function setSheetPicker(book){
  const multi=!!book && book.sheets.length>1;
  el.sheetPick.classList.toggle('hidden', !multi);
  el.sheetSelect.innerHTML='';
  if(!book) return;
  book.sheets.forEach((s,i)=>{
    const opt=document.createElement('option');
    opt.value=String(i);
    opt.textContent=(i+1)+'. '+s.name+(s.hidden?'（隐藏）':'');
    el.sheetSelect.appendChild(opt);
  });
}
async function loadXlsxSheet(index){
  const book=xlsxBook;
  const sheet=book && book.sheets[index];
  if(!sheet) return;
  el.sheetSelect.value=String(index);
  el.srcHint.textContent='正在读取工作表「'+sheet.name+'」…';
  try{
    const matrix=await book.readSheet(index);
    el.srcHint.textContent='已导入 '+book.fileName+' · 工作表「'+sheet.name+'」（共 '+book.sheets.length+' 个）';
    loadMatrix(matrix,'xlsx · '+sheet.name);
  }catch(err){
    console.error(err);
    alert('读取工作表失败：'+err.message);
    el.srcHint.textContent='读取工作表「'+sheet.name+'」失败';
  }
}
el.sheetSelect.addEventListener('change', ()=>{
  loadXlsxSheet(Number(el.sheetSelect.value));
});
$('btnImport').addEventListener('click', ()=>el.fileInput.click());
el.fileInput.addEventListener('change', ()=>{
  const f=el.fileInput.files[0];
  if(f) handleFile(f);
  el.fileInput.value='';
});
async function handleFile(file){
  const name=file.name.toLowerCase();
  try{
    if(name.endsWith('.xlsx')){
      el.srcHint.textContent='正在解析 '+file.name+' …';
      const book=await parseXlsx(file);
      xlsxBook=book;
      setSheetPicker(book);
      await loadXlsxSheet(0);
      return;
    }
    xlsxBook=null;
    setSheetPicker(null);
    const text=await file.text();
    el.srcText.value=text;
    updateLineNumbers();
    if(name.endsWith('.md')||name.endsWith('.markdown')) el.srcFormat.value='md';
    else if(name.endsWith('.html')||name.endsWith('.htm')) el.srcFormat.value='html';
    else if(name.endsWith('.csv')) el.srcFormat.value='csv';
    else if(name.endsWith('.tsv')) el.srcFormat.value='tsv';
    else el.srcFormat.value='auto';
    el.srcHint.textContent='已导入 '+file.name+'，点击「转为表格」或直接编辑文本。';
    ingest(text, file.name);
  }catch(err){
    console.error(err);
    alert('导入失败：'+err.message);
  }
}

/* 拖拽文件到面板 */
[el.srcBody, $('panel-src')].forEach(zone=>{
  zone.addEventListener('dragover', e=>{ e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', ()=>zone.classList.remove('dragover'));
  zone.addEventListener('drop', e=>{
    e.preventDefault(); zone.classList.remove('dragover');
    const f=[...(e.dataTransfer.files||[])][0];
    if(f) handleFile(f);
  });
});

/* =====================================================================
   面板拖拽调高
   ===================================================================== */
let resizeCtx=null;
let resizeRaf=0;
function applyPanelHeight(){
  const ctx=resizeCtx; if(!ctx) return;
  const h=Math.max(150, ctx.startH + (ctx.lastY-ctx.startY) + ctx.extra);
  if(ctx.important){
    ctx.panel.style.setProperty('flex','0 0 '+h+'px','important');
    ctx.panel.style.setProperty('height',h+'px','important');
  } else {
    ctx.panel.style.flex='0 0 '+h+'px';
  }
}
/* 拖到视口底部时自动滚屏，让贴底的拖拽条能继续向下拉 */
function resizeAutoScroll(ts){
  const ctx=resizeCtx; if(!ctx) return;
  if(ctx.lastY > window.innerHeight-32){
    const dt=ctx.lastTs ? Math.min(50, ts-ctx.lastTs) : 0;
    ctx.lastTs=ts;
    const grow=Math.round(dt*0.35);
    if(grow){
      ctx.extra+=grow;
      applyPanelHeight();
      window.scrollBy(0,grow);
    }
  } else {
    ctx.lastTs=0;
  }
  resizeRaf=requestAnimationFrame(resizeAutoScroll);
}
document.querySelectorAll('.grip').forEach(grip=>{
  const panel=$(grip.dataset.resize);
  if(!panel) return;
  const defaultFlex=panel.style.flex;
  grip.addEventListener('pointerdown', e=>{
    if(e.target.closest('.grip-btn')) return;
    e.preventDefault();
    resizeCtx={panel, startY:e.clientY, lastY:e.clientY, extra:0,
      startH:panel.getBoundingClientRect().height,
      important: window.matchMedia('(max-height:820px) and (min-width:981px)').matches};
    document.body.classList.add('resizing');
    grip.setPointerCapture(e.pointerId);
    resizeRaf=requestAnimationFrame(resizeAutoScroll);
  });
  grip.querySelector('[data-grip-reset]').addEventListener('click', ()=>{
    panel.style.removeProperty('height');
    panel.style.flex=defaultFlex;
  });
  grip.querySelector('[data-grip-expand]').addEventListener('click', ()=>{
    setPanelHeight(panel, Math.max(240, Math.round(window.innerHeight-96)));
    panel.scrollIntoView({behavior:'smooth',block:'start'});
  });
});
window.addEventListener('pointermove', e=>{
  if(!resizeCtx) return;
  resizeCtx.lastY=e.clientY;
  applyPanelHeight();
});
window.addEventListener('pointerup', endResize);
window.addEventListener('pointercancel', endResize);
window.addEventListener('blur', endResize);
function endResize(){
  if(!resizeCtx) return;
  resizeCtx=null;
  cancelAnimationFrame(resizeRaf);
  document.body.classList.remove('resizing');
}

function setPanelHeight(panel, h){
  const important=window.matchMedia('(max-height:820px) and (min-width:981px)').matches;
  if(important){
    panel.style.setProperty('flex','0 0 '+h+'px','important');
    panel.style.setProperty('height',h+'px','important');
  } else {
    panel.style.flex='0 0 '+h+'px';
    panel.style.removeProperty('height');
  }
}

/* =====================================================================
   导出设置
   ===================================================================== */
el.outFormat.addEventListener('change', syncExport);
el.escapeChars.addEventListener('input', syncExport);
[el.optHeader,el.optFormat,el.optCompact,el.optBoldRow,el.optBoldCol].forEach(cb=>{
  cb.addEventListener('change', syncExport);
});
el.alignSeg.addEventListener('click', e=>{
  const b=e.target.closest('button[data-align]'); if(!b) return;
  state.align=b.dataset.align;
  [...el.alignSeg.children].forEach(x=>x.classList.toggle('on', x===b));
  syncExport();
});
function syncCodeScroll(){
  el.codePre.style.transform='translate('+(-el.codeText.scrollLeft)+'px,'+(-el.codeText.scrollTop)+'px)';
}
el.codeText.addEventListener('scroll', syncCodeScroll);
el.codeText.addEventListener('input', ()=>{
  el.codePre.innerHTML=highlightCode(el.codeText.value, el.outFormat.value);
  el.outStat.textContent=el.codeText.value.length+' 字符（手动编辑）';
});

/* 导出区：代码 / 渲染预览 切换 */
function setOutPane(pane){
  const preview=pane==='preview';
  el.codeArea.classList.toggle('hidden', preview);
  el.previewPane.classList.toggle('hidden', !preview);
  [...el.outTabs.querySelectorAll('button')].forEach(b=>{
    b.classList.toggle('on', b.dataset.pane===pane);
  });
  if(preview) renderPreview();
}
el.outTabs.addEventListener('click', e=>{
  const b=e.target.closest('button[data-pane]'); if(!b) return;
  setOutPane(b.dataset.pane);
});
$('btnCopy').addEventListener('click', copyOutput);
$('btnDownload').addEventListener('click', downloadOutput);

/* =====================================================================
   行列增减
   ===================================================================== */
/* 在指定位置插入行/列，保持选区跟随新内容 */
function insertRows(at,count){
  count=count||1;
  at=Math.max(0,Math.min(at,state.rows));
  snapshot();
  const blank=Array.from({length:count},()=>Array(state.cols).fill(''));
  state.data.splice(at,0,...blank);
  state.rows+=count;
  renderGrid();
  setSel({r:at,c:0},{r:at+count-1,c:state.cols-1});
  toast('已在第 '+(at+1)+' 行前插入 '+count+' 行');
}
function insertCols(at,count){
  count=count||1;
  at=Math.max(0,Math.min(at,state.cols));
  snapshot();
  state.data.forEach(row=>row.splice(at,0,...Array(count).fill('')));
  state.cols+=count;
  renderGrid();
  setSel({r:0,c:at},{r:state.rows-1,c:at+count-1});
  toast('已在 '+colName(at)+' 列前插入 '+count+' 列');
}
function deleteRows(r1,r2){
  const n=r2-r1+1;
  if(n>=state.rows){ toast('至少保留 1 行'); return; }
  snapshot();
  state.data.splice(r1,n);
  state.rows-=n;
  state.sel=null; renderGrid();
  toast('已删除 '+(n>1?n+' 行':'第 '+(r1+1)+' 行'));
}
function deleteCols(c1,c2){
  const n=c2-c1+1;
  if(n>=state.cols){ toast('至少保留 1 列'); return; }
  snapshot();
  state.data.forEach(row=>row.splice(c1,n));
  state.cols-=n;
  state.sel=null; renderGrid();
  toast('已删除 '+(n>1?n+' 列':'第 '+colName(c1)+' 列'));
}
function selRangeRows(){
  const s=state.sel;
  return s ? [Math.min(s.r1,s.r2),Math.max(s.r1,s.r2)] : null;
}
function selRangeCols(){
  const s=state.sel;
  return s ? [Math.min(s.c1,s.c2),Math.max(s.c1,s.c2)] : null;
}
function requireSel(kind){
  if(!state.sel){ toast('先在方格中选中一行或一列'); return false; }
  return true;
}

$('btnInsRowAbove').addEventListener('click', ()=>{
  const r=selRangeRows();
  insertRows(r?r[0]:state.rows,1);
});
$('btnInsRowBelow').addEventListener('click', ()=>{
  const r=selRangeRows();
  insertRows(r?r[1]+1:state.rows,1);
});
$('btnInsColLeft').addEventListener('click', ()=>{
  const c=selRangeCols();
  insertCols(c?c[0]:state.cols,1);
});
$('btnInsColRight').addEventListener('click', ()=>{
  const c=selRangeCols();
  insertCols(c?c[1]+1:state.cols,1);
});
$('btnDelSelRow').addEventListener('click', ()=>{
  if(!requireSel('row')) return;
  const r=selRangeRows(); deleteRows(r[0],r[1]);
});
$('btnDelSelCol').addEventListener('click', ()=>{
  if(!requireSel('col')) return;
  const c=selRangeCols(); deleteCols(c[0],c[1]);
});

/* 面板头的 ＋/− 仍为末尾追加 / 删除末尾 */
$('btnAddRow').addEventListener('click', ()=>insertRows(state.rows,1));
$('btnDelRow').addEventListener('click', ()=>deleteRows(state.rows-1,state.rows-1));
$('btnAddCol').addEventListener('click', ()=>insertCols(state.cols,1));
$('btnDelCol').addEventListener('click', ()=>deleteCols(state.cols-1,state.cols-1));

/* 转义说明：悬停显示，点击固定（触屏用） */
(function initHelp(){
  const btn=$('escapeHelp'), tip=$('escapeTip');
  if(!btn || !tip) return;
  let pinned=false;
  const show=on=>{
    tip.hidden=!on;
    btn.classList.toggle('show',on);
    btn.setAttribute('aria-expanded',on?'true':'false');
  };
  btn.addEventListener('mouseenter', ()=>show(true));
  btn.addEventListener('mouseleave', ()=>{ if(!pinned) show(false); });
  btn.addEventListener('click', e=>{
    e.stopPropagation();
    pinned=!pinned;
    show(pinned || btn.matches(':hover'));
  });
  btn.addEventListener('keydown', e=>{
    if(e.key==='Escape'){ pinned=false; show(false); btn.blur(); }
  });
  document.addEventListener('click', e=>{
    if(e.target.closest('.help')) return;
    pinned=false; show(false);
  });
})();

/* 窄屏侧栏开关 */
$('btnSideToggle').addEventListener('click', ()=>{
  const panel=$('panel-grid');
  const open=panel.classList.toggle('side-open');
  $('btnSideToggle').setAttribute('aria-expanded', open?'true':'false');
  $('btnSideToggle').textContent = open ? '⚙ 收起' : '⚙ 工具';
});

/* =====================================================================
   全局快捷键
   ===================================================================== */
document.addEventListener('keydown', e=>{
  const mod=e.ctrlKey||e.metaKey;
  if(mod && e.key.toLowerCase()==='z' && !e.shiftKey){ e.preventDefault(); undo(); }
  else if(mod && (e.key.toLowerCase()==='y' || (e.shiftKey && e.key.toLowerCase()==='z'))){ e.preventDefault(); redo(); }
  else if(mod && e.key.toLowerCase()==='f'){ e.preventDefault(); el.findInput.focus(); el.findInput.select(); }
});

/* =====================================================================
   初始化
   ===================================================================== */
state.data=blankGrid(state.rows,state.cols);
renderGrid();
updateLineNumbers();
el.syncText.textContent='已同步 · '+state.rows+'×'+state.cols;
/* 首屏直接载入示例，避免定时器竞态；用户点「清空」后不会再次自动出现 */
(function seed(){
  el.srcText.value=SAMPLE;
  updateLineNumbers();
  loadMatrix(parseDelimited(SAMPLE,'tsv'),'示例数据');
  state.history=[];
  state.sel=null;
  renderGrid();
})();
