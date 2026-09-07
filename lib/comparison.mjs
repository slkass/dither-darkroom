export function splitAt(clientX, left, width, fallback = 50) {
  if (!Number.isFinite(clientX) || !Number.isFinite(left) || !Number.isFinite(width) || width <= 0) return fallback;
  return Math.max(0, Math.min(100, ((clientX - left) / width) * 100));
}

export function splitByKey(key, current, fast = false) {
  const step = fast ? 10 : 1;
  if (key === 'Home') return 0;
  if (key === 'End') return 100;
  if (key === 'ArrowLeft' || key === 'ArrowDown') return Math.max(0, current - step);
  if (key === 'ArrowRight' || key === 'ArrowUp') return Math.min(100, current + step);
  return current;
}

export function createComparisonDrag(onChange) {
  let activePointer = null;
  const move = event => {
    if (activePointer !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width > 0) onChange(splitAt(event.clientX, rect.left, rect.width));
  };
  const end = event => {
    if (activePointer !== event.pointerId) return;
    activePointer = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return {
    down(event) {
      if (event.button !== 0 || activePointer !== null) return;
      event.preventDefault();
      activePointer = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      move(event);
    },
    move,
    end,
    lost(event) { if (activePointer === event.pointerId) activePointer = null; },
  };
}
