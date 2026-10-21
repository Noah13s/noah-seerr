let accessHandle = null;

self.onmessage = async ({ data }) => {
  const { requestId, type } = data;
  try {
    if (type === 'open') {
      const root = await navigator.storage.getDirectory();
      const app = await root.getDirectoryHandle('noah-stream-offline', { create: true });
      const directory = await app.getDirectoryHandle(`profile-${data.profileId}`, { create: true });
      const file = await directory.getFileHandle(data.fileName, { create: true });
      // A refreshed page can arrive before the old worker releases its file lock.
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          accessHandle = await file.createSyncAccessHandle();
          break;
        } catch (error) {
          if (error.name !== 'NoModificationAllowedError' || attempt === 29) throw error;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      self.postMessage({ requestId, bytes: accessHandle.getSize() });
    } else if (type === 'write') {
      if (!accessHandle || data.at !== accessHandle.getSize()) {
        throw new Error('The partial download changed unexpectedly.');
      }
      const chunk = new Uint8Array(data.chunk);
      let written = 0;
      while (written < chunk.byteLength) {
        const count = accessHandle.write(chunk.subarray(written), { at: data.at + written });
        if (count <= 0) throw new Error('Could not write the offline file.');
        written += count;
      }
      accessHandle.flush();
      self.postMessage({ requestId, bytes: accessHandle.getSize() });
    } else if (type === 'close') {
      accessHandle?.close();
      accessHandle = null;
      self.postMessage({ requestId });
    }
  } catch (error) {
    self.postMessage({ requestId, error: error instanceof Error ? error.message : 'Offline file error.' });
  }
};
