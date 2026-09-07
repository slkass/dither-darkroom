// History stores immutable document metadata, never rendered pixels or image blobs.
export function createHistory(document, label = '打开图片') {
  return {
    entries: [{ document, label }],
    cursor: 0,
    draft: null,
    draftLabel: '',
  };
}
export const currentDocument = (history) =>
  history.draft ?? history.entries[history.cursor].document;
export function stageHistory(history, document, label) {
  return { ...history, draft: document, draftLabel: label };
}
export function commitHistory(history) {
  if (!history.draft) return history;
  if (
    JSON.stringify(history.draft) ===
    JSON.stringify(history.entries[history.cursor].document)
  )
    return { ...history, draft: null, draftLabel: '' };
  const entries = history.entries.slice(0, history.cursor + 1);
  entries.push({ document: history.draft, label: history.draftLabel });
  return { entries, cursor: entries.length - 1, draft: null, draftLabel: '' };
}
export function jumpHistory(history, cursor) {
  const committed = commitHistory(history);
  return {
    ...committed,
    cursor: Math.max(0, Math.min(committed.entries.length - 1, cursor)),
    draft: null,
    draftLabel: '',
  };
}
export function moveNode(document, id, delta) {
  const nodes = [...document.nodes],
    index = nodes.findIndex((node) => node.id === id),
    target = index + delta;
  if (index < 0 || target < 0 || target >= nodes.length) return document;
  [nodes[index], nodes[target]] = [nodes[target], nodes[index]];
  return { ...document, nodes };
}
/** @param {string | null} beforeId */
export function reorderNode(document, id, beforeId = null) {
  if (id === beforeId || !document.nodes.some((node) => node.id === id))
    return document;
  if (beforeId !== null && !document.nodes.some((node) => node.id === beforeId))
    return document;
  const item = document.nodes.find((node) => node.id === id),
    nodes = document.nodes.filter((node) => node.id !== id);
  const index =
    beforeId === null
      ? nodes.length
      : nodes.findIndex((node) => node.id === beforeId);
  nodes.splice(index, 0, item);
  if (nodes.every((node, index) => node === document.nodes[index]))
    return document;
  return { ...document, nodes };
}
