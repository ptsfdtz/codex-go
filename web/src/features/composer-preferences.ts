export type ComposerPreferences = { model: string; effort: string; permission: string };
const defaults = (): ComposerPreferences => ({ model: '', effort: '', permission: 'workspace' });
const storageKey = (scope: string) => `agentdeck.web.composer.${scope}`;

export function readComposerPreferences(scope: string): ComposerPreferences {
  if (!scope) return defaults();
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(scope)) || 'null');
    return {
      model: typeof value?.model === 'string' ? value.model : '',
      effort: typeof value?.effort === 'string' ? value.effort : '',
      permission: value?.permission === 'full' ? 'full' : 'workspace',
    };
  } catch {
    return defaults();
  }
}

export function saveComposerPreferences(scope: string, value: ComposerPreferences) {
  if (!scope) return;
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the current page still keeps the selection.
  }
}
