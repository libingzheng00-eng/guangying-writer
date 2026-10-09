import { useStore } from '../store/store';
import { captureTextAnchor, type AnnotationAnchor } from '../model/annotations';
import { searchText } from '../model/search';
import { domText, offsetOf } from '../utils/dom';

/** Captured before a toolbar trigger takes focus. Never persisted with a project. */
export interface ReviewContext {
  documentEpoch: number;
  activeId: string | null;
  writingSelectedIds: string[];
  textAnchor: AnnotationAnchor | null;
  crossBlockSelection: boolean;
  selectionError?: string;
}

export function captureReviewContext(): ReviewContext {
  const state = useStore.getState();
  const result: ReviewContext = {
    documentEpoch: state.documentEpoch,
    activeId: state.activeId,
    writingSelectedIds: [...state.writingSelectedIds],
    textAnchor: null,
    crossBlockSelection: false,
  };
  const selection = window.getSelection();
  if (!selection?.rangeCount) return result;
  const range = selection.getRangeAt(0);
  const blockAt = (node: Node) => (node instanceof Element ? node : node.parentElement)
    ?.closest<HTMLElement>('.script-flow .sc-el--editable');
  const start = blockAt(range.startContainer), end = blockAt(range.endContainer);
  if (!start && !end) return result;
  if (!start || !end || start !== end) {
    result.crossBlockSelection = true;
    result.selectionError = '选区跨越多个段落。请回正文选取单段文字，或明确选择当前段 / 当前场景。';
    return result;
  }
  const element = state.project.elements.find(item => item.id === start.dataset.id);
  if (!element || domText(start) !== searchText(element.text)) {
    result.selectionError = '选中文字与正文尚未同步，请回正文重新选择。';
    return result;
  }
  // A collapsed writing caret still identifies the insertion target. The DOM
  // focus/range can reach a paragraph before its store focus event is applied.
  // Preserve explicit paragraph multi-selection; only refine this target ID.
  if (range.collapsed) {
    result.activeId = element.id;
    return result;
  }
  const from = offsetOf(start, range.startContainer, range.startOffset);
  const to = offsetOf(start, range.endContainer, range.endOffset);
  result.textAnchor = captureTextAnchor(element, from, to);
  if (result.textAnchor) result.activeId = element.id;
  else result.selectionError = '无法确认这段选中文字，请回正文重新选择。';
  return result;
}
