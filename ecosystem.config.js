module.exports = {
  apps: [{
    name: "btc-trader",
    script: "src/index.js",
    cwd: __dirname,
    restart_delay: 5000,       // wait 5s between restarts
    max_restarts: 100,         // generous restart budget
    autorestart: true,
    watch: false,
    error_file: "logs/err.log",
    out_file: "logs/out.log",
    merge_logs: true,
    time: true,                // prefix logs with timestamps
    env: {
      NODE_ENV: "production",
    },
  }, {
    name: "multi-asset-trader",
    script: "src/agents/multi-asset-trader.js",
    cwd: __dirname,
    restart_delay: 5000,
    max_restarts: 100,
    autorestart: true,
    watch: false,
    error_file: "logs/multi-asset-err.log",
    out_file: "logs/multi-asset-out.log",
    merge_logs: true,
    time: true,
    env: {
      NODE_ENV: "production",
    },
  }, {
    name: "bankr-launcher",
    script: "src/agents/bankr-launcher.js",
    cwd: __dirname,
    restart_delay: 30000,      // 30s between restarts (token launches are expensive)
    max_restarts: 20,
    autorestart: true,
    watch: false,
    error_file: "logs/bankr-err.log",
    out_file: "logs/bankr-out.log",
    merge_logs: true,
    time: true,
    env: {
      NODE_ENV: "production",
    },
  }, {
    name: "clanker-launcher",
    script: "src/agents/clanker-launcher.js",
    cwd: __dirname,
    restart_delay: 30000,
    max_restarts: 20,
    autorestart: true,
    watch: false,
    error_file: "logs/clanker-err.log",
    out_file: "logs/clanker-out.log",
    merge_logs: true,
    time: true,
    env: {
      NODE_ENV: "production",
    },
  }, {
    name: "0xwork-worker",
    script: "src/agents/0xwork-worker.js",
    cwd: __dirname,
    restart_delay: 10000,      // wait 10s between restarts
    max_restarts: 50,
    autorestart: true,
    watch: false,
    error_file: "logs/0xwork-err.log",
    out_file: "logs/0xwork-out.log",
    merge_logs: true,
    time: true,
    env: {
      NODE_ENV: "production",
    },
  }],
};
