import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { ReportDocument } from '@crm/contracts';
import { reportDocumentsKey } from '../api/hooks';
import { DocumentsLibrary } from './documents-library';
import { useDocumentUploader } from './use-document-uploader';
import { html } from './test-utils';

const doc = (over: Partial<ReportDocument>): ReportDocument => ({
  id: '6b1b4a52-0d11-4cf6-9e0a-2d9f6b8a1c01',
  name: 'plan.pdf',
  extension: 'pdf',
  mime: 'application/pdf',
  sizeBytes: 2 * 1024 * 1024,
  charCount: 1500,
  truncated: false,
  status: 'ready',
  failureReason: null,
  createdAt: '2026-10-08T10:00:00.000Z',
  ...over,
});

function Harness({ canManage }: { canManage: boolean }) {
  const uploader = useDocumentUploader('workspace', canManage);
  return <DocumentsLibrary scope="workspace" canManage={canManage} uploader={uploader} />;
}

function render(docs: ReportDocument[] | undefined, canManage: boolean) {
  const qc = new QueryClient();
  if (docs) qc.setQueryData(reportDocumentsKey('workspace'), { data: docs, limit: 25 });
  return html(
    <QueryClientProvider client={qc}>
      <Harness canManage={canManage} />
    </QueryClientProvider>,
  );
}

describe('DocumentsLibrary', () => {
  it('shows the accepted types and the size limit from the shared contract', () => {
    const out = render([], true);
    expect(out).toContain('pdf, docx, txt, md, csv, html, htm, json');
    expect(out).toContain('Up to 10 MB each, 25 documents');
  });

  it('shows an empty state when there are no documents', () => {
    expect(render([], true)).toContain('No documents yet');
  });

  it('lists each document with its status, the reason a file failed and the long-file note', () => {
    const out = render(
      [
        doc({}),
        doc({
          id: '2b1b4a52-0d11-4cf6-9e0a-2d9f6b8a1c02',
          name: 'scan.pdf',
          status: 'failed',
          failureReason: 'No text found',
        }),
        doc({
          id: '3b1b4a52-0d11-4cf6-9e0a-2d9f6b8a1c03',
          name: 'big.txt',
          extension: 'txt',
          truncated: true,
        }),
      ],
      true,
    );
    expect(out).toContain('plan.pdf');
    expect(out).toContain('Ready');
    expect(out).toContain('Could not read');
    expect(out).toContain('No text found');
    expect(out).toContain('Long file: only the first 400,000 characters are used.');
    expect(out).toContain('3 of 25 documents');
    expect(out).toContain('2 MB');
  });

  it('lets a manager add and delete', () => {
    const out = render([doc({})], true);
    expect(out).toContain('Choose file');
    expect(out).toContain('data-testid="report-file-input"');
    expect(out).toContain('aria-label="Delete plan.pdf"');
  });

  it('gives a viewer the list without the upload box or the delete buttons', () => {
    const out = render([doc({})], false);
    expect(out).toContain('plan.pdf');
    expect(out).toContain('You can see the library but not change it.');
    expect(out).not.toContain('Choose file');
    expect(out).not.toContain('Delete plan.pdf');
  });

  it('shows a spinner while the library loads', () => {
    expect(render(undefined, true)).toContain('role="status"');
  });
});
