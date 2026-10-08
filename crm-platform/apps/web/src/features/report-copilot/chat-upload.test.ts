import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The chat's "+" menu is wired in report-workbench.tsx; this guards the wiring that cannot be rendered without a browser. */
const src = readFileSync(join(__dirname, 'components/report-workbench.tsx'), 'utf8');

describe('the chat "+" menu', () => {
  it("opens the library's file picker through the chat input's onAddFile slot", () => {
    expect(src).toMatch(/useMemo\(\(\) => \(\{ onAddFile: pickFiles \}\)/);
    expect(src).toContain('input={chatInput}');
  });

  it('never turns on CopilotKit attachments, so no file is sent to the model as a message part', () => {
    expect(src).not.toMatch(/attachments\s*=\s*\{/);
    expect(src).not.toMatch(/<CopilotChat[^>]*\battachments\b/);
  });

  it('sends picked files through the library uploader (same hook and checks as the Documents panel), one list for both', () => {
    expect(src).toContain('useDocumentUploader(scope, canManage)');
    expect(src).toContain('uploader.add(files)');
    expect(src.match(/uploader=\{uploader\}/g)).toHaveLength(2);
  });

  it('only accepts the extensions the library accepts, and can pick several files', () => {
    expect(src).toContain('REPORT_DOCUMENT_EXTENSIONS.map');
    expect(src).toMatch(/type="file"\s+multiple/);
  });

  it('tells the assistant how many documents there are and which, from the list the upload refreshes', () => {
    expect(src).toContain('libraryDocuments: docs.data?.data.length');
    expect(src).toContain('libraryDocumentNames');
  });
});
