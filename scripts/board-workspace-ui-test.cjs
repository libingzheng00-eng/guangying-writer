/**
 * Real BoardView handlers mounted with synthetic data in jsdom. Covers editing,
 * selection, connector-drag / L / toolbar link transactions and drag/release state contracts.
 * Layout APIs are stubbed by the harness: this is not real pointer/visual QA.
 */
const assert = require('node:assert/strict');
const { makeBoardHarness } = require('./board-workspace-test-helper.cjs');
let count = 0;
const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); console.log(`✓ ${label}`); count++; };
let h;
(async () => {
  h = await makeBoardHarness('board-workspace-ui');
  const { act, state, clone, q, qa, card, hit, label, byName, mouse, click, key, press, pressCard, input, mount, history, selectedLink } = h;
  const linking = () => q('.board--workspace').dataset.linking;
  // 卡片文字是 contenteditable：写入后发出 input 事件；读取用纯文字。
  const richInput = (node, value) => act(async () => { node.innerHTML = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'); node.dispatchEvent(new h.w.Event('input', { bubbles: true })); });
  const richText = (node) => node.innerHTML.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  // jsdom 没有布局：连线松手时由测试指定指针下的卡片。
  const pointerOver = (node) => { document.elementFromPoint = () => node; };
  const connector = (id) => card(id).querySelector('.bcard__connector');
  const linkBetween = (a, b) => state().project.boardLinks.find((link) => (link.from === a && link.to === b) || (link.from === b && link.to === a));
  const pos = (id) => [parseFloat(card(id).style.left), parseFloat(card(id).style.top)];
  const canvas = () => q('.board__canvas');
  const relationInput = () => q('.board-link__input[aria-label="关系说明"]');
  const title = (id) => card(id).querySelector('span.bcard__media-title[role="button"]');
  const titleInput = (id) => card(id).querySelector('input.bcard__media-title');
  const drag = async (target, dx, dy, start = { clientX: 100, clientY: 100 }) => {
    await mouse(target, 'mousedown', start);
    await mouse(h.w, 'mousemove', { clientX: start.clientX + dx / 2, clientY: start.clientY + dy / 2 });
    await mouse(h.w, 'mousemove', { clientX: start.clientX + dx, clientY: start.clientY + dy });
    await mouse(h.w, 'mouseup', { clientX: start.clientX + dx, clientY: start.clientY + dy });
  };
  await mount();
  const original = clone(state().project);
  const initialHistory = history();
  check('默认不处于连线拖动状态', linking(), 'off');
  check('每张卡片都有连线圆点，旧的选择/连线模式按钮已移除', [qa('.bcard__connector').length, qa('.board__dock button[aria-label="连接两张卡片"]').length], [4, 0]);
  check('新增和视图设置收拢为可访问下拉入口', qa('.board__dropdown summary').map((node) => node.getAttribute('aria-label')).sort(), ['新增卡片', '视图设置']);
  check('卡片均具有统一身份与类型', qa('[data-card]').map((node) => [node.dataset.id, node.dataset.kind]), [['s1', 'scene'], ['s2', 'scene'], ['b1', 'beat'], ['b2', 'sound']]);
  check('空选区不显示顶栏卡片工具', q('.board__selection-tools'), null);
  await pressCard('b1');
  check('普通卡片点击选中统一ID', state().selectedIds, ['beat:b1']);
  check('选择卡片后顶栏显示颜色和场景关联', !!q('.board__selection-tools [aria-label="卡片颜色 1"]') && !!q('.board__selection-tools select[aria-label="关联到场景"]'));
  check('选中卡片不弹出浮动窗口', q('.board__context'), null);
  check('原常驻逐卡连接/删除/关联入口已收拢', qa('[data-card] .bcard__connect, [data-card] .bcard__del, [data-card] select').length, 0);
  check('点击选择不产生工程变更/历史', [state().project, history()], [original, initialHistory]);

  // L 只在恰好选中两张卡片、画布非编辑状态且无修饰键/组合输入时连线。
  await mouse(title('b2'), 'dblclick');
  check('声音标题双击后才显示可编辑输入框', !!titleInput('b2'));
  await act(async () => state().setSelectedIds(['scene:s2', 'beat:b2']));
  const contentEditable = document.createElement('div');
  contentEditable.contentEditable = 'true';
  contentEditable.setAttribute('contenteditable', 'true');
  contentEditable.innerHTML = '<span>合成可编辑内容</span>';
  canvas().append(contentEditable);
  const editTargets = [card('s1').querySelector('.bcard__scene-notes'), card('b1').querySelector('[data-rich-note].bcard__edit'), titleInput('b2'), contentEditable.querySelector('span')];
  for (const target of editTargets) {
    const event = await key(target, 'l');
    check(`L在${target.tagName}编辑区域不连线`, [state().project.boardLinks.length, event.defaultPrevented], [3, false]);
  }
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    const event = await key(document.body, 'l', { [modifier]: true });
    check(`L带${modifier}不连线`, [state().project.boardLinks.length, event.defaultPrevented], [3, false]);
  }
  const composingL = await key(document.body, 'l', { isComposing: true });
  check('L组合期间不连线', [state().project.boardLinks.length, composingL.defaultPrevented], [3, false]);
  const imeL = await key(document.body, 'l', { keyCode: 229 });
  check('L的229组合占位键不连线', [state().project.boardLinks.length, imeL.defaultPrevented], [3, false]);
  contentEditable.remove();
  await key(titleInput('b2'), 'Escape');
  await act(async () => state().setSelectedIds(['scene:s2', 'beat:b2']));
  const lKey = await key(document.body, 'l');
  const created = linkBetween('scene:s2', 'beat:b2');
  check('选中两张卡片按 L 直接连线', [!!created, lKey.defaultPrevented, state().project.boardLinks.length], [true, true, 4]);
  check('连线只产生一个历史并选中新关系', [state().past.length, selectedLink()], [1, created.id]);
  check('连线不改正文/卡片/坐标', [state().project.elements, state().project.sceneMeta, state().project.beats], [original.elements, original.sceneMeta, original.beats]);
  await act(async () => state().undo());
  check('一次撤销完整移除新关系', state().project, original);
  await act(async () => state().redo());
  check('重做恢复同一关系ID', linkBetween('scene:s2', 'beat:b2')?.id, created.id);

  // 拖动卡片右上角的连线钮到另一张卡片即可连线。
  await mount();
  pointerOver(card('b2'));
  await drag(connector('s2'), 140, 60);
  check('拖圆点到另一张卡片建立一条连线', [!!linkBetween('scene:s2', 'beat:b2'), state().project.boardLinks.length, state().past.length], [true, 4, 1]);
  check('拖圆点连线不移动卡片', [pos('s2'), state().project.sceneMeta, state().project.beats], [[parseFloat(card('s2').style.left), parseFloat(card('s2').style.top)], original.sceneMeta, original.beats]);
  await mount();
  for (const [from, over] of [['s1', 'b1'], ['b1', 's1'], ['s1', 's1']]) {
    pointerOver(card(over));
    await drag(connector(from), 120, 40);
    check(`拖圆点 ${from} → ${over} 不制造重复或自连`, [state().project, state().past.length], [original, 0]);
  }
  pointerOver(canvas());
  await drag(connector('s2'), 200, 80);
  check('拖到空白处松开不建立连线', [state().project, state().past.length, linking()], [original, 0, 'off']);
  pointerOver(card('b2'));
  await mouse(connector('s2'), 'mousedown', { clientX: 100, clientY: 100 });
  await mouse(h.w, 'mousemove', { clientX: 220, clientY: 160 });
  check('拖动中显示连线预览', [linking(), !!q('.board-link__draft')], ['on', true]);
  await key(document.body, 'Escape');
  await mouse(h.w, 'mouseup', { clientX: 220, clientY: 160 });
  check('Esc 取消拖动中的连线', [state().project, state().past.length, linking()], [original, 0, 'off']);
  await pressCard('s2');
  await pressCard('b2', { ctrlKey: true });
  await click(q('.board__selection-tools .board__connect'));
  check('选中两张卡片后顶栏「连线」按钮也能连线', [!!linkBetween('scene:s2', 'beat:b2'), state().past.length], [true, 1]);
  delete document.elementFromPoint;

  // 普通标题保留选择、Shift和组拖动；只有显式编辑才创建输入框。
  await mount();
  check('灵感/声音标题初始为可聚焦文字而非常驻输入框', [qa('span.bcard__media-title[role="button"]').length, qa('input.bcard__media-title').length], [2, 0]);
  check('声音标题初始文字与说明分别保留', [title('b2').textContent, richText(card('b2').querySelector('[data-rich-note].bcard__edit'))], ['合成声音', '合成声音']);
  await press(title('b1'));
  check('普通标题点击选择卡片并保留非编辑状态', [state().selectedIds, titleInput('b1'), state().past.length], [['beat:b1'], null, 0]);
  await press(title('b2'), { shiftKey: true });
  check('Shift点击普通标题选择可见连续卡片', state().selectedIds, ['beat:b1', 'beat:b2']);
  await drag(title('b1'), 36, 18);
  check('拖普通标题可以移动整个所选组', [pos('b1'), pos('b2'), state().past.length], [[586, 48], [856, 48], 1]);
  check('标题区组拖动不改标题/说明和写作素材位置', state().project.beats.map(({ boardX, boardY, ...beat }) => beat), original.beats);
  await act(async () => state().undo());
  check('标题区组拖动一次撤销完整恢复', state().project, original);
  await mount();
  pointerOver(title('s2') || card('s2').querySelector('.bcard__title'));
  await drag(connector('b2'), 150, 30);
  check('拖圆点松开在另一张卡片的标题上也能连线', [state().project.boardLinks.length, state().past.length], [4, 1]);
  delete document.elementFromPoint;

  await mount();
  const beforeTitle = clone(state().project);
  await mouse(title('b2'), 'dblclick');
  check('双击声音标题打开输入并聚焦原文字', [document.activeElement, titleInput('b2').value], [titleInput('b2'), '合成声音']);
  await input(titleInput('b2'), '更新的合成声音标题');
  check('标题暂存输入不写工程或历史', [state().project, state().past.length], [beforeTitle, 0]);
  await drag(titleInput('b2'), 130, 90);
  await mouse(titleInput('b2'), 'dblclick');
  await h.dispatch(titleInput('b2'), new h.w.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 200 }));
  for (const value of ['Delete', 'Backspace', 'l']) {
    const event = await key(titleInput('b2'), value);
    check(`正在编辑标题时${value}保留普通文字输入`, event.defaultPrevented, false);
  }
  check('标题编辑手势不拖卡、连线、删除或缩放', [state().project, state().past.length, linking(), q('.board__world').style.transform], [beforeTitle, 0, 'off', 'translate(0px, 0px) scale(1)']);
  const composingTitleEnter = await key(titleInput('b2'), 'Enter', { isComposing: true });
  const imeTitleEnter = await key(titleInput('b2'), 'Enter', { keyCode: 229 });
  check('组合期间Enter与229不提交标题', [!!titleInput('b2'), state().project, composingTitleEnter.defaultPrevented, imeTitleEnter.defaultPrevented], [true, beforeTitle, false, false]);
  await key(titleInput('b2'), 'Enter');
  check('Enter提交标题并恢复可拖动文字', [state().project.beats[1].title, titleInput('b2'), title('b2').textContent, state().past.length], ['更新的合成声音标题', null, '更新的合成声音标题', 1]);
  check('提交标题不改声音说明、正文或关系线', [state().project.beats[1].text, state().project.elements, state().project.boardLinks], ['合成声音', original.elements, original.boardLinks]);
  await act(async () => state().undo());
  check('标题提交一次撤销完整恢复', state().project, beforeTitle);
  await mount();
  await key(title('b2'), 'F2');
  check('F2可打开标题编辑入口', !!titleInput('b2'));
  await input(titleInput('b2'), '应撤回的合成标题');
  await key(titleInput('b2'), 'Escape');
  check('Esc回滚标题草稿且不写历史', [state().project, state().past.length, titleInput('b2'), title('b2').textContent], [original, 0, null, '合成声音']);
  await mouse(title('b2'), 'dblclick');
  await key(titleInput('b2'), 'Enter');
  check('未改标题直接Enter退出不制造历史', [state().project, state().past.length], [original, 0]);
  await key(title('b1'), 'Enter');
  check('Enter也可打开空灵感标题的编辑入口', [!!titleInput('b1'), titleInput('b1').value], [true, '']);
  await key(titleInput('b1'), 'Escape');
  await mouse(title('b2'), 'dblclick');
  await input(titleInput('b2'), '失焦提交的合成标题');
  await pressCard('s1');
  check('点别的卡片先按失焦语义提交并关闭标题编辑', [titleInput('b2'), state().project.beats[1].title, state().past.length], [null, '失焦提交的合成标题', 1]);

  // 文本输入在连接/选择模式都保持普通编辑边界。
  await mount();
  await act(async () => state().setSelectedIds(['beat:b1']));
  const notes = card('s1').querySelector('.bcard__scene-notes');
  const beatEdit = card('b1').querySelector('[data-rich-note].bcard__edit');
  const assoc = q('select[aria-label="关联到场景"]');
  const beforeAssociationGesture = clone(state().project);
  const associationHistory = history();
  await drag(assoc, 130, 90);
  await mouse(assoc, 'dblclick');
  for (const value of ['Delete', 'Backspace']) {
    const event = await key(assoc, value);
    check(`SELECT内${value}保留原生编辑`, event.defaultPrevented, false);
  }
  await h.dispatch(assoc, new h.w.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 200 }));
  check('选择模式的上下文关联手势不拖卡、不删卡、不缩放', [state().project, history(), q('.board__world').style.transform], [beforeAssociationGesture, associationHistory, 'translate(0px, 0px) scale(1)']);
  const beforeEditingGestures = clone(state().project);
  const beforeEditingHistory = history();
  const transform = q('.board__world').style.transform;
  for (const target of [notes, beatEdit, card('b2').querySelector('[data-rich-note].bcard__edit')]) {
    await drag(target, 130, 90);
    await mouse(target, 'dblclick');
    for (const value of ['Delete', 'Backspace']) {
      const event = await key(target, value);
      check(`${target.tagName}内${value}保留原生编辑`, event.defaultPrevented, false);
    }
    await h.dispatch(target, new h.w.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 200 }));
    check(`${target.tagName}编辑手势不开始连线`, [linking(), qa('[data-card].is-linking').length], ['off', 0]);
  }
  check('摘要/灵感/关联/声音编辑手势不拖卡、不连线、不删卡', [state().project, history()], [beforeEditingGestures, beforeEditingHistory]);
  check('编辑区域双击不跳正文，滚轮不缩放画布', [state().view, state().focus, q('.board__world').style.transform], ['board', null, transform]);
  await richInput(notes, '更新的合成摘要。\n第二行。');
  check('摘要直接更新共用synopsis', state().project.sceneMeta[0].synopsis, '更新的合成摘要。\n第二行。');
  check('摘要输入不改正文/坐标/尺寸/关系', [state().project.elements, state().project.sceneMeta.map(({ synopsis, ...meta }) => meta), state().project.boardLinks], [original.elements, original.sceneMeta.map(({ synopsis, ...meta }) => meta), original.boardLinks]);
  await richInput(beatEdit, '更新的合成灵感');
  check('灵感可正常输入', state().project.beats[0].text, '更新的合成灵感');
  await pressCard('b1');
  await input(q('select[aria-label="关联到场景"]'), 'm2');
  check('上下文关联保留SceneMeta.id语义且只改变关联场景', [state().project.beats[0].sceneId, state().project.elements, state().project.boardLinks], ['m2', original.elements, original.boardLinks]);
  await key(document.body, 'Escape');
  await mouse(card('s1').querySelector('.bcard__title'), 'dblclick');
  check('非编辑区场景标题双击仍跳转正文', [state().view, state().focus?.id], ['write', 's1']);

  await mount();
  await pressCard('b1');
  await press(hit('l1'));
  check('点击关系线清空卡片选区并选中关系', [state().selectedIds, selectedLink()], [[], 'l1']);
  check('选中关系线不显示顶栏卡片工具', q('.board__selection-tools'), null);
  await pressCard('s2');
  check('选卡清空关系选择', [state().selectedIds, selectedLink()], [['scene:s2'], '']);
  await press(hit('l2'));
  const beforeLineDelete = clone(state().project);
  await key(document.body, 'Delete');
  check('Delete只移除所选关系，不删卡片和正文', [state().project.boardLinks.map((link) => link.id), state().project.elements, state().project.sceneMeta, state().project.beats, h.confirmations().length], [['l1', 'l3'], original.elements, original.sceneMeta, original.beats, 0]);
  check('删除关系只产生一次可撤销事务', state().past.length, 1);
  await act(async () => state().undo());
  check('关系删除一次撤销恢复', state().project, beforeLineDelete);
  await press(hit('l1'));
  await key(document.body, 'Backspace');
  check('Backspace也只删除当前关系', state().project.boardLinks.map((link) => link.id), ['l2', 'l3']);

  await mount();
  await mouse(label('l1'), 'dblclick');
  check('关系标签双击打开具有明确名称的编辑框', !!relationInput());
  check('关系说明编辑默认显示原文本', relationInput().value, '合成跨板关系');
  const beforeLabelEdit = clone(state().project);
  await input(relationInput(), '更新的合成关系说明');
  check('关系输入暂存期间不制造工程历史', [state().project, state().past.length], [beforeLabelEdit, 0]);
  const noteDelete = await key(relationInput(), 'Delete');
  const noteL = await key(relationInput(), 'l');
  check('关系说明的Delete/L保留文本编辑，不删线或连线', [noteDelete.defaultPrevented, noteL.defaultPrevented, linking(), state().project.boardLinks.length], [false, false, 'off', 3]);
  const composingEnter = await key(relationInput(), 'Enter', { isComposing: true });
  check('组合期间Enter不提交关系说明', [!!relationInput(), state().project, composingEnter.defaultPrevented], [true, beforeLabelEdit, false]);
  await key(relationInput(), 'Enter');
  check('Enter提交关系说明并关闭输入', [state().project.boardLinks[0].note, relationInput(), state().past.length], ['更新的合成关系说明', null, 1]);
  check('提交后关系说明标签显示新文本', label('l1').textContent.trim(), '更新的合成关系说明');
  const labelBox = label('l1').closest('foreignObject');
  const pathNumbers = hit('l1').getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
  check('关系说明渲染框位于连接路径中点',
    Math.abs(Number(labelBox.getAttribute('x')) + Number(labelBox.getAttribute('width')) / 2 - (pathNumbers[0] + pathNumbers[6]) / 2) <= 1 &&
    Math.abs(Number(labelBox.getAttribute('y')) + Number(labelBox.getAttribute('height')) / 2 - (pathNumbers[1] + pathNumbers[7]) / 2) <= 1);
  await act(async () => state().undo());
  check('关系说明一次撤销完整恢复', state().project, beforeLabelEdit);
  await mount();
  await mouse(label('l1'), 'dblclick');
  await input(relationInput(), '应撤回的合成输入');
  await key(relationInput(), 'Escape');
  check('Esc回滚暂存关系说明，不写历史', [state().project, state().past.length, relationInput(), label('l1').textContent.trim()], [original, 0, null, '合成跨板关系']);

  await mount();
  await act(async () => state().setSelectedIds(['scene:s1', 'beat:b1']));
  await click(byName('灵感板'));
  check('过滤后仅保留可见卡片选择与双端可见关系', [state().selectedIds, qa('.board-link__hit').map((node) => node.dataset.linkId)], [['beat:b1'], ['l2']]);
  await click(byName('总览'));
  await press(hit('l1'));
  await click(byName('灵感板'));
  check('关系端点被过滤时清除关系选择', selectedLink(), '');
  check('过滤只改视图，不改工程/历史', [state().project, state().past.length], [original, 0]);
  await click(byName('总览'));
  pointerOver(card('b2'));
  await mouse(connector('s2'), 'mousedown', { clientX: 100, clientY: 100 });
  await mouse(h.w, 'mousemove', { clientX: 200, clientY: 140 });
  await click(byName('灵感板'));
  await mouse(h.w, 'mouseup', { clientX: 200, clientY: 140 });
  check('切换显示范围会取消拖动中的连线', [state().project, state().past.length, linking()], [original, 0, 'off']);
  delete document.elementFromPoint;

  // 开关和世界变换都必须留在工作区状态；保存数据不受影响。
  await mount();
  const beforeViewChanges = clone(state().project);
  const beforeViewHistory = history();
  await h.openViewSettings();
  for (const name of ['显示网格', '磁吸网格', '显示网格', '磁吸网格']) await click(q(`input[aria-label="${name}"]`));
  await click(byName('放大自由板'));
  await click(byName('缩小自由板'));
  check('网格/磁吸/缩放开关不写工程或历史', [state().project, history()], [beforeViewChanges, beforeViewHistory]);
  check('开关往返恢复网格开/磁吸关', [q('input[aria-label="显示网格"]').checked, q('.board--workspace').dataset.snap], [true, 'off']);

  // 组拖动以世界坐标同一位移预览，释放时仅提交一个事务。
  await mount();
  await act(async () => state().setSelectedIds(['scene:s1', 'beat:b1']));
  await click(byName('放大自由板'));
  const groupStart = [pos('s1'), pos('b1')];
  const beforeGroup = clone(state().project);
  const groupHistory = history();
  await mouse(card('s1').querySelector('.bcard__head'), 'mousedown', { clientX: 100, clientY: 100 });
  await mouse(h.w, 'mousemove', { clientX: 133, clientY: 122 });
  await mouse(h.w, 'mousemove', { clientX: 167, clientY: 144 });
  check('拖动预览尚未写工程/历史', [state().project, history()], [beforeGroup, groupHistory]);
  check('释放前两张卡片都已按缩放后的位移显示预览', ['s1', 'b1'].every((id, index) => {
    const current = pos(id);
    return Math.abs(current[0] - groupStart[index][0] - 67 / 1.1) <= 1 && Math.abs(current[1] - groupStart[index][1] - 44 / 1.1) <= 1;
  }));
  check('组拖动的两张卡片预览保持相对位置', [pos('b1')[0] - pos('s1')[0], pos('b1')[1] - pos('s1')[1]], [groupStart[1][0] - groupStart[0][0], groupStart[1][1] - groupStart[0][1]]);
  await mouse(h.w, 'mouseup', { clientX: 167, clientY: 144 });
  const dx = Math.round(67 / 1.1 * 100) / 100;
  const dy = Math.round(44 / 1.1 * 100) / 100;
  check('放大后拖拽按世界坐标计算同一位移', [pos('s1'), pos('b1')], [[groupStart[0][0] + dx, groupStart[0][1] + dy], [groupStart[1][0] + dx, groupStart[1][1] + dy]]);
  check('一次组拖动只提交一条历史', state().past.length, 1);
  check('自由板素材拖动写boardX/Y并保留写作x/y', [state().project.beats[0].boardX, state().project.beats[0].boardY, state().project.beats[0].x, state().project.beats[0].y], [550 + dx, 30 + dy, 550, 30]);
  check('拖动不改正文/尺寸/关系数据', [state().project.elements, state().project.boardLinks, state().project.beats.map(({ boardX, boardY, ...beat }) => beat)], [original.elements, original.boardLinks, original.beats]);
  await act(async () => state().undo());
  check('一次撤销完整恢复组拖动前工程及画面坐标', [state().project, pos('s1'), pos('b1')], [beforeGroup, groupStart[0], groupStart[1]]);
  await act(async () => state().redo());
  check('重做恢复整个组的相对位移', [pos('s1'), pos('b1')], [[groupStart[0][0] + dx, groupStart[0][1] + dy], [groupStart[1][0] + dx, groupStart[1][1] + dy]]);
  await mount();
  await pressCard('b1');
  check('仅点击/零位移释放不制造历史或board坐标', [state().project, state().past.length], [original, 0]);
  await h.openViewSettings();
  await click(q('input[aria-label="磁吸网格"]'));
  await drag(card('b1').querySelector('.bcard__head'), 13, 17);
  check('主动磁吸按轴仅在6px容差内落到28px网格', [state().project.beats[0].boardX, state().project.beats[0].boardY, state().past.length], [560, 47, 1]);
  check('磁吸拖动仍保留写作素材坐标', [state().project.beats[0].x, state().project.beats[0].y], [550, 30]);
  await drag(card('b1').querySelector('.bcard__head'), 40, 20);
  check('连续两次释放各自保留独立历史', [state().project.beats[0].boardX, state().project.beats[0].boardY, state().past.length], [600, 67, 2]);
  await act(async () => state().undo());
  check('撤销第二次拖动保留第一次的磁吸结果', [state().project.beats[0].boardX, state().project.beats[0].boardY, state().past.length], [560, 47, 1]);
  // React delegates wheel as passive. Canvas cancellation must actually take
  // effect through a non-passive listener, while text controls keep native
  // scrolling. A handler merely calling preventDefault is not sufficient.
  await mount();
  const wheelProject = state().project, wheelHistory = history();
  const sendWheel = async (target, deltaY = 120, clientX = 300, clientY = 200) => {
    const event = new h.w.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, clientX, clientY });
    const cancelledAt = [];
    const preventDefault = event.preventDefault;
    event.preventDefault = function () { cancelledAt.push(this.currentTarget); return preventDefault.call(this); };
    await h.dispatch(target, event);
    return { event, cancelledAt };
  };
  const firstWheel = await sendWheel(canvas());
  check('画布wheel确实取消原生滚动默认行为', firstWheel.event.defaultPrevented, true);
  check('画布wheel只在自己的原生监听器取消默认，绝不在React passive根监听器取消', firstWheel.cancelledAt, [canvas()]);
  const firstBoard = state().writingContext.board;
  // 按滚动量连续缩放：滚轮一格（deltaY 120）约缩小 13%，而不是每个事件固定跳 10%。
  check('wheel按滚动量连续缩放并保持鼠标世界坐标锚点', [Math.abs(firstBoard.zoom - Math.exp(-120 * .0012)) < 1e-12,
    Math.round((300 - firstBoard.panX) / firstBoard.zoom * 1e9) / 1e9, Math.round((200 - firstBoard.panY) / firstBoard.zoom * 1e9) / 1e9], [true, 300, 200]);
  check('wheel后画布不以原生scroll偏移且不修改工程历史',
    [canvas().scrollLeft, canvas().scrollTop, state().project, history()], [0, 0, wheelProject, wheelHistory]);
  await sendWheel(canvas(), -120, 300, 200);
  check('反向滚动同样幅度回到原比例，保留原世界坐标锚点',
    Math.abs(state().writingContext.board.zoom - 1) < 1e-12 &&
    Math.abs((300 - state().writingContext.board.panX) / state().writingContext.board.zoom - 300) < 1e-10 &&
    Math.abs((200 - state().writingContext.board.panY) / state().writingContext.board.zoom - 200) < 1e-10);

  // 触控板捏合（ctrlKey）一次只给几个像素的 delta，每个事件只缩放几个百分点。
  for (let i = 0; i < 5; i++) await h.dispatch(canvas(), new h.w.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 4, ctrlKey: true, clientX: 300, clientY: 200 }));
  check('触控板捏合5次细小缩放共约18%，不再一下跳到最小', Math.round(state().writingContext.board.zoom * 1000) / 1000, Math.round(Math.exp(-20 * .01) * 1000) / 1000);
  const zoomField = () => q('input[aria-label="自由板缩放比例"]');
  const typeZoom = async (value, finish) => {
    await act(async () => { zoomField().focus(); });
    await input(zoomField(), value);
    await key(zoomField(), finish);
  };
  check('缩放比例显示为可输入的百分数', zoomField().value, String(Math.round(state().writingContext.board.zoom * 100)));
  const zoomProject = state().project, zoomHistory = history();
  await typeZoom('150', 'Enter');
  check('输入150回车后缩放到150%', [state().writingContext.board.zoom, zoomField().value], [1.5, '150']);
  await typeZoom('80%', 'Enter');
  check('带百分号输入也能识别', [state().writingContext.board.zoom, zoomField().value], [.8, '80']);
  await typeZoom('999', 'Enter');
  check('超出范围的比例自动限制在40%–200%', [state().writingContext.board.zoom, zoomField().value], [2, '200']);
  await typeZoom('55', 'Escape');
  check('Esc放弃输入，保持原比例', [state().writingContext.board.zoom, zoomField().value], [2, '200']);
  await typeZoom('abc', 'Enter');
  check('无效输入不改变比例并恢复显示', [state().writingContext.board.zoom, zoomField().value], [2, '200']);
  check('改缩放比例不写工程、不进撤销历史', [state().project, history()], [zoomProject, zoomHistory]);
  await click(q('button[aria-label="缩小自由板"]'));
  check('−按钮后输入框同步显示新比例', zoomField().value, '190');

  await pressCard('b1');
  await mouse(title('b2'), 'dblclick');
  const nestedEditor = document.createElement('div');
  nestedEditor.setAttribute('contenteditable', 'true');
  nestedEditor.innerHTML = '<span><em>合成嵌套编辑文字</em></span>';
  canvas().appendChild(nestedEditor);
  const nativeWheelTargets = [card('s1').querySelector('[data-rich-note]'), titleInput('b2'),
    nestedEditor.querySelector('em'), q('.board__dock button')];
  for (const target of nativeWheelTargets) {
    const beforeWheel = state().writingContext, beforeTransform = q('.board__world').style.transform;
    const result = await sendWheel(target);
    check(`${target.tagName}的wheel保留原生滚动且不调用被动取消`, [result.event.defaultPrevented, result.cancelledAt.length], [false, 0]);
    check(`${target.tagName}及嵌套编辑区域wheel不缩放画布`,
      [state().writingContext, q('.board__world').style.transform], [beforeWheel, beforeTransform]);
  }
  nestedEditor.remove();
  await key(titleInput('b2'), 'Escape');
  const oldCanvas = canvas();
  await mount();
  const detachedWheel = await sendWheel(oldCanvas);
  check('卸载时移除原生wheel监听器，旧画布不再取消事件或修改新工程',
    [detachedWheel.event.defaultPrevented, detachedWheel.cancelledAt.length, state().writingContext.board], [false, 0, undefined]);
  check('无React/window运行错误', h.errors, []);
  console.log(`\n自由板工作区交互专项：${count} 条通过。jsdom事件/state覆盖；真实鼠标、视觉、原生输入法仍需单独验收。`);
})().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; }).finally(async () => { if (h) await h.close(); });
