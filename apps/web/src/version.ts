declare const __APP_VERSION__: string;

/** The version of Stint this page was built from, for example "0.3.0". */
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
