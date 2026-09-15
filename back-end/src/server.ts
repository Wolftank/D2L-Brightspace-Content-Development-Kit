import express from 'express';
import { config } from './config.js';

const app = express();

app.listen(config.PORT, '127.0.0.1', () => {
  console.log(`back-end listening on http://127.0.0.1:${config.PORT}`);
});
