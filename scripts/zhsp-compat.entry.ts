/**
 * scripts/zhsp-compat.entry.ts
 *
 * 仅为 scripts/zhsp-compat-test.cjs 打包导出的小入口。
 * 不参与运行时构建。
 */
export { parseProject, serializeProject } from '../src/io/zhsp';
export { defaultSettings, createProject } from '../src/model/project';
export type { ScriptProject } from '../src/model/types';
export {
  sceneEndpoint,
  beatEndpoint,
  cardEndpoint,
  FALLBACK_CARD_W,
  FALLBACK_SCENE_H,
  FALLBACK_BEAT_H,
} from '../src/model/board';
