/** Constants shared by the panel's contracts and the runner agent's (kept apart so the two files never import each other). */
export const WMIG_CLIENT_RE = /^[a-z0-9_-]{1,64}$/;
/** An organization (workspace) id = the Waboo Mongo database name. A plus sign is allowed (Mongo accepts it in database names). Passed to the pipeline only as an argument. */
export const WMIG_DB_RE = /^[A-Za-z0-9_+]{1,128}$/;
export const WMIG_MODES = ['dry', 'load', 'catchup'] as const;
