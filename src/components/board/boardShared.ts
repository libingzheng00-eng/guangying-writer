import type React from 'react';
import type { ResizableKind } from '../../model/board';
import type { BoardCardPosition } from '../../model/boardWorkspace';

/** 卡片在世界坐标里的位置与尺寸（显示用，不写回工程）。 */
export interface Layout extends BoardCardPosition { w: number; h: number; kind: ResizableKind }

export const stopMouse = (event: React.MouseEvent) => event.stopPropagation();
export const stopWheel = (event: React.WheelEvent) => event.stopPropagation();
