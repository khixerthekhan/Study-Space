import React from 'react';
import { Document as WordDocument, HeadingLevel, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { Document as PdfDocument, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { markdownToDocumentBlocks } from '@/lib/markdown';

type Source = { title: string; url: string };

const pdfStyles = StyleSheet.create({
  page: { paddingTop: 52, paddingBottom: 52, paddingHorizontal: 54, fontFamily: 'Helvetica', fontSize: 10, color: '#202938', lineHeight: 1.5 },
  title: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: '#243b73', marginBottom: 10 },
  h1: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: '#243b73', marginTop: 16, marginBottom: 7 },
  h2: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#243b73', marginTop: 13, marginBottom: 6 },
  h3: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#243b73', marginTop: 10, marginBottom: 5 },
  paragraph: { marginBottom: 7 },
  bullet: { marginLeft: 14, marginBottom: 4 },
  table: { marginTop: 6, marginBottom: 12, borderWidth: 1, borderColor: '#cbd5e1' },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#cbd5e1' },
  cell: { flexGrow: 1, flexBasis: 0, padding: 6, borderRightWidth: 1, borderRightColor: '#cbd5e1' },
  headerCell: { backgroundColor: '#e9eef9', fontFamily: 'Helvetica-Bold' },
  source: { color: '#2854a1', marginBottom: 5, fontSize: 9 },
});

function makePdfBlock(block: Awaited<ReturnType<typeof markdownToDocumentBlocks>>[number], index: number) {
  if (block.type === 'heading') return <Text key={index} style={block.level <= 1 ? pdfStyles.h1 : block.level === 2 ? pdfStyles.h2 : pdfStyles.h3} minPresenceAhead={24}>{block.text}</Text>;
  if (block.type === 'paragraph') return <Text key={index} style={pdfStyles.paragraph}>{block.text}</Text>;
  if (block.type === 'list') return <View key={index} style={{ marginBottom: 7 }}>{block.items.map((item, itemIndex) => <Text key={itemIndex} style={pdfStyles.bullet}>{block.ordered ? `${itemIndex + 1}. ` : '• '}{item}</Text>)}</View>;
  return <View key={index} style={pdfStyles.table} wrap>
    {block.rows.map((row, rowIndex) => <View key={rowIndex} style={pdfStyles.row} wrap={false}>
      {row.map((cell, cellIndex) => <Text key={cellIndex} style={[pdfStyles.cell, ...(rowIndex === 0 ? [pdfStyles.headerCell] : [])]}>{cell}</Text>)}
    </View>)}
  </View>;
}

export async function createStudyDocument(format: 'docx' | 'pdf', title: string, markdown: string, sources: Source[]) {
  const blocks = await markdownToDocumentBlocks(markdown);
  if (format === 'pdf') {
    const body = blocks.map(makePdfBlock);
    const sourceBlocks = sources.length ? [
      <Text key="sources-heading" style={pdfStyles.h2}>Sources</Text>,
      ...sources.map((source, index) => <Text key={`source-${index}`} style={pdfStyles.source}>{index + 1}. {source.title} — {source.url}</Text>),
    ] : [];
    const element = <PdfDocument title={title} author="StudySpace AI"><Page size="A4" style={pdfStyles.page}>
      <Text style={pdfStyles.title}>{title}</Text>
      {body}{sourceBlocks}
    </Page></PdfDocument>;
    return new Uint8Array(await renderToBuffer(element));
  }

  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { after: 180 } }),
  ];
  for (const block of blocks) {
    if (block.type === 'heading') {
      const heading = block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      children.push(new Paragraph({ text: block.text, heading, keepNext: true, spacing: { before: 180, after: 90 } }));
    } else if (block.type === 'paragraph') {
      children.push(new Paragraph({ text: block.text, spacing: { after: 100 }, widowControl: true }));
    } else if (block.type === 'list') {
      block.items.forEach((item) => children.push(new Paragraph({ text: item, ...(block.ordered ? { numbering: { reference: 'ordered-list', level: 0 } } : { bullet: { level: 0 } }), spacing: { after: 60 }, widowControl: true })));
    } else {
      const columnCount = Math.max(1, ...block.rows.map((row) => row.length));
      const rows = block.rows.map((row, rowIndex) => new TableRow({
        tableHeader: rowIndex === 0,
        children: Array.from({ length: columnCount }, (_, index) => new TableCell({
          width: { size: Math.floor(100 / columnCount), type: WidthType.PERCENTAGE },
          shading: rowIndex === 0 ? { type: ShadingType.CLEAR, fill: 'E9EEF9' } : undefined,
          margins: { top: 90, bottom: 90, left: 100, right: 100 },
          children: String(row[index] || '').split('\n').map((line) => new Paragraph({ children: [new TextRun({ text: line, bold: rowIndex === 0 })], spacing: { after: 40 } })),
        })),
      }));
      children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: Array(columnCount).fill(Math.floor(9000 / columnCount)) }));
      children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
    }
  }
  if (sources.length) {
    children.push(new Paragraph({ text: 'Sources', heading: HeadingLevel.HEADING_2, keepNext: true }));
    sources.forEach((source, index) => children.push(new Paragraph({ text: `${index + 1}. ${source.title} — ${source.url}`, spacing: { after: 80 } })));
  }
  const document = new WordDocument({ numbering: { config: [{ reference: 'ordered-list', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: 'left' }] }] }, sections: [{ properties: { page: { margin: { top: 1100, right: 1100, bottom: 1100, left: 1100 } } }, children }] });
  return new Uint8Array(await Packer.toBuffer(document));
}
