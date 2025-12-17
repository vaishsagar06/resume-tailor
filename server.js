require("dotenv").config();

const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");
const { jsPDF } = require("jspdf");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
const PORT = 3001;

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Middleware - MUST come before routes
app.use(cors());
app.use(express.json());

// Test endpoint
app.get("/", (req, res) => {
  res.json({ message: "Resume backend is running!" });
});

app.post("/api/tailor-resume", async (req, res) => {
  let browser;
  try {
    const { jobUrl, masterResumeText } = req.body;

    console.log("Received request for job URL:", jobUrl);

    // Step 1: Scrape the job posting with Puppeteer
    console.log("Fetching job posting...");
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Go to the page and wait for it to load
    await page.goto(jobUrl, { waitUntil: "networkidle2", timeout: 30000 });

    // Extract text content
    const jobDescription = await page.evaluate(() => {
      return document.body.innerText;
    });

    await browser.close();
    browser = null;

    console.log("Fetched job description, length:", jobDescription.length);

    // Step 2: Use Claude to tailor the resume
    const tailorResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: `Here is my complete resume:

${masterResumeText}

Here is the job description I'm applying for:

${jobDescription}

Please rewrite my resume to emphasize the most relevant experience for this specific role.

Rules:
- Use ONLY facts and experience from my actual resume
- Reframe bullet points to highlight relevant skills and accomplishments
- Adjust the emphasis and ordering to match the job requirements
- Keep all achievements truthful - do not make up any experience
- Maintain professional resume formatting
- Keep the same overall structure but optimize the content

Return the complete tailored resume as plain text, ready to copy and paste.`,
        },
      ],
    });

    const tailoredResume = tailorResponse.content[0].text;
    console.log("Tailored resume generated");

    res.json({
      success: true,
      tailoredResume,
    });
  } catch (error) {
    console.error("Error:", error);
    if (browser) {
      await browser.close();
    }
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/api/generate-pdf", async (req, res) => {
  try {
    const { resumeText } = req.body;

    // Create PDF
    const doc = new jsPDF();

    // Set font
    doc.setFontSize(11);

    // Split text into lines that fit the page width
    const pageWidth = doc.internal.pageSize.getWidth();
    const margins = 20;
    const maxWidth = pageWidth - margins * 2;

    // Split text by lines
    const lines = resumeText.split("\n");
    let y = 20; // Starting y position

    lines.forEach((line) => {
      // Split long lines to fit page width
      const splitLines = doc.splitTextToSize(line || " ", maxWidth);

      splitLines.forEach((splitLine) => {
        // Check if we need a new page
        if (y > 280) {
          doc.addPage();
          y = 20;
        }

        doc.text(splitLine, margins, y);
        y += 7; // Line height
      });
    });

    // Generate PDF as buffer
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

    // Send PDF back
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=tailored-resume.pdf"
    );
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Error generating PDF:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
