const mobile = {
  'push.approvals': 'Background approval and question alerts',
  'push.taskResults': 'Also notify when tasks finish, fail, or stop',
  'push.settingsUnavailable': 'Could not check background notification settings. Try again.',
  'push.subscriptionFailed': 'Could not update this device’s push subscription. Try again.',
  'push.unsupported':
    'Background push is unavailable in this browser. On iPhone, add the app to your Home Screen first.',
  'push.unavailable': 'Background push is unavailable on this server or browser.',
  'push.hostUpdate': 'Update the Host on this computer to send background alerts.',
  'account.retryWhenOnline':
    'Unable to check your sign-in status. We will retry when the connection returns.',
  'drafts.keepOnDevice': 'Keep main conversation text drafts on this device for 7 days',
  'drafts.saveFailed':
    'Unable to save drafts on this device. Your text is still available on this page.',
  'hostSetup.title': 'Connect your development computer',
  'hostSetup.online': 'Computer online',
  'hostSetup.startHost': 'Computer offline. Start the Host on your computer.',
  'hostSetup.awaitSignIn': 'Waiting for your computer to sign in to the same account',
  'hostSetup.codexReady': 'Codex is ready',
  'hostSetup.codexNotReady':
    'Codex is not ready. Run agentdeck status --json on your computer for details.',
  'hostSetup.connectFirst': 'Connect to the Host to check Codex readiness',
  'hostSetup.projectsAvailable': 'Projects available ({{count}})',
  'hostSetup.authorizeProject': 'Authorize a project folder on your computer',
  'hostSetup.install': 'Set up on your computer',
  'hostSetup.platform': 'Computer operating system',
  'hostSetup.terminalInstructions':
    'Open a terminal in your project folder on the development computer. After installation, replace NAME with the AgentDeck username you use on your phone.',
  'hostSetup.codexSignIn':
    'If the status asks for Codex authentication, run agentdeck codex-login on your computer, then reconnect from your phone.',
  'historySearch.cursorStalled': 'Search did not advance. Try again.',
  'historySearch.continue': 'Continue searching messages',
  'historySearch.search': 'Search message contents',
  'historySearch.queryTooLong': 'Message search supports up to 128 characters.',
  'historySearch.cancel': 'Cancel search',
  'historySearch.searching': 'Searching messages on your computer…',
  'historySearch.complete': 'Search complete',
  'historySearch.noMatches': 'No matching messages',
  'historySearch.partial': 'Part of the history has been searched',
  'historySearch.skippedSessions': 'Some conversations could not be read ({{count}}).',
  'inbox.reviewQuestion': 'Open to check question status',
  'inbox.empty': 'No pending items',
  'inbox.refresh': 'Refresh inbox',
  'inbox.noHosts': 'No computers linked. Sign in to the same account on your computer first.',
  'inbox.offline': 'Computer offline. Pending items are unknown.',
  'inbox.unavailable': 'Pending items are temporarily unavailable.',
} as const;

export default mobile;
