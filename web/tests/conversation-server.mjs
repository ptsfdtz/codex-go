// Test-only HTTP/Bridge adapter for the real App. Optional saved history comes
// from public Codex APIs, stays local and is never bundled into production.
import { build, preview } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function startConversationServer({
  actualFile,
  cacheDir,
  port = 0,
  allowMutations = false,
} = {}) {
  const actual = actualFile ? JSON.parse(readFileSync(actualFile, 'utf8')) : undefined;
  const entry = (id, text, type = 'agentMessage') => ({
    turnId: 'native-turn',
    item: { id, text, type },
  });
  const latest = [
    entry('question', '展示 Markdown 和工具结果', 'userMessage'),
    entry(
      'answer',
      '# 本地验收\n\n**加粗**与 `inline code`\n\n```js\nconst answer = 42;\n```\n\n|列一|列二|\n|---|---|\n|A|B|\n\n[危险链接](javascript:alert(1))\n\n![远程图片](https://example.invalid/private.png)\n\n<script>unsafe</script>',
    ),
    {
      turnId: 'native-turn',
      item: {
        id: 'tool',
        type: 'commandExecution',
        status: 'completed',
        command:
          '"C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe" -Command \'local acceptance command\'',
        aggregatedOutput: 'bounded tool output\n'.repeat(1500),
      },
    },
  ];
  const state = {
    blocked: false,
    delay: false,
    pending: [],
    extra: [],
    rpc: [],
    actual: !!actual,
    failTurn: false,
    queue: [],
    goal: { objective: 'Controlled goal', status: 'paused', tokenBudget: 1000 },
    goalActivity: undefined,
    goalActivityError: false,
    goalMutationError: '',
    title: '渲染验收',
    pinned: 0,
    archived: 0,
    skillEnabled: true,
    running: false,
    receiptStatus: 'pending',
    approvals: [],
    events: [],
    replayGap: false,
    delayReplay: false,
    replayPending: [],
    delayOlder: false,
    olderPending: [],
  };
  const featureNames =
    'executionConfigView projectSkillCatalog composerSkills accountSummary sessionManagement sessionHistoryRevert sessionResourceRevision sessionSkillRevision sessionHistoryEvents sessionFork sessionForkAtTurn activeTurnSteering latestUpstreamTurn activeTurnInterruption threadIndexRefresh upstreamHistoryPages sessionImages modelSelection plan goal attachments gitRead projectFileBrowser projectTextPreview projectFileReference skillConfiguration outputDefaultsWrite modelDefaultsWrite sessionCompaction sessionGoalResume sessionGoalClear sessionGoalEdit sessionGoalView nativeQueue nativeQueueStart nativeQueueAttachments nativeQueueSkills nativeQueueResourceEdit'.split(
      ' ',
    );
  const config = {
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    cacheDir,
    base: '/',
    server: { host: '127.0.0.1', port, strictPort: !!port, open: false },
    preview: { host: '127.0.0.1', port, strictPort: !!port, open: false },
    build: { outDir: resolve(cacheDir, 'bundle'), emptyOutDir: true },
    plugins: [
      {
        name: 'local-conversation-acceptance',
        enforce: 'pre',
        resolveId(source, importer) {
          if (
            importer?.replaceAll('\\', '/').endsWith('/src/App.tsx') &&
            ['./cloud', './host-book', './transport/bridge'].includes(source)
          )
            return fileURLToPath(new URL('./conversation-host.ts', import.meta.url));
        },
        transformIndexHtml(html) {
          return html.replace(
            '<body>',
            '<body><div id="test-notice" style="background:#fff0bd;color:#342b15;padding:7px;text-align:center;font:13px system-ui">本地只读验收 · ' +
              (actual ? '真实历史来自 Codex 公开 API' : '受控回归数据') +
              ' · 不发送模型任务</div><style>.shell {height:calc(100dvh - 32px)}</style>',
          );
        },
        configurePreviewServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url !== '/__test_rpc') return next();
            let raw = '';
            for await (const chunk of req) raw += chunk;
            const { action, payload = {} } = JSON.parse(raw);
            state.rpc.push({ action, payload });
            let body;
            const send = (value, status = 200) => {
              res.statusCode = status;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify(value));
            };
            if (action === 'snapshot.get')
              body = {
                cursor: state.events.at(-1)?.eventId || '0',
                projects: actual
                  ? [{ projectId: 'p1', name: 'outsourced-projects' }]
                  : [
                      { projectId: 'p1', name: actual ? 'outsourced-projects' : '项目一' },
                      { projectId: 'p2', name: '项目二' },
                    ],
                sessions: actual
                  ? [
                      {
                        sessionId: 's1',
                        projectId: 'p1',
                        title: actual.thread.name || actual.thread.preview.slice(0, 40),
                      },
                    ]
                  : [
                      {
                        sessionId: 's1',
                        projectId: 'p1',
                        title: actual
                          ? actual.thread.name || actual.thread.preview.slice(0, 40)
                          : state.title,
                        pinned: state.pinned,
                        archived: state.archived,
                        status: 'idle',
                      },
                      { sessionId: 's2', projectId: 'p1', title: '另一会话' },
                      { sessionId: 's3', projectId: 'p2', title: '其他项目会话' },
                    ],
                turns: state.running
                  ? [
                      {
                        turnId: 'local-turn',
                        upstreamTurnId: 'native-turn',
                        sessionId: 's1',
                        status: 'running',
                      },
                    ]
                  : [],
                approvals: state.approvals,
              };
            else if (action === 'system.capabilities')
              body = {
                features: Object.fromEntries(
                  (actual ? ['upstreamHistoryPages', 'sessionImages'] : featureNames).map((key) => [
                    key,
                    true,
                  ]),
                ),
              };
            else if (action === 'models.list')
              body = {
                models: actual
                  ? []
                  : [
                      {
                        id: 'test-model',
                        displayName: 'Test model',
                        supportedReasoningEfforts: ['low', 'high'],
                      },
                    ],
              };
            else if (action === 'system.hello') body = { hostId: 'local' };
            else if (action === '__test_receipt') body = { status: state.receiptStatus };
            else if (action === 'events.replay') {
              if (state.replayGap)
                return send({ error: 'REPLAY_GAP: event retention expired' }, 409);
              const events = state.events
                .filter((event) => BigInt(event.eventId) > BigInt(payload.cursor))
                .slice(0, payload.limit);
              body = {
                events,
                cursor: events.at(-1)?.eventId || payload.cursor,
                more: state.events.some(
                  (event) =>
                    BigInt(event.eventId) > BigInt(events.at(-1)?.eventId || payload.cursor),
                ),
              };
              if (state.delayReplay) {
                state.replayPending.push(() => send(body));
                return;
              }
            } else if (action === 'sessions.history') {
              if (state.blocked && payload.sessionId === 's1')
                return send(
                  { error: 'WORKSPACE_FORBIDDEN: Upstream thread identity or workspace changed' },
                  403,
                );
              body =
                payload.sessionId !== 's1'
                  ? { data: [entry('other', '另一会话的正文')] }
                  : actual
                    ? actual.history
                    : payload.cursor
                      ? {
                          data: Array.from({ length: 30 }, (_, index) =>
                            entry(
                              'old-' + (29 - index),
                              '较早的消息 ' + (29 - index) + '\n\n' + '正文段落。'.repeat(80),
                            ),
                          ),
                        }
                      : { data: [...latest, ...state.extra].reverse(), nextCursor: 'older-page' };
              if (state.delay) {
                state.pending.push(() => send(body));
                return;
              }
              if (payload.cursor && state.delayOlder) {
                state.olderPending.push(() => send(body));
                return;
              }
            } else if (!actual && action === 'sessions.detail')
              body = {
                session: {
                  sessionId: payload.sessionId,
                  title: state.title,
                  status: 'idle',
                  pinned: state.pinned,
                  archived: state.archived,
                },
                turns: state.running
                  ? [
                      {
                        turnId: 'local-turn',
                        upstreamTurnId: 'native-turn',
                        sessionId: 's1',
                        status: 'running',
                      },
                    ]
                  : [],
                events: [],
              };
            else if (!actual && action === 'sessions.goal')
              body = { goal: state.goal, goalRevision: 'a'.repeat(64) };
            else if (!actual && action === 'turn.latest') {
              if (state.goalActivityError)
                return send({ error: 'UPSTREAM_UNAVAILABLE: controlled failure' }, 503);
              body = state.goalActivity || {
                threadStatus: state.running ? 'active' : 'idle',
                turn: {
                  upstreamTurnId: 'native-turn',
                  status: state.running ? 'inProgress' : 'completed',
                },
              };
            } else if (!actual && action === 'turn.active')
              body = {
                sessionId: payload.sessionId,
                upstreamTurnId: state.running ? 'native-turn' : null,
              };
            else if (!actual && action === 'queue.list') body = { data: state.queue };
            else if (!actual && action === 'skills.catalog')
              body = {
                skills: [
                  {
                    id: 'b'.repeat(64),
                    name: 'review-code',
                    displayName: 'Review code',
                    description: 'Read and review project changes',
                    enabled: state.skillEnabled,
                  },
                ],
              };
            else if (!actual && action === 'files.list')
              body = {
                entries: payload.directory
                  ? [{ name: 'nested.txt', path: 'src/nested.txt', kind: 'file', size: 6 }]
                  : [
                      { name: 'src', path: 'src', kind: 'directory' },
                      { name: 'README.md', path: 'README.md', kind: 'file', size: 14 },
                    ],
              };
            else if (!actual && action === 'files.readText')
              body = { text: 'Authorized current file preview' };
            else if (!actual && action === 'files.reference')
              body = { referenceText: '[README.md](README.md)' };
            else if (!actual && action === 'git.status')
              body = {
                available: true,
                files: [{ fileId: 'f1', path: 'src/app.ts', worktree: 'M' }],
              };
            else if (!actual && action === 'git.diff')
              body = { text: '@@ -1 +1 @@\n-before\n+after', binary: false, truncated: false };
            else if (!actual && action === 'settings.execution')
              body = {
                values: { model: 'test-model' },
                userRevision: 'c'.repeat(64),
                sandboxVerified: true,
              };
            else if (!actual && action === 'settings.get') body = { days: 30, maxMiB: 128 };
            else if (!actual && action === 'system.diagnostics')
              body = { status: 'Controlled browser verification', secrets: 'omitted' };
            else if (!actual && action === 'account.status')
              body = { authenticated: true, plan: 'test' };
            else if (!actual && allowMutations) {
              if (action.startsWith('sessions.goal.') && state.goalMutationError)
                return send({ error: state.goalMutationError }, 409);
              if (action === 'turn.interruptActive') state.running = false;
              if (action === 'approvals.decide') state.approvals = [];
              if (action === 'turn.start' && state.failTurn)
                return send({ error: 'OUTCOME_UNKNOWN: controlled disconnect' }, 503);
              if (action === 'sessions.rename') state.title = payload.title;
              if (action === 'sessions.pin') state.pinned = payload.pinned ? 1 : 0;
              if (action === 'sessions.archive') state.archived = 1;
              if (action === 'sessions.restore') state.archived = 0;
              if (action === 'skills.setEnabled') state.skillEnabled = payload.enabled;
              if (action === 'queue.add')
                state.queue.push({
                  id: 'q' + (state.queue.length + 1),
                  input: [
                    { type: 'text', text: payload.text },
                    ...(payload.attachments || []).map((f) => ({ type: 'image', name: f.name })),
                  ],
                  inputRevision: 'd'.repeat(64),
                });
              if (action === 'queue.update') {
                const entry = state.queue.find((e) => e.id === payload.submissionId);
                entry.input = [
                  { type: 'text', text: payload.text },
                  ...entry.input.filter((p) => p.type !== 'text'),
                ];
              }
              if (action === 'queue.reorder')
                state.queue = payload.submissionIds.map((id) =>
                  state.queue.find((e) => e.id === id),
                );
              if (action === 'queue.delete')
                state.queue = state.queue.filter((e) => e.id !== payload.submissionId);
              if (action === 'sessions.goal.edit')
                state.goal = {
                  ...state.goal,
                  objective: payload.objective,
                  ...(payload.tokenBudget ? { tokenBudget: payload.tokenBudget } : {}),
                };
              if (action === 'sessions.goal.clear') state.goal = null;
              if (action === 'sessions.goal.resume') state.goal.status = 'active';
              body =
                action === 'sessions.create'
                  ? { session: { sessionId: 'new-session', projectId: payload.projectId } }
                  : action === 'sessions.fork'
                    ? { session: { sessionId: 'forked', projectId: 'p1' } }
                    : action === 'turn.steer'
                      ? {
                          accepted: true,
                          sessionId: payload.sessionId,
                          upstreamTurnId: payload.expectedTurnId,
                        }
                      : {
                          turn: {
                            turnId: 'local-turn',
                            sessionId: payload.sessionId,
                            status: 'running',
                          },
                        };
            } else return send({ error: '本地验收环境只读，不发送模型任务' }, 403);
            send(body);
          });
        },
      },
    ],
  };
  await build(config);
  const server = await preview(config);
  return {
    vite: { close: () => new Promise((done) => server.httpServer.close(done)) },
    state,
    origin: `http://127.0.0.1:${server.httpServer.address().port}`,
  };
}
