class Logger {
  constructor(ctx) { this.ctx = ctx; }
  _ts() { return new Date().toISOString(); }
  info(...a) { console.log(`[${this._ts()}] [INFO]  [${this.ctx}]`, ...a); }
  warn(...a) { console.warn(`[${this._ts()}] [WARN]  [${this.ctx}]`, ...a); }
  error(...a) { console.error(`[${this._ts()}] [ERROR] [${this.ctx}]`, ...a); }
  debug(...a) { if (process.env.LOG_LEVEL === "debug") console.debug(`[${this._ts()}] [DEBUG] [${this.ctx}]`, ...a); }
}
module.exports = { Logger };
