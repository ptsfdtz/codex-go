import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWebModule } from './load-web-module.mjs';
const { toolPresentation } = await loadWebModule('features/activity/tool-presentation');
test('native skill reads are distinct from shell text mentioning skills', () => {
  const item = {
    type: 'commandExecution',
    status: 'completed',
    commandActions: [{ type: 'read', path: 'C:\\skills\\imagegen\\SKILL.md' }],
  };
  assert.equal(toolPresentation(item).kind, 'skill');
  assert.equal(toolPresentation(item).name, 'imagegen');
  assert.equal(
    toolPresentation({ ...item, commandActions: [], command: 'echo SKILL.md' }).kind,
    undefined,
  );
  assert.equal(toolPresentation({ ...item, exitCode: 1 }).status, 'failed');
});
test('plugin/MCP results preserve text, structured output, progress and failure', () => {
  const item = {
    type: 'mcpToolCall',
    server: 'docs',
    tool: 'search',
    pluginId: 'docs-plugin',
    appContext: { appName: 'Docs', actionName: 'Search' },
    status: 'completed',
    output: 'Searching',
    result: {
      content: [
        { type: 'text', text: 'Found it' },
        { type: 'resource', resource: { text: 'Resource text' } },
        { type: 'image', data: 'secret-base64' },
      ],
      structuredContent: { count: 2 },
    },
  };
  const result = toolPresentation(item);
  assert.equal(result.kind, 'plugin');
  assert.equal(result.name, 'Docs · Search');
  assert.equal(result.output, 'Found it\n\nResource text');
  assert.equal(result.media, 1);
  assert.deepEqual(result.structured, { count: 2 });
  assert.equal(result.progress, 'Searching');
  assert(!result.output.includes('base64'));
  assert.equal(toolPresentation({ ...item, pluginId: null, appContext: null }).kind, 'mcp');
  assert.equal(toolPresentation({ ...item, result: { isError: true } }).status, 'failed');
});
test('dynamic tool output and running/unknown states are not reported as success', () => {
  const item = {
    type: 'dynamicToolCall',
    tool: 'imagegen',
    namespace: 'images',
    status: 'inProgress',
    contentItems: [{ type: 'inputText', text: 'Preparing' }],
  };
  assert.equal(toolPresentation(item).output, 'Preparing');
  assert.equal(toolPresentation(item).status, 'running');
  assert.equal(toolPresentation({ ...item, status: undefined }).status, 'unknown');
  assert.equal(toolPresentation({ ...item, status: 'completed', success: false }).status, 'failed');
});
