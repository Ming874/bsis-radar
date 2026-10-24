/** 建置時由 vite.config.ts 注入（來自 package.json 的 version） */
declare const __APP_VERSION__: string;
/** 這一次建置的代號（和 /version.json 比對，看伺服器是不是換新版了） */
declare const __BUILD_ID__: string;
