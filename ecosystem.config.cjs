module.exports = {
  apps: [{
    name: 'kuro-core',
    script: 'server.cjs',
    cwd: '/mnt/kurodisk/kuro/core',
    env: {
      OLLAMA_HOST: 'http://localhost:11434',
      OLLAMA_URL: 'http://localhost:11434',
      KURO_MODEL: 'huihui_ai/gemma-4-abliterated:e4b',
      KURO_PORT: '3000',
      PORT: '3000',
      KURO_DATA: '/mnt/kurodisk/kuro/data',
      NODE_ENV: 'production',
    },
  }],
};
