import type { Root } from 'mdast';

type AstNode = { type: string; value?: string; depth?: number; ordered?: boolean; spread?: boolean; children?: AstNode[] };

export function normalizeMarkdown(source: string) {
  return source
    .replace(/\\\|/g, '|')
    .replace(/\\?<br\s*\/?>/gi, '<br>')
    .replace(/\\r\\n|\\n/g, '\n')
    .replace(/\r\n?/g, '\n');
}

function plainText(node: AstNode): string {
  if (node.type === 'break') return '\n';
  if (typeof node.value === 'string') return node.value;
  if (!Array.isArray(node.children)) return '';
  return node.children.map(plainText).join('');
}

function cellItems(children: AstNode[]): string[] {
  const source = children.map((child) => child.type === 'break' ? '\n' : plainText(child)).join('');
  return source.split(/\n|•\s*/g).map((line) => line.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean);
}

function weeklyTableToSections(table: AstNode): AstNode[] | null {
  const header = table.children?.[0]?.children || [];
  const headings = header.map(plainText);
  const weekIndex = headings.findIndex((value) => /week|session|phase|day/i.test(value));
  const activityIndices = headings.map((value, index) => /activit|milestone|task|topic|agenda|learning/i.test(value) ? index : -1).filter((index) => index >= 0);
  if (weekIndex < 0 || activityIndices.length === 0) return null;

  const sections: AstNode[] = [];
  for (const row of (table.children || []).slice(1)) {
    const cells = row.children || [];
    const weekCell = cells[weekIndex];
    if (!weekCell) continue;
    sections.push({ type: 'heading', depth: 3, children: weekCell.children || [{ type: 'text', value: plainText(weekCell) }] });
    const items = activityIndices.flatMap((index) => cells[index] ? cellItems(cells[index].children || []) : []);
    if (items.length) sections.push({
      type: 'list', ordered: false, spread: false,
      children: items.map((value) => ({ type: 'listItem', spread: false, children: [{ type: 'paragraph', children: [{ type: 'text', value }] }] })),
    });
    const otherCells = cells.map((cell, index) => ({ cell, index })).filter(({ index }) => index !== weekIndex && !activityIndices.includes(index));
    for (const { cell, index } of otherCells) {
      if (cell && plainText(cell).trim()) sections.push({ type: 'paragraph', children: [
        { type: 'strong', children: [{ type: 'text', value: `${headings[index] || 'Details'}: ` }] },
        ...(cell.children || []),
      ] });
    }
  }
  return sections;
}

function replaceBreakMarkers(node: AstNode) {
  if (!Array.isArray(node.children)) return;
  const next: AstNode[] = [];
  for (const child of node.children) {
    if (child.type === 'html' && /^\s*<br\s*\/?>\s*$/i.test(child.value || '')) {
      next.push({ type: 'break' });
      continue;
    }
    if (child.type === 'text' && /<br\s*\/?>/i.test(child.value || '')) {
      const chunks = String(child.value).split(/(<br\s*\/?>)/gi);
      chunks.forEach((chunk) => {
        if (/^<br\s*\/?>$/i.test(chunk)) next.push({ type: 'break' });
        else if (chunk) next.push({ ...child, value: chunk.replace(/\\</g, '<') });
      });
      continue;
    }
    replaceBreakMarkers(child);
    next.push(child);
  }
  node.children = next;
}

function rewriteTables(parent: AstNode) {
  if (!Array.isArray(parent.children)) return;
  const next: AstNode[] = [];
  for (const child of parent.children) {
    if (child.type === 'table') {
      const sections = weeklyTableToSections(child);
      if (sections) { next.push(...sections); continue; }
    }
    rewriteTables(child);
    next.push(child);
  }
  parent.children = next;
}

function academicMarkdownPlugin() {
  return (tree: Root) => {
    const root = tree as unknown as AstNode;
    replaceBreakMarkers(root);
    rewriteTables(root);
  };
}

export const markdownPlugins = [academicMarkdownPlugin];

export type DocumentBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; rows: string[][] };

function blocksFromAst(tree: Root): DocumentBlock[] {
  const root = tree as unknown as AstNode;
  const blocks: DocumentBlock[] = [];
  for (const node of root.children || []) {
    if (node.type === 'heading') blocks.push({ type: 'heading', level: node.depth || 2, text: plainText(node).trim() });
    else if (node.type === 'paragraph') blocks.push({ type: 'paragraph', text: plainText(node).trim() });
    else if (node.type === 'list') blocks.push({ type: 'list', ordered: Boolean(node.ordered), items: (node.children || []).map(plainText).map((text) => text.trim()).filter(Boolean) });
    else if (node.type === 'table') blocks.push({ type: 'table', rows: (node.children || []).map((row) => (row.children || []).map((cell) => plainText(cell).trim())) });
    else if (node.type === 'blockquote') blocks.push({ type: 'paragraph', text: plainText(node).trim() });
  }
  return blocks;
}

export async function markdownToDocumentBlocks(source: string): Promise<DocumentBlock[]> {
  const { unified } = await import('unified');
  const remarkParse = (await import('remark-parse')).default;
  const remarkGfm = (await import('remark-gfm')).default;
  const processor = unified().use(remarkParse).use(remarkGfm).use(academicMarkdownPlugin);
  const parsed = processor.runSync(processor.parse(normalizeMarkdown(source))) as Root;
  return blocksFromAst(parsed);
}
