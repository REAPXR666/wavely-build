const { parentPort } = require('worker_threads');
const { processAudioForDawSync } = require('./mediaUtils');

parentPort.on('message', ({ jobId, filePath, meta }) => {
  const result = processAudioForDawSync(filePath, meta || {});
  parentPort.postMessage({ jobId, result });
});
