# v1.3.0-alpha.18.9：PDF 导出修复

2026-09-16，PDF 修复测试版。源码合并与安装附件的公开状态以 GitHub 为准；本记录描述已完成的本地验收。未覆盖现用 app，未读取或修改用户 `.zhsp` / 自动保存。

## 修复范围

- 人物跟随规则不再为了凑两行，把后面完整的短对白单元递归绑定。保留人物/括号/对白关联、长段续页与双列，字体、字号、行距、手写换行原样保留。
- 创作 PDF 从巨型 `data:text/html` URL 改成唯一隔离内存会话的短 URL；保持图文原位快照，不落盘 HTML，不加载外网，不把正文放进异常消息。
- 不改输入/Tab、图片拖放、卡片移动/缩放、保存格式、撤销栈。

## 实际验证

- typecheck、build、core-guard、render、writing、zhsp-compat、history、input-performance、pagination-safety（81组）、pdf-transport、studio-theme、appearance、outline-reorder、scene-notes、storyboard-drop、storyboard-acts、reports、board-polish、writing-controls、progress-bands 全部通过。
- 用独立 app 标识和临时 userData 跑 `scripts/pdf-layout-electron.cjs`，不接入用户数据目录。
- 同一份约4.27 MB合成图文 HTML：旧 `data:` 加载实际报 `ERR_INVALID_URL`，新路径成功生成约3.23 MB PDF；PDF 中有完整可解码图片和首尾文本标记。
- 第五场正文、旁边图片及声音卡前后坐标误差小于1px；实际创作版PDF渲染确认素材仍在第五场旁。
- 250行长单列标记、170行双列标记从实际PDF提取后均恰好出现一次。
- 28组短对白实际A4 PDF为3页，每页分别11/12/5组，无中途整批挪页；人物与对应对白在同页。检查了三页渲染。
- 两种导出前后，合成工程自动保存字符串及素材坐标不变。
- 生产包 core-guard 通过；ad-hoc 签名完整性通过，不是Apple公证。

## 使用边界

用户此前提供的PDF仅用于只读问题检查，不加入工程或测试。没有用用户真实剧本重新导出，不能把合成验收说成已验证其全部具体内容。

需用户先保存并退出所有旧版窗口，再使用独立候选。不要并行打开新旧生产版编辑同一工程；不要覆盖未保存窗口。旧版与旧安装包保持原样。
