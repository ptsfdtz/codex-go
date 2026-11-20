import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { translations } from '../web/src/i18n/config.ts';
import { adminCatalog } from './admin-locales.ts';

for (const locale of Object.keys(translations)) {
  await writeFile(
    join(process.env.OUT_DIR, `${locale}.json`),
    JSON.stringify(adminCatalog(locale)),
  );
}
