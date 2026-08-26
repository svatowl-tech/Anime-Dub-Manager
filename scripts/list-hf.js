import axios from 'axios';
import fs from 'fs';
import path from 'path';

async function lsHugFace(modelId) {
  const { data } = await axios.get(`https://huggingface.co/api/models/${modelId}/tree/main`);
  for (const item of data) {
    console.log(item.path);
  }
}

lsHugFace('Xenova/speechbrain-ecapa-tdnn');
