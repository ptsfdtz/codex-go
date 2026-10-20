import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('bridge/dist/bridge/generated', { recursive: true });
cpSync('bridge/generated/schema', 'bridge/dist/bridge/generated/schema', { recursive: true });
