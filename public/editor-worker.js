importScripts('/processor.js?v=4', '/studio-filters.js?v=4');
const studioAssets = new Map();
let studioQueue = Promise.resolve();
self.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'asset') {
    studioAssets.set(message.assetId, message.bitmap);
    self.postMessage({ type: 'asset', assetId: message.assetId });
    return;
  }
  if (message.type === 'release-unused-asset') {
    studioAssets.get(message.assetId)?.close();
    studioAssets.delete(message.assetId);
    return;
  }
  // Serialize jobs across JPEG awaits. Every response belongs to its captured document.
  studioQueue = studioQueue.then(async () => {
    try {
      const result = await Studio.render(
        message.document,
        studioAssets,
        message.maxSize,
      );
      if (message.type === 'export') {
        const blob = await result.canvas.convertToBlob({ type: 'image/png' });
        self.postMessage({
          type: 'export',
          id: message.id,
          blob,
          width: result.canvas.width,
          height: result.canvas.height,
        });
      } else {
        const bitmap = result.canvas.transferToImageBitmap(),
          reference = result.reference.transferToImageBitmap();
        self.postMessage(
          {
            type: 'preview',
            id: message.id,
            revision: message.revision,
            bitmap,
            reference,
            width: bitmap.width,
            height: bitmap.height,
          },
          [bitmap, reference],
        );
      }
    } catch (error) {
      self.postMessage({
        type: 'error',
        job: message.type,
        id: message.id,
        revision: message.revision,
        message: error?.message || '处理失败，请降低导出尺寸后重试。',
      });
    }
  });
};
