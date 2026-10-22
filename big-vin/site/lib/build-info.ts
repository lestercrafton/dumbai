declare const __BV_BUILD__: string;
/** Set at build time (vite.config.ts): short commit and UTC build minute. */
export const BUILD: string = typeof __BV_BUILD__ === 'string' ? __BV_BUILD__ : 'dev';
