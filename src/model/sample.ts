import type { ScriptProject } from './types';
import { defaultSettings, newElement, emptyTitlePage } from './project';
import { uid } from '../utils/id';
import { DEFAULT_REVISIONS } from './elements';

type Row = [Parameters<typeof newElement>[0], string];

export function sampleProject(): ScriptProject {
  const rows: Row[] = [
    ['act', '第一幕'],
    ['scene_heading', '外景 老城区胡同 晨'],
    ['action', '薄雾还没散。青灰的砖墙上一层湿意，自行车铃声从巷子深处荡过来。'],
    ['action', '林小满（26岁，背着一只磨破边的帆布包）停在院门口，抬头看门牌——「槐树胡同 7 号」。'],
    ['character', '林小满'],
    ['parenthetical', '（自言自语）'],
    ['dialogue', '就是这儿了。'],
    ['action', '她抬手敲门。门内传出一阵拖鞋踢踏声。'],
    ['character', '陈师傅（画外）'],
    ['dialogue', '来啦来啦——别敲了，门轴都要散了。'],
    ['action', '门开了一条缝。陈师傅（68岁）眯着眼打量她。'],
    ['character', '陈师傅'],
    ['dialogue', '你找谁？'],
    ['character', '林小满'],
    ['dialogue', '我找周奶奶。我是她孙女的朋友，来取一样东西。'],
    ['action', '陈师傅的手在门把上顿了一下。'],
    ['character', '陈师傅'],
    ['dialogue', '你来晚了。'],
    ['transition', '切至：'],

    ['scene_heading', '内景 周奶奶家 客厅 日'],
    ['action', '屋里很暗。八仙桌上摆着一只落了灰的座钟，钟摆早就停了。'],
    ['action', '林小满站在门口，没敢往里走。'],
    ['character', '陈师傅'],
    ['dialogue', '上周三走的。走得急，没受罪。'],
    ['action', '他从抽屉里取出一个牛皮纸信封，放在桌上，没有递过去。'],
    ['character', '陈师傅'],
    ['dialogue', '她交代过，这东西得你自己来拿，我不能代转。'],
    ['character', '林小满'],
    ['parenthetical', '（声音发紧）'],
    ['dialogue', '她……有说什么吗？'],
    ['action', '陈师傅摇头，转身去灶间。水壶开始响。'],
    ['character', '陈师傅'],
    ['dialogue', '只说，等一个姓林的女孩子。说她会问起四十年前的事。'],
    ['action', '林小满的手指停在信封上。信封右下角，有一行褪色的钢笔字：「给小满」。'],
    ['transition', '切至：'],

    ['scene_heading', '外景 胡同口 黄昏'],
    ['action', '夕阳把整条胡同染成橘红色。林小满抱着信封走出院门，站在槐树下，很久没有动。'],
    ['shot', '特写 -'],
    ['action', '信封被拆开。里面是一张黑白照片：年轻的周奶奶站在一个屋顶上，旁边是一个看不清脸的男人。'],
    ['character', '林小满'],
    ['parenthetical', '（低声）'],
    ['dialogue', '原来你早就认识他。'],
    ['action', '风起，槐树叶哗啦啦响。她抬头——'],
    ['character', '林小满'],
    ['dialogue', '我知道下一步该去哪了。'],
    ['transition', '淡出。'],
  ];

  const elements = rows.map(([type, text]) => newElement(type, text));

  const settings = defaultSettings();
  const beats = [
    { id: uid('bt'), text: '核心悬念：四十年前的照片里那个男人是谁？', color: '#FCEBEB', x: 40, y: 40 },
    { id: uid('bt'), text: '母题：槐树 / 信封 —— 贯穿全片的信物', color: '#FAEEDA', x: 320, y: 60 },
    { id: uid('bt'), text: '第二幕情绪走向：克制 → 揭示 → 留白', color: '#E6F1FB', x: 600, y: 40 },
    { id: uid('bt'), text: '主题：有些答案要等「对的人」自己来取', color: '#EAF3DE', x: 300, y: 320 },
    { id: uid('bt'), text: '转场灵感：用座钟停摆呼应时间凝固', color: '#FBEAF0', x: 640, y: 340 },
  ];
  return {
    id: uid('p'),
    name: '示例剧本《槐树胡同》',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    titlePage: {
      ...emptyTitlePage(),
      title: '槐树胡同',
      subtitle: '第一稿',
      author: '编剧名',
      basedOn: '原创剧本',
      version: '2026-09',
      show: true,
    },
    elements,
    sceneMeta: [],
    beats,
    acts: [
      { id: 'act-1', title: '第一幕', color: '#cfe4ff' },
      { id: 'act-2', title: '第二幕', color: '#ffd9e0' },
      { id: 'act-3', title: '第三幕', color: '#fff0b8' },
    ],
    revisions: DEFAULT_REVISIONS.map((r) => ({ ...r })),
    settings,
  };
}
