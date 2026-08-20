import PDFDocument from "pdfkit";

import type { EstimateSnapshot } from "./estimateSnapshot.js";

type PdfOptions = {
  version: number;
  logo?: Buffer;
};

type PdfLine = {
  title: string;
  description: string;
  quantity: number;
  unit: string;
  rateCents: number;
  amountCents: number;
};

const PAGE = {
  width: 612,
  height: 792,
  margin: 46,
  contentWidth: 520,
};

const COLORS = {
  ink: "#1f201d",
  muted: "#64615b",
  faint: "#8a857d",
  line: "#d9d4cc",
  surface: "#f7f5f1",
  accent: "#b71920",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function money(cents: unknown): string {
  return (Number(cents || 0) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function shortDate(value: unknown): string {
  if (!value) return "-";
  const date = new Date(`${String(value)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function addressLines(value: unknown): string[] {
  const address = asRecord(value);
  if (address.fullLine) return [String(address.fullLine)];
  const first = [address.street, address.unit].filter(Boolean).join(" ");
  const second = [address.city, address.state, address.postalCode]
    .filter(Boolean)
    .join(", ");
  return [first, second].filter(Boolean);
}

const UNIT_LABELS: Record<string, [string, string]> = {
  EA: ["Each", "Each"],
  PIECE: ["Piece", "Pieces"],
  BOX: ["Box", "Boxes"],
  SQ: ["Square", "Squares"],
  SF: ["Sq. ft.", "Sq. ft."],
  LF: ["Lin. ft.", "Lin. ft."],
  HR: ["Hour", "Hours"],
  DAY: ["Day", "Days"],
  LS: ["Lump sum", "Lump sum"],
  TON: ["Ton", "Tons"],
  SHEET: ["Sheet", "Sheets"],
  GAL: ["Gallon", "Gallons"],
  ROLL: ["Roll", "Rolls"],
  BUNDLE: ["Bundle", "Bundles"],
  OTHER: ["Unit", "Units"],
};

function quantityLabel(quantity: number, unit: string): string {
  const formatted = Number.isInteger(quantity)
    ? quantity.toLocaleString("en-US")
    : quantity.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const labels = UNIT_LABELS[unit] || UNIT_LABELS.OTHER;
  return `${formatted} ${quantity === 1 ? labels[0] : labels[1]}`;
}

function customerLines(snapshot: EstimateSnapshot): PdfLine[] {
  if (!Array.isArray(snapshot.lineItems)) return [];
  return snapshot.lineItems
    .map(asRecord)
    .filter(
      (line) => line.customerVisible !== false && line.selected !== false
    )
    .map((line) => ({
      title: String(line.title || "Material"),
      description: String(line.customerDescription || ""),
      quantity: Number(line.quantity || 0),
      unit: String(line.unit || "LS"),
      rateCents: Number(line.unitPriceCents || 0),
      amountCents: Number(line.lineTotalCents || 0),
    }));
}

function collectBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function sectionLabel(doc: PDFKit.PDFDocument, label: string, x: number, y: number) {
  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .fillColor(COLORS.muted)
    .text(label.toUpperCase(), x, y, { characterSpacing: 0.8 });
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y + needed <= PAGE.height - PAGE.margin) return;
  doc.addPage();
  doc.y = PAGE.margin;
}

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  title: string,
  y: number
): number {
  doc
    .roundedRect(PAGE.margin, y, PAGE.contentWidth, 27, 4)
    .fill(COLORS.ink);
  doc
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor("#ffffff")
    .text(title.toUpperCase(), PAGE.margin + 10, y + 10, { width: 248 });
  doc.text("RATE / UNIT", PAGE.margin + 306, y + 10, {
    width: 70,
    align: "right",
  });
  doc.text("QUANTITY", PAGE.margin + 384, y + 10, {
    width: 66,
    align: "right",
  });
  doc.text("AMOUNT", PAGE.margin + 455, y + 10, {
    width: 55,
    align: "right",
  });
  return y + 27;
}

function drawMaterialRow(
  doc: PDFKit.PDFDocument,
  line: PdfLine,
  y: number
): number {
  doc.font("Helvetica-Bold").fontSize(8.5);
  const titleHeight = doc.heightOfString(line.title, { width: 260 });
  doc.font("Helvetica").fontSize(6.8);
  const descriptionHeight = line.description
    ? doc.heightOfString(line.description, { width: 260 }) + 3
    : 0;
  const height = Math.max(36, titleHeight + descriptionHeight + 18);
  doc
    .rect(PAGE.margin, y, PAGE.contentWidth, height)
    .fillAndStroke("#ffffff", COLORS.line);
  doc
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .fillColor(COLORS.ink)
    .text(line.title, PAGE.margin + 10, y + 9, { width: 260 });
  if (line.description) {
    doc
      .font("Helvetica")
      .fontSize(6.8)
      .fillColor(COLORS.muted)
      .text(line.description, PAGE.margin + 10, y + 11 + titleHeight, {
        width: 260,
      });
  }
  const baseline = y + 12;
  doc
    .font("Helvetica")
    .fontSize(7.6)
    .fillColor(COLORS.ink)
    .text(money(line.rateCents), PAGE.margin + 306, baseline, {
      width: 70,
      align: "right",
    })
    .text(quantityLabel(line.quantity, line.unit), PAGE.margin + 384, baseline, {
      width: 66,
      align: "right",
    })
    .font("Helvetica-Bold")
    .text(money(line.amountCents), PAGE.margin + 455, baseline, {
      width: 55,
      align: "right",
    });
  return y + height;
}

function drawTotalRow(
  doc: PDFKit.PDFDocument,
  label: string,
  cents: number,
  y: number
): number {
  doc
    .rect(PAGE.margin, y, PAGE.contentWidth, 29)
    .fillAndStroke(COLORS.surface, COLORS.line)
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor(COLORS.ink)
    .text(label.toUpperCase(), PAGE.margin + 310, y + 11, {
      width: 135,
      align: "right",
    })
    .text(money(cents), PAGE.margin + 455, y + 9, {
      width: 55,
      align: "right",
    });
  return y + 29;
}

function drawLaborRow(
  doc: PDFKit.PDFDocument,
  label: string,
  cents: number,
  y: number
): number {
  const line: PdfLine = {
    title: label,
    description: "",
    quantity: 1,
    unit: label === "Labor cost" ? "LS" : "EA",
    rateCents: cents,
    amountCents: cents,
  };
  return drawMaterialRow(doc, line, y);
}

function drawFooter(doc: PDFKit.PDFDocument) {
  const pages = doc.bufferedPageRange();
  for (let index = 0; index < pages.count; index += 1) {
    doc.switchToPage(index);
    doc
      .font("Helvetica")
      .fontSize(6.5)
      .fillColor(COLORS.faint)
      .text(
        `Roger's Roofing estimate - Page ${index + 1} of ${pages.count}`,
        PAGE.margin,
        PAGE.height - PAGE.margin - 12,
        { width: PAGE.contentWidth, align: "center", lineBreak: false }
      );
  }
}

export async function renderEstimatePdf(
  snapshot: EstimateSnapshot,
  options: PdfOptions
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "LETTER",
    margins: {
      top: PAGE.margin,
      right: PAGE.margin,
      bottom: PAGE.margin,
      left: PAGE.margin,
    },
    bufferPages: true,
    info: {
      Title: `${String(snapshot.number || "Estimate")} - Version ${options.version}`,
      Author: String(
        asRecord(snapshot.organizationSnapshot).name || "Roger's Roofing"
      ),
      Subject: "Professional roofing estimate",
    },
  });
  const completed = collectBuffer(doc);
  const organization = asRecord(snapshot.organizationSnapshot);
  const customer = asRecord(snapshot.customerSnapshot);
  const number = String(snapshot.number || "Estimate");

  if (options.logo) {
    try {
      doc.image(options.logo, PAGE.margin, PAGE.margin, {
        fit: [52, 40],
        valign: "center",
      });
    } catch {
      // The company name remains visible if a customized logo is unavailable.
    }
  }
  const brandX = options.logo ? PAGE.margin + 62 : PAGE.margin;
  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor(COLORS.ink)
    .text(String(organization.name || organization.legalName || "Roger's Roofing"), brandX, PAGE.margin + 3, {
      width: 280,
    });
  doc.font("Helvetica").fontSize(7.2).fillColor(COLORS.muted);
  const organizationDetails = [
    ...addressLines(organization.address),
    organization.phone,
    organization.email,
  ]
    .filter(Boolean)
    .map(String);
  organizationDetails.forEach((line, index) => {
    doc.text(line, brandX, PAGE.margin + 23 + index * 10, { width: 280 });
  });

  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .fillColor(COLORS.muted)
    .text(`VERSION ${options.version}`, PAGE.margin + 375, PAGE.margin + 2, {
      width: 145,
      align: "right",
      characterSpacing: 0.8,
    })
    .font("Helvetica-Bold")
    .fontSize(20)
    .fillColor(COLORS.ink)
    .text("Estimate", PAGE.margin + 350, PAGE.margin + 17, {
      width: 170,
      align: "right",
    })
    .font("Helvetica-Bold")
    .fontSize(7)
    .fillColor(COLORS.muted)
    .text(number, PAGE.margin + 350, PAGE.margin + 45, {
      width: 170,
      align: "right",
    });

  let y = 112;
  doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + PAGE.contentWidth, y).stroke(COLORS.line);
  y += 15;
  const third = PAGE.contentWidth / 3;
  sectionLabel(doc, "Estimate date", PAGE.margin, y);
  sectionLabel(doc, "Valid through", PAGE.margin + third, y);
  sectionLabel(doc, "Prepared for", PAGE.margin + third * 2, y);
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(COLORS.ink)
    .text(shortDate(snapshot.issueDate), PAGE.margin, y + 13, { width: third - 12 })
    .text(shortDate(snapshot.validUntil), PAGE.margin + third, y + 13, {
      width: third - 12,
    })
    .text(String(customer.name || "Customer"), PAGE.margin + third * 2, y + 13, {
      width: third,
    });
  doc.font("Helvetica").fontSize(6.8).fillColor(COLORS.muted);
  const preparedLines = [
    customer.email,
    customer.phone,
    ...addressLines(snapshot.propertyAddressSnapshot),
  ]
    .filter(Boolean)
    .map(String);
  preparedLines.forEach((line, index) => {
    doc.text(line, PAGE.margin + third * 2, y + 29 + index * 9, {
      width: third,
    });
  });
  sectionLabel(doc, "Project", PAGE.margin, y + 43);
  doc
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .fillColor(COLORS.ink)
    .text(String(snapshot.projectTitle || "Roofing project"), PAGE.margin, y + 56, {
      width: third - 12,
    });
  if (Number(snapshot.roofAreaSquareFeet || 0) > 0) {
    sectionLabel(doc, "Measured roof area", PAGE.margin + third, y + 43);
    doc
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .fillColor(COLORS.ink)
      .text(
        `${Number(snapshot.roofAreaSquareFeet).toLocaleString("en-US", {
          maximumFractionDigits: 2,
        })} sq. ft.`,
        PAGE.margin + third,
        y + 56,
        { width: third - 12 }
      );
  }
  y += 87;
  doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + PAGE.contentWidth, y).stroke(COLORS.line);
  y += 17;

  const materials = customerLines(snapshot);
  y = drawTableHeader(doc, "Material", y);
  for (const line of materials) {
    doc.font("Helvetica-Bold").fontSize(8.5);
    const estimatedHeight = Math.max(
      36,
      doc.heightOfString(line.title, { width: 260 }) +
        (line.description
          ? doc.font("Helvetica").fontSize(6.8).heightOfString(line.description, { width: 260 }) + 3
          : 0) +
        18
    );
    if (y + estimatedHeight + 35 > PAGE.height - PAGE.margin) {
      doc.addPage();
      y = drawTableHeader(doc, "Material - continued", PAGE.margin);
    }
    y = drawMaterialRow(doc, line, y);
  }
  const laborFees = asRecord(snapshot.laborFeesSnapshot);
  const materialsTotal = Number(
    laborFees.materialTotalCents ??
      materials.reduce((total, line) => total + line.amountCents, 0)
  );
  y = drawTotalRow(doc, "Materials total", materialsTotal, y);

  const laborRows = [
    ["Labor cost", Number(laborFees.laborCostCents || 0)],
    ["Dumpster fee", Number(laborFees.dumpsterFeeCents || 0)],
    ["Roof load fee", Number(laborFees.roofLoadFeeCents || 0)],
  ] as const;
  if (laborRows.some(([, cents]) => cents > 0)) {
    if (y + 170 > PAGE.height - PAGE.margin) {
      doc.addPage();
      y = PAGE.margin;
    } else {
      y += 12;
    }
    y = drawTableHeader(doc, "Labor & fees", y);
    for (const [label, cents] of laborRows) {
      if (cents > 0) y = drawLaborRow(doc, label, cents, y);
    }
    y = drawTotalRow(
      doc,
      "Labor & fees total",
      Number(laborFees.laborAndFeesTotalCents || 0),
      y
    );
  }

  ensureSpace(doc, 176);
  y = doc.y > y ? doc.y + 10 : y + 16;
  const totalsX = PAGE.margin + 315;
  const totalsWidth = 205;
  const totalRows: [string, number, boolean][] = [
    ["Subtotal", Number(snapshot.subtotalCents || 0), false],
  ];
  if (Number(snapshot.discountCents || 0) > 0) {
    totalRows.push(["Discount", -Number(snapshot.discountCents || 0), false]);
  }
  if (Number(snapshot.taxCents || 0) > 0) {
    totalRows.push(["Sales tax", Number(snapshot.taxCents || 0), false]);
  }
  totalRows.push(["Estimate total", Number(snapshot.totalCents || 0), true]);
  totalRows.forEach(([label, cents, emphasis], index) => {
    const rowY = y + index * 25;
    if (emphasis) {
      doc.moveTo(totalsX, rowY - 5).lineTo(totalsX + totalsWidth, rowY - 5).lineWidth(1.2).stroke(COLORS.ink);
    }
    doc
      .font(emphasis ? "Helvetica-Bold" : "Helvetica")
      .fontSize(emphasis ? 9 : 7.5)
      .fillColor(COLORS.ink)
      .text(label.toUpperCase(), totalsX, rowY, { width: 95 })
      .font(emphasis ? "Helvetica-Bold" : "Helvetica-Bold")
      .fontSize(emphasis ? 15 : 8.5)
      .text(money(cents), totalsX + 105, rowY - (emphasis ? 4 : 0), {
        width: 100,
        align: "right",
      });
  });

  const detailWidth = 285;
  const details: [string, string][] = [
    ["Workmanship warranty", String(snapshot.warrantyText || "")],
    ["Payment terms", String(snapshot.paymentTerms || "")],
    ["Notes", String(snapshot.notes || "")],
  ].filter((entry) => entry[1].trim()) as [string, string][];
  let detailY = y;
  for (const [label, value] of details) {
    sectionLabel(doc, label, PAGE.margin, detailY);
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(value, PAGE.margin, detailY + 13, { width: detailWidth });
    detailY = doc.y + 10;
  }

  y = Math.max(detailY, y + totalRows.length * 25) + 18;
  const assumptions = Array.isArray(snapshot.assumptions)
    ? snapshot.assumptions.map(String).filter(Boolean)
    : [];
  const exclusions = Array.isArray(snapshot.exclusions)
    ? snapshot.exclusions.map(String).filter(Boolean)
    : [];
  if (assumptions.length || exclusions.length) {
    ensureSpace(doc, 96);
    y = Math.max(y, doc.y + 8);
    doc
      .roundedRect(PAGE.margin, y, PAGE.contentWidth, 74, 5)
      .fillAndStroke(COLORS.surface, COLORS.line);
    sectionLabel(doc, "Assumptions", PAGE.margin + 12, y + 12);
    sectionLabel(doc, "Not included", PAGE.margin + 270, y + 12);
    doc
      .font("Helvetica")
      .fontSize(6.6)
      .fillColor(COLORS.muted)
      .text(assumptions.join("\n"), PAGE.margin + 12, y + 28, { width: 236 })
      .text(exclusions.join("\n"), PAGE.margin + 270, y + 28, { width: 236 });
    y += 92;
  }

  ensureSpace(doc, 90);
  y = Math.max(y, doc.y + 8);
  sectionLabel(doc, "Customer approval", PAGE.margin, y);
  y += 31;
  doc
    .moveTo(PAGE.margin, y)
    .lineTo(PAGE.margin + 325, y)
    .moveTo(PAGE.margin + 350, y)
    .lineTo(PAGE.margin + PAGE.contentWidth, y)
    .stroke(COLORS.ink)
    .font("Helvetica")
    .fontSize(6)
    .fillColor(COLORS.faint)
    .text("Signature", PAGE.margin, y + 5)
    .text("Date", PAGE.margin + 350, y + 5);
  y += 36;
  doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + PAGE.contentWidth, y).stroke(COLORS.line);
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(COLORS.ink)
    .text("Thank you for the opportunity to earn your business.", PAGE.margin, y + 13, {
      width: PAGE.contentWidth,
      align: "center",
    });

  drawFooter(doc);
  doc.end();
  return completed;
}
