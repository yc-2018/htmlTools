import TextArea from "antd/es/input/TextArea";
import React, {useEffect, useState} from "react";
import {Button, Col, Row, Radio, Card} from "antd";
import {CopyToClipboard} from "react-copy-to-clipboard/src";

import CommonStore from "../../../store/CommonStore";


// 普通字母
const ptLetters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ' //Array.from(Array(26)).map((_, i) => String.fromCharCode(65 + i))
// 普通数字
const ptNumbers = '0123456789'

// 特殊字母
const tsLetter = [
  "𝐚𝐛𝐜𝐝𝐞𝐟𝐠𝐡𝐢𝐣𝐤𝐥𝐦𝐧𝐨𝐩𝐪𝐫𝐬𝐭𝐮𝐯𝐰𝐱𝐲𝐳𝐀𝐁𝐂𝐃𝐄𝐅𝐆𝐇𝐈𝐉𝐊𝐋𝐌𝐍𝐎𝐏𝐐𝐑𝐒𝐓𝐔𝐕𝐖𝐗𝐘𝐙",
  "𝒂𝒃𝒄𝒅𝒆𝒇𝒈𝒉𝒊𝒋𝒌𝒍𝒎𝒏𝒐𝒑𝒒𝒓𝒔𝒕𝒖𝒗𝒘𝒙𝒚𝒛𝑨𝑩𝑪𝑫𝑬𝑭𝑮𝑯𝑰𝑱𝑲𝑳𝑴𝑵𝑶𝑷𝑸𝑹𝑺𝑻𝑼𝑽𝑾𝑿𝒀𝒁",
  "𝕒𝕓𝕔𝕕𝕖𝕗𝕘𝕙𝕚𝕛𝕜𝕝𝕞𝕟𝕠𝕡𝕢𝕣𝕤𝕥𝕦𝕧𝕨𝕩𝕪𝕫𝔸𝔹ℂ𝔻𝔼𝔽𝔾ℍ𝕀𝕁𝕂𝕃𝕄ℕ𝕆ℙℚℝ𝕊𝕋𝕌𝕍𝕎𝕏𝕐ℤ",
  "𝑎𝑏𝑐𝑑𝑒𝑓𝑔𝒽𝑖𝑗𝑘𝑙𝑚𝑛𝑜𝑝𝑞𝑟𝑠𝑡𝑢𝑣𝑤𝑥𝑦𝑧𝐴𝐵𝐶𝐷𝐸𝐹𝐺𝐻𝐼𝐽𝐾𝐿𝑀𝑁𝑂𝑃𝑄𝑅𝑆𝑇𝑈𝑉𝑊𝑋𝑌𝑍",                                      //𝒽是借来的，本来的无法显示
  "𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭",
  "𝙖𝙗𝙘𝙙𝙚𝙛𝙜𝙝𝙞𝙟𝙠𝙡𝙢𝙣𝙤𝙥𝙦𝙧𝙨𝙩𝙪𝙫𝙬𝙭𝙮𝙯𝘼𝘽𝘾𝘿𝙀𝙁𝙂𝙃𝙄𝙅𝙆𝙇𝙈𝙉𝙊𝙋𝙌𝙍𝙎𝙏𝙐𝙑𝙒𝙓𝙔𝙕",
  "𝚊𝚋𝚌𝚍𝚎𝚏𝚐𝚑𝚒𝚓𝚔𝚕𝚖𝚗𝚘𝚙𝚚𝚛𝚜𝚝𝚞𝚟𝚠𝚡𝚢𝚣𝙰𝙱𝙲𝙳𝙴𝙵𝙶𝙷𝙸𝙹𝙺𝙻𝙼𝙽𝙾𝙿𝚀𝚁𝚂𝚃𝚄𝚅𝚆𝚇𝚈𝚉",
  "𝘢𝘣𝘤𝘥𝘦𝘧𝘨𝘩𝘪𝘫𝘬𝘭𝘮𝘯𝘰𝘱𝘲𝘳𝘴𝘵𝘶𝘷𝘸𝘹𝘺𝘻𝘈𝘉𝘊𝘋𝘌𝘍𝘎𝘏𝘐𝘑𝘒𝘓𝘔𝘕𝘖𝘗𝘘𝘙𝘚𝘛𝘜𝘝𝘞𝘟𝘠𝘡",
  "𝖺𝖻𝖼𝖽𝖾𝖿𝗀𝗁𝗂𝗃𝗄𝗅𝗆𝗇𝗈𝗉𝗊𝗋𝗌𝗍𝗎𝗏𝗐𝗑𝗒𝗓𝖠𝖡𝖢𝖣𝖤𝖥𝖦𝖧𝖨𝖩𝖪𝖫𝖬𝖭𝖮𝖯𝖰𝖱𝖲𝖳𝖴𝖵𝖶𝖷𝖸𝖹",
  "𝖆𝖇𝖈𝖉𝖊𝖋𝖌𝖍𝖎𝖏𝖐𝖑𝖒𝖓𝖔𝖕𝖖𝖗𝖘𝖙𝖚𝖛𝖜𝖝𝖞𝖟𝕬𝕭𝕮𝕯𝕰𝕱𝕲𝕳𝕴𝕵𝕶𝕷𝕸𝕹𝕺𝕻𝕼𝕽𝕾𝕿𝖀𝖁𝖂𝖃𝖄𝖅",
  "𝒶𝒷𝒸𝒹𝑒𝒻𝑔𝒽𝒾𝒿𝓀𝓁𝓂𝓃𝑜𝓅𝓆𝓇𝓈𝓉𝓊𝓋𝓌𝓍𝓎𝓏𝒜ℬ𝒞𝒟ℰℱ𝒢ℋℐ𝒥𝒦ℒℳ𝒩𝒪𝒫𝒬ℛ𝒮𝒯𝒰𝒱𝒲𝒳𝒴𝒵",                          // 𝑒𝑔𝑜借了样式43个🔠字母
  "𝓪𝓫𝓬𝓭𝓮𝓯𝓰𝓱𝓲𝓳𝓴𝓵𝓶𝓷𝓸𝓹𝓺𝓻𝓼𝓽𝓾𝓿𝔀𝔁𝔂𝔃𝓐𝓑𝓒𝓓𝓔𝓕𝓖𝓗𝓘𝓙𝓚𝓛𝓜𝓝𝓞𝓟𝓠𝓡𝓢𝓣𝓤𝓥𝓦𝓧𝓨𝓩",
  "ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏ",
  "⒜⒝⒞⒟⒠⒡⒢⒣⒤⒥⒦⒧⒨⒩⒪⒫⒬⒭⒮⒯⒰⒱⒲⒳⒴⒵🄐🄑🄒🄓🄔🄕🄖🄗🄘🄙🄚🄛🄜🄝🄞🄟🄠🄡🄢🄣🄤🄥🄦🄧🄨🄩",
  // 特殊大写字母
  '🇦🇧🇨🇩🇪🇫🇬🇭🇮🇯🇰🇱🇲🇳🇴🇵🇶🇷🇸🇹🇺🇻🇼🇽🇾🇿'.repeat(2),
  '🄰🄱🄲🄳🄴🄵🄶🄷🄸🄹🄺🄻🄼🄽🄾🄿🅀🅁🅂🅃🅄🅅🅆🅇🅈🅉'.repeat(2),
  '🅐🅑🅒🅓🅔🅕🅖🅗🅘🅙🅚🅛🅜🅝🅞🅟🅠🅡🅢🅣🅤🅥🅦🅧🅨🅩'.repeat(2),
  '🅰🅱🅲🅳🅴🅵🅶🅷🅸🅹🅺🅻🅼🅽🅾🅿🆀🆁🆂🆃🆄🆅🆆🆇🆈🆉'.repeat(2),
]
// 特殊数字
const tsNumber = [
  "𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗",
  "𝟢𝟣𝟤𝟥𝟦𝟧𝟨𝟩𝟪𝟫",
  "𝟘𝟙𝟚𝟛𝟜𝟝𝟞𝟟𝟠𝟡",
  "𝟶𝟷𝟸𝟹𝟺𝟻𝟼𝟽𝟾𝟿",
  "𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵",
  "₀₁₂₃₄₅₆₇₈₉",
  "⁰¹²³⁴⁵⁶⁷⁸⁹",
]


export default () => {
  const [inputText, setInputText] = useState('')             // 输入文本
  const [outputText, setOutputText] = useState('')           // 输出文本
  const [lgText, setLgText] = useState('')                    // 乱搞文本
  const [tsAbc, setTsAbc] = useState(tsLetter[2])                      // 当前特殊字母
  const [tsNumbers, setTsNumbers] = useState(tsNumber[2])              // 当前特殊数字
  const [tsAll, setTsAll] = useState('')                      // 扩展:10万符号
  
  useEffect(() => toTs(), [inputText, tsAbc, tsNumbers]);
  
  /** 输入框输入时触发，转换为指定的特殊字符 */
  const toTs = () => {
    let tsText = ''
    // 循环输入文本，判断每个字符是否在普通字母或普通数字中，如果在，则替换为特殊的字母或数字
    for (const char of inputText) {
      let indexTsAbc = ptLetters.indexOf(char);
      if (indexTsAbc !== -1) {
        tsText += Array.from(tsAbc)[indexTsAbc]             // 获取特殊字母  套上Array.from是因为文本是一段Unicode字符序列，其中包括一些特殊的数学字母（双层字符）。
      } else {
        indexTsAbc = ptNumbers.indexOf(char);
        if (indexTsAbc !== -1) {
          tsText += Array.from(tsNumbers)[indexTsAbc]     // 获取特殊数字
        } else {
          tsText += char
        }
      }
    }
    setOutputText(tsText)
  }
  
  /** 构建组件 */
  const bd = (text, element) =>
    <Col span={8}>
      <div style={{textAlign: 'center'}}>{text}</div>
      {element}
    </Col>
  
  return <div
    className={'gun'}
    style={{
      padding: 10,
      backgroundColor: 'rgba(220,220,220,.2)',
      height: 'calc(100vh - 84px)',
      overflow: 'auto',
    }}
  >
    <Row>
      {bd('输入文本', <TextArea rows={15} value={inputText} onChange={e => setInputText(e.target.value)}/>)}
      {bd(<>输出文本<CopyText text={outputText}/></>, <TextArea rows={15} value={outputText}/>)}
      {bd(
        <>
          <Button size={'small'} onClick={() => setLgText(outputText)}>
            ➪输出过来
          </Button>
          乱搞文本
          <CopyText text={lgText}/>
        </>, <TextArea rows={15} value={lgText} onChange={v => setLgText(v.target.value)}/>)}
    </Row>
    <div style={{margin: 10}}>
      <hr style={{border: '#eaeaf5 solid 1px'}}/>
      
      <span>特殊字母：</span>
      <Radio.Group value={tsAbc} onChange={e => setTsAbc(e.target.value)}>
        {tsLetter.map(ts => <Radio.Button value={ts} key={ts}>{Array.from(ts).slice(0, 3).join('')}...</Radio.Button>)}
        <Radio.Button value={ptLetters}>不换!</Radio.Button>
      </Radio.Group>
      <hr style={{border: '#eaeaf5 solid 1px'}}/>
      
      <span>特殊数字：</span>
      <Radio.Group value={tsNumbers} onChange={e => setTsNumbers(e.target.value)}>
        {tsNumber.map(ts => <Radio.Button value={ts} key={ts}>{Array.from(ts).slice(0, 3).join('')}...</Radio.Button>)}
        <Radio.Button value={ptNumbers}>不换!</Radio.Button>
      </Radio.Group>
      <hr style={{border: '#eaeaf5 solid 1px'}}/>
      
      <Card title={<div style={{textAlign: 'center'}}>注意事项和说明</div>}>
        <div>
          <b>特殊字母选项：</b>如果选项显示小写就说明大小写正常转换，
          <b style={{color: 'red'}}>如果显示大写的就说明本来的大小写都会转化为大写</b>；
          另外 <b style={{color: 'blue'}}>🇦🇧🇨...</b>比较特殊,在手机上显示<b style={{color: 'blue'}}>蓝色大字</b>,
          但是两个以上拼接在一起就会显示变成一些国旗符号,所以可以到乱搞文本上加上空格
          <b style={{color: 'blue'}}>🇦 🇧 🇨...</b>, 这样手机上也能正常显示了。
        </div>
        <div>
        <b>乱搞文本：</b>顾名思义就是给你编辑的,因为输出文本输入框是跟着输入变的,所以输出框是不能编辑的,所以你可以点击【输出过来】按钮
        把输出文本 覆盖到乱搞文本。 <b>值得注意的是</b>：如果你已经在乱搞文本里面编辑了,就不要再点【输出过来】按钮了,因为是会覆盖你本来编辑的文字的。
        </div>
        <div><b>换特殊符号时：</b> 输出文本会实时改变。</div>
        <div><b>更多特殊符号：</b>
          <a href={'https://blog.csdn.net/weixin_46665865/article/details/126132912'} target={'_blank'}>
            可以看看我的CSDN这篇笔记</a>，都已经分类整理好了
        </div>
        <Button
          onClick={event => {
            event.target.parentElement.style.display = 'none' // 点完就消失
            let fhAdd = '' // 符号追加
            for (let i = 32; i < 140000; i++) {
              fhAdd += String.fromCharCode(i)
            }
            setTsAll(fhAdd)
          }}>
          点击直接看10万符号(电脑卡别点)【有很多方块这些都是电脑当前字体不支持显示的符号】
        </Button>
        <div style={{wordWrap: 'break-word'}}>
          {tsAll}
        </div>
      </Card>
    </div>
  </div>
}


/** 复制组件 */
const CopyText = ({text}) =>
  <CopyToClipboard text={text} onCopy={() => CommonStore.msg.success('复制成功')}>
    <Button size={'small'}>复制文本</Button>
  </CopyToClipboard>
