const express = require('express');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const archiver = require('archiver');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/api/split', upload.single('pdfFile'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No file uploaded.');

    const splitMode = req.body.splitMode;
    const splitValue = parseInt(req.body.splitValue);

    if (!splitValue || splitValue <= 0) {
      return res.status(400).send('Invalid split value provided.');
    }

    const pdfDoc = await PDFDocument.load(req.file.buffer);
    const totalPages = pdfDoc.getPageCount();

    let pagesPerFile;
    if (splitMode === 'byPages') {
      pagesPerFile = splitValue;
    } else if (splitMode === 'byFiles') {
      pagesPerFile = Math.ceil(totalPages / splitValue);
    } else {
      return res.status(400).send('Unknown split mode.');
    }

    res.attachment('Split_PDFs.zip');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    for (let i = 0; i < totalPages; i += pagesPerFile) {
      const newPdf = await PDFDocument.create();
      const end = Math.min(i + pagesPerFile, totalPages);
      const copiedPages = await newPdf.copyPages(
        pdfDoc,
        Array.from({ length: end - i }, (_, index) => i + index),
      );

      copiedPages.forEach(page => newPdf.addPage(page));

      const pdfBytes = await newPdf.save();
      archive.append(Buffer.from(pdfBytes), { name: `Part_${Math.floor(i / pagesPerFile) + 1}.pdf` });
    }

    await archive.finalize();
  } catch (error) {
    console.error('Error processing PDF:', error);
    res.status(500).send('An error occurred while processing the PDF.');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
