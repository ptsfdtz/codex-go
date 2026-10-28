export type ComposerPreferences = { model: string; effort: string; permission: string };
export type ComposerModelPreferences = Pick<ComposerPreferences, 'model' | 'effort'>;
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

const modelStorageKey = (scope: string) => `agentdeck.web.composer.model.${scope}`;

export function readComposerModelPreferences(
  scope: string,
  fallback: ComposerModelPreferences = { model: '', effort: '' },
): ComposerModelPreferences {
  if (!scope) return fallback;
  try {
    const value = JSON.parse(localStorage.getItem(modelStorageKey(scope)) || 'null');
    if (typeof value?.model !== 'string' || typeof value?.effort !== 'string') return fallback;
    return { model: value.model, effort: value.effort };
  } catch {
    return fallback;
  }
}

export function saveComposerModelPreferences(scope: string, value: ComposerModelPreferences) {
  if (!scope) return;
  try {
    localStorage.setItem(modelStorageKey(scope), JSON.stringify(value));
  } catch {
    // The current page still keeps the selection when storage is unavailable.
  }
}
