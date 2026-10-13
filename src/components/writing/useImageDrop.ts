import React, { useState } from 'react';
import { useStore } from '../../store/store';
import { hasDraggedFiles, imageTitle, isImageFile, readImageFile } from '../../utils/imageFiles';

/** 写作面板接管本地图片拖入：生成图片卡，绝不把图片插进正文。 */
export function useImageDrop(scrollRef: React.RefObject<HTMLDivElement>) {
  const [active, setActive] = useState(false);
  // 核心红线：本地图片拖入由写作面板接管，不得落入 contentEditable 正文。
  // .editor 才是滚动容器，内层 bounds.top 已包含滚动偏移，不能再加 scrollTop。
  const onDropCapture = async (event: React.DragEvent<HTMLDivElement>) => {
    setActive(false);
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const images = Array.from(event.dataTransfer.files).filter(isImageFile);
    if (!images.length) {
      useStore.getState().notify('请拖入本地图片文件（如 PNG、JPEG 或 WebP）。', 'error');
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const maxX = Math.max(16, bounds.width - 290 - 16);
    const x = Math.max(16, Math.min(maxX, Math.round(event.clientX - bounds.left - 145)));
    const viewport = scrollRef.current!.getBoundingClientRect();
    const y = Math.max(16, Math.min(viewport.bottom - bounds.top - 100, Math.round(event.clientY - bounds.top - 22)));
    const documentAtDrop = useStore.getState().documentEpoch;
    for (const [index, image] of images.entries()) {
      try {
        const img = await readImageFile(image);
        // 读取期间切换工程时，不能把上一份工程的图片写进新工程。
        if (useStore.getState().documentEpoch !== documentAtDrop) return;
        useStore.getState().addBeat(Math.min(maxX, x + index * 20), y, '', 'image', {
          title: imageTitle(image), img,
        });
      } catch {
        if (useStore.getState().documentEpoch !== documentAtDrop) return;
        useStore.getState().notify(`无法读取图片“${image.name}”，请尝试有效的 PNG、JPEG 或 WebP 文件。`, 'error');
      }
    }
  };

  const onDragOverCapture = (event: React.DragEvent<HTMLDivElement>) => {
    if (hasDraggedFiles(event.dataTransfer)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setActive(true);
    }
  };
  const onDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false);
  };
  return { active, onDragOverCapture, onDragLeave, onDropCapture };
}
