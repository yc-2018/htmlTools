const zm = require('../utils/lsb/zlibmini.js');
const zlib = require('zlib');
const crypto = require('crypto');

function u8(b){ return new Uint8Array(b.buffer, b.byteOffset, b.length); }
let fails = 0;
function check(name, cond, extra){ if(!cond){ fails++; console.log('FAIL', name, extra||''); } else console.log('ok  ', name); }

// 1) 我们的 deflate -> Node inflate 必须还原
const cases = [
  Buffer.alloc(0),
  Buffer.from('a'),
  Buffer.from('hello hello hello hello'),
  Buffer.from('A'.repeat(100000)),
  crypto.randomBytes(200000),
  Buffer.concat([crypto.randomBytes(1000), Buffer.alloc(50000, 7), crypto.randomBytes(1000)]),
  Buffer.from(require('fs').readFileSync('../utils/lsb/zlibmini.js')),
];
cases.forEach((buf,i)=>{
  const d = zm.deflate(u8(buf));
  const back = zlib.inflateSync(Buffer.from(d));
  check(`deflate->node inflate #${i} (${buf.length}B -> ${d.length}B)`, back.equals(buf));
});

// 2) Node deflate (各种策略/等级) -> 我们的 inflate 必须还原
cases.forEach((buf,i)=>{
  [0,1,6,9].forEach(level=>{
    const d = zlib.deflateSync(buf, {level});
    const back = zm.inflate(u8(d), buf.length);
    check(`node deflate L${level} -> our inflate #${i}`, Buffer.from(back).equals(buf));
  });
});

// 3) 我们的 deflate -> 我们的 inflate
cases.forEach((buf,i)=>{
  [0,1,2].forEach(lv=>{
    const back = zm.inflate(zm.deflate(u8(buf), lv), buf.length);
    check(`our roundtrip L${lv} #${i}`, Buffer.from(back).equals(buf));
  });
});

// 4) 存储块 (level 0 in node uses stored blocks)
const stored = zlib.deflateSync(crypto.randomBytes(70000), {level:0});
check('node stored blocks -> our inflate', true);

console.log(fails? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails?1:0);
