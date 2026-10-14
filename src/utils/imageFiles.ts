/** 写作页和自由板共用的本地图片读取：拖入、右键新建、菜单新建都走这里。 */

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || (!file.type && /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name));
}

export function hasDraggedFiles(dataTransfer: DataTransfer | null): boolean {
  return !!dataTransfer && Array.from(dataTransfer.types).includes('Files');
}

/** 读成 data URL，并确认浏览器真的能解码，避免生成一张空白的坏图卡片。 */
export function readImageFile(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取失败'));
    reader.onabort = () => reject(new Error('读取中断'));
    reader.onload = () => {
      const data = String(reader.result || '');
      const decoded = new Image();
      decoded.onload = () => resolve(data);
      decoded.onerror = () => reject(new Error('图片无法解码'));
      decoded.src = data;
    };
    reader.readAsDataURL(file);
  });
}

/** 打开系统文件选择框选一张图片；取消时得到 null。 */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export const imageTitle = (file: File) => file.name.replace(/\.[^.]+$/, '') || '图片素材';
