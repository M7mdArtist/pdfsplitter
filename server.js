require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const archiver = require('archiver');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

function parseRange(rangeStr, totalPages) {
  const pageIndices = new Set();
  const parts = rangeStr.split(',').map(p => p.trim());

  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(num => parseInt(num, 10));
      if (isNaN(start) || isNaN(end) || start < 1 || end > totalPages || start > end) {
        throw new Error(`Invalid range: ${part}`);
      }
      for (let i = start; i <= end; i++) pageIndices.add(i - 1);
    } else {
      const pageNum = parseInt(part, 10);
      if (isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
        throw new Error(`Invalid page number: ${part}`);
      }
      pageIndices.add(pageNum - 1);
    }
  }
  return Array.from(pageIndices).sort((a, b) => a - b);
}

// Helper to resolve custom output file names
function resolveFileName(pattern, originalName, index) {
  const cleanOriginal = originalName.replace(/\.[^/.]+$/, '');
  if (!pattern || !pattern.trim()) {
    return `${cleanOriginal}_${index}.pdf`;
  }
  const trimmed = pattern.trim();
  if (trimmed.includes('$X')) {
    return `${trimmed.replace(/\$X/g, index)}.pdf`;
  }
  return `${trimmed}_${index}.pdf`;
}

app.post('/api/split', upload.single('pdfFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded.' });
    }

    const { splitMode, splitValue, customRange, outputName } = req.body;
    const originalName = req.file.originalname;

    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true });
    } catch (e) {
      return res.status(400).json({ error: 'Failed to read PDF. File may be corrupted.' });
    }

    if (pdfDoc.isEncrypted) {
      return res.status(400).json({ error: 'Password-protected PDFs are not supported.' });
    }

    const totalPages = pdfDoc.getPageCount();
    if (totalPages === 0) {
      return res.status(400).json({ error: 'The uploaded PDF has no pages.' });
    }

    res.attachment('Split_PDFs.zip');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    if (splitMode === 'customRange') {
      if (!customRange) return res.status(400).json({ error: 'Custom range is required.' });

      const indices = parseRange(customRange, totalPages);
      const newPdf = await PDFDocument.create();
      const copiedPages = await newPdf.copyPages(pdfDoc, indices);
      copiedPages.forEach(p => newPdf.addPage(p));

      const pdfBytes = await newPdf.save();
      const fileName = resolveFileName(outputName, originalName, 1);
      archive.append(Buffer.from(pdfBytes), { name: fileName });
    } else {
      const numericValue = parseInt(splitValue, 10);
      if (!numericValue || numericValue <= 0) {
        return res.status(400).json({ error: 'Invalid split value provided.' });
      }

      let pagesPerFile = splitMode === 'byPages' ? numericValue : Math.ceil(totalPages / numericValue);

      let partNum = 1;
      for (let i = 0; i < totalPages; i += pagesPerFile) {
        const newPdf = await PDFDocument.create();
        const end = Math.min(i + pagesPerFile, totalPages);
        const pageIndices = Array.from({ length: end - i }, (_, idx) => i + idx);

        const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
        copiedPages.forEach(p => newPdf.addPage(p));

        const pdfBytes = await newPdf.save();
        const fileName = resolveFileName(outputName, originalName, partNum);
        archive.append(Buffer.from(pdfBytes), { name: fileName });
        partNum++;
      }
    }

    await archive.finalize();
  } catch (error) {
    console.error('PDF Processing Error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'An error occurred while processing the file.' });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
