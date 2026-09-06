/**
 * scripts/writing.entry.ts
 *
 * 仅为 scripts/writing-test.cjs 打包导出的小入口。
 * 不参与运行时构建。
 */
export { recognizeType, characterForDialogue, contdLabelFor, nextTypeOnTab, nextTypeOnEnter, shouldShowContdSuffix, CONTD_SUFFIX } from '../src/model/flow';
export type { ElementType, ScriptElement, ScriptProject } from '../src/model/types';
