module.exports = {
  apps: [
    {
      name: "faiaudit",
      script: "src/server.js",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
