import common from './common.ts';
import legacy from './legacy.ts';
import mobile from './mobile.ts';

export default { ...legacy, ...common, ...mobile } as const;
