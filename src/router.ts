import { Router } from 'express';
import multer from 'multer';
import { uploadHandler } from "./uploadHandler.js";

const router = Router();
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/vnd.ms-excel' || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only XLS files are allowed.'));
        }
    }
});

router.post('/upload', upload.single('file'), uploadHandler);

export { router };
