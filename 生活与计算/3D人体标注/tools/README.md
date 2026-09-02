# tools/ —— 只在打包数据时用，网页不加载

这里的脚本用 Node 跑，把 BodyParts3D 的原始 OBJ 转成 `assets/inner/*.ibp`。
网页只读 `assets/inner/` 下的成品，跑起来跟这个目录无关；改这里的代码不会影响线上页面，
除非重新执行一遍并提交新的 `.ibp`。

| 文件 | 作用 |
| --- | --- |
| `bp3d-lib.js` | 读概念表（`isa_*`、`partof_*`）、读 OBJ、合并、顶点聚类简化、int16 量化 |
| `bp3d-parts.js` | 对照表：哪些 FMA 概念收进来、中文名、属于哪一层的第几级、简化后的三角面预算 |
| `bp3d-zh.js` | 英文解剖名 → 中文（含肺段专用表 `seg()`） |
| `bp3d-build.js` | 主脚本：展开对照表 → 去重归属 → 读几何 → 打包 → 写 `manifest.json` |

## 准备原始数据

从 DBCLS 的 BodyParts3D 4.0 下载并解到同一个目录（默认 `/tmp/bp3d`，Windows 下用
`BP3D=` 指到实际路径）：

* `partof_BP3D_4.0_obj_99.zip` —— 每个部件一个 `FJ<编号>.obj`，解出来的目录名要保持
  `partof_BP3D_4.0_obj_99`
* `partof_element_parts.txt`、`partof_inclusion_relation_list.txt`
* `isa_element_parts.txt`、`isa_inclusion_relation_list.txt`、`isa_parts_list_e.txt`

下载页：<https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html>
许可与署名见 `../assets/inner/LICENSE-BodyParts3D.txt`。

## 打包

```sh
# 全部 10 个系统（几分钟，肌肉最久）
BP3D=/path/to/bp3d node tools/bp3d-build.js

# 只重打其中几个
BP3D=/path/to/bp3d node tools/bp3d-build.js resp bone
```

产物写到 `assets/inner/`：每个系统一个 `<sys>.ibp`，外加一份 `manifest.json`
（记着参考身高、每个系统的涂层级名、件数、三角面数、字节数）。
只重打一部分时 `manifest.json` 里其余系统的记录会原样保留。

脚本最后会打印提示：`没译：…` 是 `bp3d-zh.js` 缺词，`肌肉没找到：…` 是
`bp3d-parts.js` 里的英文本名和数据集对不上，`被更细的件吃光了` 是去重时整件都被
更细的件拿走了（一般说明这一条是多余的）。正常情况下这三类都应该是 0 条。

## `.ibp` 格式

```
'IBP1'                     4 字节
头部 JSON 的字节数         uint32 LE（真实长度，不含补位）
头部 JSON                  utf8，后面补 0 到 4 字节对齐
数据区                     每件依次：int16 顶点、索引（uint16 或 uint32），各自补到 4 字节
```

头部：`{ sys, levels:[级名], items:[{ n,lv,to,v,t,big,mn,sc,p,i,s?,d?,en? }] }`。
顶点还原公式 `p = (q + 32767) * sc + mn`；法线不存，浏览器端 `computeVertexNormals()` 现算。
读的一端见 `../js/inner-mesh.js`。
