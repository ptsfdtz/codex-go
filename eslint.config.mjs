import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/artifacts/**',
      'packages/codex-protocol/**',
      'android/**',
      'desktop/src-tauri/**',
      '.tmp/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        structuredClone: 'readonly',
      },
    },
  },
  {
    files: [
      'server/admin/*.js',
      'server/tests/admin-browser.mjs',
      'web/tests/browser-transport.mjs',
    ],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        innerWidth: 'readonly',
        navigator: 'readonly',
        Node: 'readonly',
        FormData: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        setInterval: 'readonly',
      },
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: { require: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
