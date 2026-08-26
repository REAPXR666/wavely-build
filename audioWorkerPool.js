const { Worker } = require('worker_threads');

class AudioWorkerPool {
  constructor(workerPath, size = 2) {
    this.workerPath = workerPath;
    this.size = Math.max(1, Math.min(4, size));
    this.queue = [];
    this.slots = [];
    this.nextJobId = 1;
    this.closed = false;
    for (let index = 0; index < this.size; index++) this.createSlot(index);
  }

  createSlot(index) {
    if (this.closed) return;
    const worker = new Worker(this.workerPath);
    const slot = { index, worker, job: null, failed: false };
    this.slots[index] = slot;

    worker.on('message', ({ jobId, result }) => {
      if (!slot.job || slot.job.jobId !== jobId) return;
      const job = slot.job;
      slot.job = null;
      if (job.timeout) clearTimeout(job.timeout);
      job.resolve(result);
      this.drain();
    });

    worker.on('error', error => this.failSlot(slot, error));
    worker.on('exit', code => {
      if (!this.closed && code !== 0 && !slot.failed) {
        this.failSlot(slot, new Error(`Audio worker exited with code ${code}`));
      }
    });
  }

  failSlot(slot, error) {
    if (slot.failed) return;
    slot.failed = true;
    if (slot.job) {
      const job = slot.job;
      slot.job = null;
      if (job.timeout) clearTimeout(job.timeout);
      if (job.attempts < 1 && !this.closed) {
        job.attempts++;
        this.queue.unshift(job);
      } else {
        job.reject(error);
      }
    }
    slot.worker.terminate().catch(() => {});
    if (!this.closed) {
      this.createSlot(slot.index);
      this.drain();
    }
  }

  run(filePath, meta = {}) {
    if (this.closed) return Promise.reject(new Error('Audio worker pool is closed.'));
    return new Promise((resolve, reject) => {
      this.queue.push({ jobId: this.nextJobId++, filePath, meta, resolve, reject, attempts: 0 });
      this.drain();
    });
  }

  drain() {
    if (this.closed) return;
    for (const slot of this.slots) {
      if (!slot || slot.failed || slot.job || this.queue.length === 0) continue;
      const job = this.queue.shift();
      slot.job = job;
      job.timeout = setTimeout(() => {
        this.failSlot(slot, new Error(`Audio processing timed out for ${job.filePath}`));
      }, 120000);
      slot.worker.postMessage({ jobId: job.jobId, filePath: job.filePath, meta: job.meta });
    }
  }

  async close() {
    this.closed = true;
    const error = new Error('Wavely is closing.');
    for (const job of this.queue.splice(0)) job.reject(error);
    await Promise.all(this.slots.filter(Boolean).map(slot => slot.worker.terminate().catch(() => {})));
  }
}

module.exports = { AudioWorkerPool };
