import express from 'express';
import { router as apiRouter } from './src/router.js';
import * as path from "path";
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', apiRouter);

// simple form to upload file
app.get('/', (request, response) =>
    response.sendFile(path.join(__dirname, 'public', 'upload.html')));

app.listen(8080, () => {
    console.log('Listening at http://localhost:8080');
});

