import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import translateRouter from './routes/translate.js';

const app = express();
const port = 3000;
const projectRoot = process.cwd();
const publicDir = path.join(projectRoot, 'public');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));
app.use(translateRouter);

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Debounce translation lab is running on http://localhost:${port}`);
});
