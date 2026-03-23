import React, { useState, useEffect, useRef } from "react";
import "./InvoiceGenerator.css";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

/* ─── helpers ─── */
const todayISO = () => new Date().toISOString().split("T")[0];

const isoToDisplay = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${months[parseInt(m, 10) - 1]} ${y}`;
};

const fmt = (n) => Number(n || 0).toFixed(2);

const numberToWords = (num) => {
  if (num === 0) return "Zero";
  const a = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten",
    "Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const b = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  const conv = (n) => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
    if (n < 1000) return a[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + conv(n % 100) : "");
    if (n < 100000) return conv(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + conv(n % 1000) : "");
    if (n < 10000000) return conv(Math.floor(n / 100000)) + " Lakh" + (n % 100000 ? " " + conv(n % 100000) : "");
    return conv(Math.floor(n / 10000000)) + " Crore" + (n % 10000000 ? " " + conv(n % 10000000) : "");
  };
  return conv(num);
};

/* ── Parse depth range from string like "001–300" or "1001–1100" ── */
const parseDepthRange = (depthStr) => {
  if (!depthStr) return null;
  // handle both hyphen variants: – (en-dash) and -
  const parts = depthStr.split(/[–-]/);
  if (parts.length !== 2) return null;
  const lo = parseInt(parts[0].trim(), 10);
  const hi = parseInt(parts[1].trim(), 10);
  if (isNaN(lo) || isNaN(hi)) return null;
  return { lo, hi };
};

/* ── Validate qty against depth range ── */
const validateQty = (depthStr, qtyVal) => {
  const range = parseDepthRange(depthStr);
  if (!range) return { valid: true, error: null }; // no depth = no restriction
  const qty = parseFloat(qtyVal);
  if (isNaN(qty) || qtyVal === "") return { valid: true, error: null };
  const rangeSize = range.hi - range.lo + 1; // e.g. 300-1=299 ft in range
  if (qty < 1) return { valid: false, error: `Min 1` };
  if (qty > rangeSize) return { valid: false, error: `Max ${rangeSize}` };
  return { valid: true, error: null };
};

/* ─── default rows ─── */
const DEFAULT_ROWS = [
  { description: "Drilling Charges", depth: "001–300",   qty: "", rate: "" },
  { description: "Drilling Charges", depth: "301–400",   qty: "", rate: "" },
  { description: "Drilling Charges", depth: "401–500",   qty: "", rate: "" },
  { description: "Drilling Charges", depth: "501–600",   qty: "", rate: "" },
  { description: "Drilling Charges", depth: "601–700",   qty: "", rate: "" },
  { description: "Drilling Charges", depth: "701–800",   qty: "", rate: "" },
  { description: "Drilling Charges", depth: "801–900",   qty: "", rate: "" },
  { description: "Drilling Charges", depth: "901–1000",  qty: "", rate: "" },
  { description: "Drilling Charges", depth: "1001–1100", qty: "", rate: "" },
  { description: "Drilling Charges", depth: "1101–1200", qty: "", rate: "" },
  { description: "Drilling Charges", depth: "1201–1300", qty: "", rate: "" },
  { description: "Drilling Charges", depth: "1301–1400", qty: "", rate: "" },
  { description: "Drilling Charges", depth: "1401–1500", qty: "", rate: "" },
  { description: "Drilling Charges", depth: "1501–1600", qty: "", rate: "" },
  { description: "Drilling Charges", depth: "1601–1700", qty: "", rate: "" },
  { description: "Drilling Charges", depth: "1701–1800", qty: "", rate: "" },
  { description: 'Casing Pipe PVC 7"',  depth: "", qty: "", rate: "" },
  { description: 'Casing Pipe PVC 10"', depth: "", qty: "", rate: "" },
  { description: "Coller",             depth: "", qty: "", rate: "" },
  { description: "Wielding",           depth: "", qty: "", rate: "" },
  { description: "Labor & Transport",  depth: "", qty: "", rate: "" },
  { description: "Water Injection",    depth: "", qty: "", rate: "" },
  { description: "Filter Casing",      depth: "", qty: "", rate: "" },
];

const STORE_KEY = "svb_invoice_v4";

/* ════════════════════════════════════════════════
   COMPONENT
════════════════════════════════════════════════ */
const InvoiceGenerator = () => {
  const [rows,       setRows]       = useState(JSON.parse(JSON.stringify(DEFAULT_ROWS)));
  const [applyGST,   setApplyGST]   = useState(false);
  const [advance,    setAdvance]    = useState("");
  const [invDate,    setInvDate]    = useState(todayISO());
  const [savedToast, setSavedToast] = useState(false);
  const [gstError,   setGstError]   = useState("");

  const [to,     setTo]     = useState("");
  const [addr,   setAddr]   = useState("");
  const [mobile, setMobile] = useState("");
  const [gst,    setGst]    = useState("");
  const [pos,    setPos]    = useState("");

  const saveTimer = useRef(null);

  /* ── totals — all non-negative ── */
  const subtotal     = rows.reduce((s, r) => s + (parseFloat(r.qty) || 0) * (parseFloat(r.rate) || 0), 0);
  const cgst         = applyGST ? subtotal * 0.09 : 0;
  const sgst         = applyGST ? subtotal * 0.09 : 0;
  const totalWithGST = subtotal + cgst + sgst;
  const advanceAmt   = Math.min(Math.max(0, parseFloat(advance) || 0), totalWithGST);
  const payable      = Math.max(0, totalWithGST - advanceAmt);

  /* ── load ── */
  useEffect(() => {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) {
      try {
        const s = JSON.parse(saved);
        if (s.rows)     setRows(s.rows);
        if (s.applyGST) setApplyGST(s.applyGST);
        if (s.advance)  setAdvance(s.advance);
        if (s.to)       setTo(s.to);
        if (s.addr)     setAddr(s.addr);
        if (s.mobile)   setMobile(s.mobile);
        if (s.gst)      setGst(s.gst);
        if (s.pos)      setPos(s.pos);
        if (s.invDate)  setInvDate(s.invDate);
      } catch (_) {}
    }
  }, []);

  /* ── autosave ── */
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        rows, applyGST, advance, to, addr, mobile, gst, pos, invDate,
      }));
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1400);
    }, 700);
  }, [rows, applyGST, advance, to, addr, mobile, gst, pos, invDate]);
  

  const updateRow = (i, field, val) =>
    setRows(prev => { const n = [...prev]; n[i] = { ...n[i], [field]: val }; return n; });

  const deleteRow = (i) => setRows(prev => prev.filter((_, idx) => idx !== i));
  const addRow    = ()  => setRows(prev => [...prev, { description: "", depth: "", qty: "", rate: "" }]);

  /* ── Qty change with depth-range validation ── */
  const handleQtyChange = (i, val) => {
    const row = rows[i];
    if (row.depth) {
      const { valid } = validateQty(row.depth, val);
      if (!valid && val !== "") {
        const range = parseDepthRange(row.depth);
        if (range) {
          const max = range.hi - range.lo;
          const clamped = Math.min(Math.max(1, parseFloat(val) || 1), max);
          updateRow(i, "qty", String(clamped));
          return;
        }
      }
    }
    updateRow(i, "qty", val);
  };

  /* ── GST field: max 15 chars, alphanumeric only ── */
  const handleGstChange = (e) => {
    const raw = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase(); // alphanumeric only
    if (raw.length > 15) {
      setGstError("Max 15 characters");
      setGst(raw.slice(0, 15));
      return;
    }
    setGstError("");
    setGst(raw);
  };

  /* ── GST toggle: requires client GST to be filled ── */
  const handleGstToggle = () => {
    if (!applyGST && gst.trim() === "") {
      setGstError("Enter Client GST number first to apply GST");
      return;
    }
    setGstError("");
    setApplyGST(v => !v);
  };

  /* ── advance capped ── */
  const handleAdvanceChange = (e) => {
    const raw    = parseFloat(e.target.value) || 0;
    const capped = Math.min(Math.max(0, raw), totalWithGST);
    setAdvance(capped === 0 ? "" : String(capped));
  };

  const resetAll = () => {
    localStorage.removeItem(STORE_KEY);
    setRows(JSON.parse(JSON.stringify(DEFAULT_ROWS)));
    setApplyGST(false); setAdvance("");
    setTo(""); setAddr(""); setMobile(""); setGst(""); setPos("");
    setInvDate(todayISO());
    setGstError("");
  };

  /* ════════════════════════════════════════════
     PDF EXPORT
     Crisp vector-quality fonts via:
     - Dedicated iframe HTML template
     - Google Fonts Inter loaded & waited on
     - scale:4 + PNG lossless (no JPEG blur)
     - devicePixelRatio override for retina
  ════════════════════════════════════════════ */
  const exportToPDF = () => {
    const filledRows = rows.filter(r =>
      String(r.qty || "").trim() || String(r.rate || "").trim()
    );

    const rowsHTML = filledRows.map(r => {
      const amt = (parseFloat(r.qty) || 0) * (parseFloat(r.rate) || 0);
      return `<tr>
        <td style="padding:4px 6px 4px 16px;border-bottom:1px solid #e8edf2;font-size:11px;color:#1a202c;">${r.description || ""}</td>
        <td style="padding:4px 10px;border-bottom:1px solid #e8edf2;font-size:11px;color:#4a5568;white-space:nowrap;">${r.depth || ""}</td>
        <td style="padding:4px 10px;border-bottom:1px solid #e8edf2;font-size:11px;text-align:right;font-variant-numeric:tabular-nums;">${r.qty || ""}</td>
        <td style="padding:4px 10px;border-bottom:1px solid #e8edf2;font-size:11px;text-align:right;font-variant-numeric:tabular-nums;">${r.rate ? Number(r.rate).toLocaleString("en-IN") : ""}</td>
        <td style="padding:4px 16px 4px 6px;border-bottom:1px solid #e8edf2;font-size:11px;text-align:right;font-weight:700;color:${amt > 0 ? "#1a56a0" : "#bbb"};font-variant-numeric:tabular-nums;">${amt > 0 ? "&#8377;" + fmt(amt) : "&#8212;"}</td>
      </tr>`;
    }).join("");

    const gstHTML = applyGST ? `
      <tr><td style="padding:3px 0;font-size:11px;color:#4a5568;">CGST (9%)</td><td style="padding:3px 0;font-size:11px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">&#8377;${fmt(cgst)}</td></tr>
      <tr><td style="padding:3px 0;font-size:11px;color:#4a5568;">SGST (9%)</td><td style="padding:3px 0;font-size:11px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">&#8377;${fmt(sgst)}</td></tr>
      <tr><td style="padding:3px 0;font-size:12px;color:#1a56a0;font-weight:700;">Total with GST</td><td style="padding:3px 0;font-size:12px;text-align:right;font-weight:700;color:#1a56a0;font-variant-numeric:tabular-nums;">&#8377;${fmt(totalWithGST)}</td></tr>` : "";

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{
    font-family:'Inter',Arial,sans-serif;
    font-size:12px;color:#1a202c;background:#fff;
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
    -webkit-font-smoothing:antialiased;
    -moz-osx-font-smoothing:grayscale;
    text-rendering:optimizeLegibility;
  }
  table{border-collapse:collapse;}
</style>
</head>
<body>
<div style="width:794px;background:#fff;">

  <!-- HEADER -->
  <div style="background:#1a56a0;padding:16px 20px 14px;text-align:center;">
    <div style="font-size:23px;font-weight:800;letter-spacing:0.04em;color:#fff;line-height:1.2;">SREE VINAYAKA BOREWELLS</div>
    <div style="font-size:12px;margin-top:5px;color:#bee3f8;font-weight:500;">+91 9845707341 &nbsp;|&nbsp; 9945233338</div>
    <div style="font-size:11px;margin-top:3px;color:#90cdf4;">#1413, Kuvempu Rd, 2nd Block, BSK 6th Stage, Bangalore &#8211; 560062</div>
    <div style="display:inline-block;margin-top:9px;border:1.5px solid rgba(255,255,255,0.45);color:#fff;font-size:10px;font-weight:700;letter-spacing:0.12em;padding:3px 18px;border-radius:20px;">E-BILL</div>
  </div>

  <!-- CLIENT DETAILS -->
  <div style="padding:10px 20px 10px;border-bottom:1.5px solid #e8edf2;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#4a7fac;margin-bottom:8px;">Client Details</div>
    <table style="width:100%;">
      <tr>
        <td style="width:22%;padding:0 10px 5px 0;vertical-align:top;">
          <div style="font-size:9px;color:#637d96;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">Client Name</div>
          <div style="font-size:12.5px;font-weight:600;color:#1a202c;">${to || "&#8212;"}</div>
        </td>
        <td style="width:22%;padding:0 10px 5px;vertical-align:top;">
          <div style="font-size:9px;color:#637d96;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">Mobile No.</div>
          <div style="font-size:12.5px;color:#1a202c;">${mobile || "&#8212;"}</div>
        </td>
        <td style="width:22%;padding:0 10px 5px;vertical-align:top;">
          <div style="font-size:9px;color:#637d96;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">Address</div>
          <div style="font-size:12.5px;color:#1a202c;">${addr || "&#8212;"}</div>
        </td>
        <td style="width:22%;padding:0 10px 5px;vertical-align:top;">
          <div style="font-size:9px;color:#637d96;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">Place of Supply</div>
          <div style="font-size:12.5px;color:#1a202c;">${pos || "&#8212;"}</div>
        </td>
        <td style="width:12%;padding:0 0 5px 10px;vertical-align:top;text-align:right;">
          <div style="font-size:9px;color:#637d96;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">Date</div>
          <div style="font-size:12.5px;font-weight:600;color:#1a3a5c;">${isoToDisplay(invDate)}</div>
        </td>
      </tr>
      ${gst ? `<tr><td colspan="5" style="padding:2px 0 0;">
        <span style="font-size:9px;color:#637d96;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">Client GST: </span>
        <span style="font-size:11.5px;color:#1a202c;font-weight:600;">${gst}</span>
      </td></tr>` : ""}
    </table>
  </div>

  <!-- ITEMS TABLE -->
  <div style="border-bottom:1.5px solid #e8edf2;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#4a7fac;padding:8px 16px 4px;">Items</div>
    <table style="width:100%;">
      <thead>
        <tr style="background:#f0f6ff;border-bottom:2px solid #bee3f8;">
          <th style="padding:6px 6px 6px 16px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#4a7fac;text-align:left;width:34%;">Description</th>
          <th style="padding:6px 10px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#4a7fac;text-align:left;width:20%;white-space:nowrap;">Depth (ft)</th>
          <th style="padding:6px 10px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#4a7fac;text-align:right;width:12%;">Qty</th>
          <th style="padding:6px 10px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#4a7fac;text-align:right;width:16%;">Rate (&#8377;)</th>
          <th style="padding:6px 16px 6px 6px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#4a7fac;text-align:right;width:18%;">Amount (&#8377;)</th>
        </tr>
      </thead>
      <tbody>${rowsHTML || `<tr><td colspan="5" style="padding:12px 16px;font-size:11px;color:#aaa;text-align:center;">No items entered</td></tr>`}</tbody>
    </table>
  </div>

  <!-- BANK + SUMMARY -->
  <table style="width:100%;border-bottom:1.5px solid #e8edf2;">
    <tr style="vertical-align:top;">
      <td style="width:52%;padding:12px 20px;border-right:1.5px solid #e8edf2;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#4a7fac;margin-bottom:8px;">Bank Details</div>
        <table style="width:100%;">
          <tr><td style="padding:2.5px 0;font-size:11px;color:#637d96;font-weight:600;width:68px;">Bank</td><td style="padding:2.5px 0;font-size:11px;color:#1a202c;">Union Bank</td></tr>
          <tr><td style="padding:2.5px 0;font-size:11px;color:#637d96;font-weight:600;">Branch</td><td style="padding:2.5px 0;font-size:11px;color:#1a202c;">Poornaprajna Layout</td></tr>
          <tr><td style="padding:2.5px 0;font-size:11px;color:#637d96;font-weight:600;">A/C Name</td><td style="padding:2.5px 0;font-size:11px;color:#1a202c;">Sree Vinayaka Borewell</td></tr>
          <tr><td style="padding:2.5px 0;font-size:11px;color:#637d96;font-weight:600;">A/C No.</td><td style="padding:2.5px 0;font-size:11px;color:#1a202c;font-weight:700;">199311100001477</td></tr>
          <tr><td style="padding:2.5px 0;font-size:11px;color:#637d96;font-weight:600;">IFSC</td><td style="padding:2.5px 0;font-size:11px;color:#1a202c;">UBIN0819930</td></tr>
        </table>
        <div style="margin-top:20px;">
          <div style="font-size:10px;color:#637d96;font-weight:600;">Authorised Signature</div>
          <div style="margin-top:24px;width:110px;border-top:1.5px solid #1a202c;"></div>
        </div>
      </td>
      <td style="width:48%;padding:12px 20px;vertical-align:top;">
        <table style="width:100%;">
          <tr>
            <td style="padding:3px 0;font-size:11px;color:#4a5568;">Subtotal</td>
            <td style="padding:3px 0;font-size:11px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">&#8377;${fmt(subtotal)}</td>
          </tr>
          ${gstHTML}
          <tr><td colspan="2" style="padding:4px 0;"><div style="border-top:1px solid #e8edf2;"></div></td></tr>
          <tr>
            <td style="padding:3px 0;font-size:11px;color:#4a5568;">Advance Paid</td>
            <td style="padding:3px 0;font-size:11px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">&#8377;${fmt(advanceAmt)}</td>
          </tr>
          <tr><td colspan="2" style="padding:5px 0;"><div style="border-top:2.5px solid #1a56a0;"></div></td></tr>
          <tr>
            <td style="padding:5px 0 2px;font-size:14px;font-weight:700;color:#1a202c;">Amount Payable</td>
            <td style="padding:5px 0 2px;font-size:18px;font-weight:800;text-align:right;color:#1a56a0;font-variant-numeric:tabular-nums;">&#8377;${fmt(payable)}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:3px 0 0;font-size:10px;color:#637d96;font-style:italic;">${numberToWords(Math.round(payable))} Only</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- NOTE -->
  <div style="background:#fffbeb;padding:9px 20px;font-size:11px;color:#744210;text-align:center;line-height:1.5;border-top:1px solid #f6e05e;">
    Note: Final amount may vary based on drilling depth. Minimum 50% advance required before drilling begins.
  </div>

</div>
</body>
</html>`;

    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;left:-9999px;top:0;width:794px;height:2400px;border:none;visibility:hidden;";
    document.body.appendChild(iframe);

    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();

    // Wait for Google Fonts to fully load inside iframe
    const iframeWin = iframe.contentWindow;
    const doCapture = () => {
      const body = iframe.contentDocument.body;
      const contentH = body.scrollHeight;

      html2canvas(body, {
        scale: 4,                        // 4× = crisp retina-quality text
        useCORS: true,
        allowTaint: true,
        logging: false,
        width: 794,
        height: contentH,
        windowWidth: 794,
        windowHeight: contentH,
        backgroundColor: "#ffffff",
        imageTimeout: 0,
        onclone: (doc) => {
          // force font rendering in cloned doc
          doc.body.style.webkitFontSmoothing = "antialiased";
        }
      }).then(canvas => {
        const imgData  = canvas.toDataURL("image/png");   // lossless PNG
        const pdf      = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
        const pdfW     = pdf.internal.pageSize.getWidth();   // 210mm
        const pdfH     = pdf.internal.pageSize.getHeight();  // 297mm
        const pxToMm   = 210 / 794;
        const imgHmm   = contentH * pxToMm;

        if (imgHmm <= pdfH) {
          pdf.addImage(imgData, "PNG", 0, 0, pdfW, imgHmm);
        } else {
          // Scale entire content to fit single A4 page
          const scale   = pdfH / imgHmm;
          const scaledW = pdfW * scale;
          pdf.addImage(imgData, "PNG", (pdfW - scaledW) / 2, 0, scaledW, pdfH);
        }

        const name = to ? to.trim().replace(/\s+/g, "_") : "invoice";
        pdf.save(`${name}_${isoToDisplay(invDate).replace(/\s/g, "-")}.pdf`);
        document.body.removeChild(iframe);
      }).catch(err => {
        console.error("PDF error:", err);
        document.body.removeChild(iframe);
      });
    };

    // Use FontFaceSet API if available, else fallback timeout
    if (iframeWin.document.fonts && iframeWin.document.fonts.ready) {
      iframeWin.document.fonts.ready.then(doCapture);
    } else {
      setTimeout(doCapture, 1000);
    }
  };

  /* ════ RENDER ════ */
  return (
    <div className="inv-page">
      {savedToast && <div className="inv-toast">✓ Saved</div>}

      <div className="inv-wrap">

        {/* HEADER */}
        <header className="inv-header">
          <h1 className="inv-company">SIRI BOREWELLS</h1>
          <p className="inv-contact">+91 9700408883 </p>
          <p className="inv-address">#517/B ,6 th main road, Maruthi Layout, TC palya, KR Puram, Bangalore 560049</p>
          <span className="inv-ebill-badge">E-BILL</span>
        </header>

        {/* CLIENT DETAILS — date moved here, next to GST */}
        <section className="inv-section">
          <h2 className="inv-section-title">Client Details</h2>
          <div className="inv-fields">
            <div className="inv-field">
              <label className="inv-label">Client Name</label>
              <input className="inv-input" value={to} onChange={e => setTo(e.target.value)} placeholder="Full name" />
            </div>
            <div className="inv-field">
              <label className="inv-label">Mobile No.</label>
              <input className="inv-input" value={mobile} onChange={e => setMobile(e.target.value)} placeholder="+91 XXXXX XXXXX" type="tel" />
            </div>
            <div className="inv-field">
              <label className="inv-label">Address</label>
              <input className="inv-input" value={addr} onChange={e => setAddr(e.target.value)} placeholder="Client address" />
            </div>
            <div className="inv-field">
              <label className="inv-label">Place of Supply</label>
              <input className="inv-input" value={pos} onChange={e => setPos(e.target.value)} placeholder="City / District" />
            </div>

            {/* GST + Date side by side */}
            <div className="inv-field inv-field--gst">
              <label className="inv-label">
                Client GST
                <span className="inv-gst-hint"> (max 15 chars)</span>
              </label>
              <input
                className={`inv-input ${gstError ? "inv-input--error" : ""}`}
                value={gst}
                onChange={handleGstChange}
                placeholder="22AAAAA0000A1Z5"
                maxLength={15}
              />
              {gstError && <span className="inv-field-error">{gstError}</span>}
            </div>

            <div className="inv-field inv-field--date">
              <label className="inv-label">Date</label>
              <input
                className="inv-input inv-date-input"
                type="date"
                value={invDate}
                onChange={e => setInvDate(e.target.value || todayISO())}
              />
            </div>
          </div>
        </section>

        {/* ITEMS */}
        <section className="inv-section inv-section--table">
          <h2 className="inv-section-title">
            Items
            <button className="inv-add-btn no-print" onClick={addRow}>+ Add Row</button>
          </h2>

          {/* Desktop table */}
          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th className="col-desc">Description</th>
                  <th className="col-depth">Depth (ft)</th>
                  <th className="col-num">Qty</th>
                  <th className="col-num">Rate (₹)</th>
                  <th className="col-amt">Amount (₹)</th>
                  <th className="col-del no-print"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const amount = (parseFloat(row.qty) || 0) * (parseFloat(row.rate) || 0);
                  const { error: qtyErr } = validateQty(row.depth, row.qty);
                  return (
                    <tr key={i}>
                      <td>
                        <input className="inv-table-input inv-table-input--desc"
                          value={row.description}
                          onChange={e => updateRow(i, "description", e.target.value)} />
                      </td>
                      <td>
                        <input className="inv-table-input inv-table-input--depth"
                          value={row.depth}
                          onChange={e => updateRow(i, "depth", e.target.value)}
                          placeholder="—" />
                      </td>
                      <td>
                        <input
                          className={`inv-table-input inv-table-input--num ${qtyErr ? "inv-table-input--err" : ""}`}
                          type="number" inputMode="decimal"
                          value={row.qty}
                          onChange={e => handleQtyChange(i, e.target.value)}
                          placeholder="0"
                          title={qtyErr || ""}
                        />
                      </td>
                      <td>
                        <input className="inv-table-input inv-table-input--num"
                          type="number" inputMode="decimal"
                          value={row.rate}
                          onChange={e => updateRow(i, "rate", e.target.value)}
                          placeholder="0" />
                      </td>
                      <td className="inv-table-amount">
                        {amount > 0 ? `₹${fmt(amount)}` : "—"}
                      </td>
                      <td className="no-print">
                        <button className="inv-del-btn" onClick={() => deleteRow(i)}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="inv-mobile-rows">
            {rows.map((row, i) => {
              const amount = (parseFloat(row.qty) || 0) * (parseFloat(row.rate) || 0);
              const { error: qtyErr } = validateQty(row.depth, row.qty);
              return (
                <div key={i} className="inv-mobile-row">
                  <div className="inv-mobile-row__header">
                    <input className="inv-input inv-mobile-desc"
                      value={row.description}
                      onChange={e => updateRow(i, "description", e.target.value)}
                      placeholder="Description" />
                    <button className="inv-del-btn no-print" onClick={() => deleteRow(i)}>✕</button>
                  </div>
                  <div className="inv-mobile-row__depth">
                    <span className="inv-label">Depth:</span>
                    <input className="inv-input inv-input--sm"
                      value={row.depth}
                      onChange={e => updateRow(i, "depth", e.target.value)}
                      placeholder="ft range" />
                  </div>
                  <div className="inv-mobile-row__nums">
                    <div className="inv-mobile-num">
                      <label className="inv-label">Qty{qtyErr ? <span className="inv-qty-err"> ({qtyErr})</span> : null}</label>
                      <input className={`inv-input inv-input--num ${qtyErr ? "inv-input--error" : ""}`}
                        type="number" inputMode="decimal"
                        value={row.qty}
                        onChange={e => handleQtyChange(i, e.target.value)}
                        placeholder="0" />
                    </div>
                    <div className="inv-mobile-num">
                      <label className="inv-label">Rate (₹)</label>
                      <input className="inv-input inv-input--num"
                        type="number" inputMode="decimal"
                        value={row.rate}
                        onChange={e => updateRow(i, "rate", e.target.value)}
                        placeholder="0" />
                    </div>
                    <div className="inv-mobile-num inv-mobile-num--amount">
                      <label className="inv-label">Amount</label>
                      <span className="inv-amount-display">₹{fmt(amount)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* SUMMARY + BANK */}
        <section className="inv-bottom">
          <div className="inv-bank">
            <h3 className="inv-bank-title">Bank Details</h3>
            <div className="inv-bank-row"><span>Bank</span><span>State Bank of India</span></div>
            <div className="inv-bank-row"><span>Branch</span><span>DODDAKALLASANDRA</span></div>
            <div className="inv-bank-row"><span>A/C Name</span><span>HARI PRASAD P</span></div>
            <div className="inv-bank-row"><span>A/C No.</span><span>42893335380</span></div>
            <div className="inv-bank-row"><span>IFSC</span><span>SBIN0040653</span></div>
            <div className="inv-signature">
              <span>Authorised Signature</span>
              <div className="inv-signature-line"></div>
            </div>
          </div>

          <div className="inv-summary">
            <div className="inv-sum-row"><span>Subtotal</span><span>₹{fmt(subtotal)}</span></div>

            {applyGST && (
              <>
                <div className="inv-sum-divider" />
                <div className="inv-sum-row"><span>CGST (9%)</span><span>₹{fmt(cgst)}</span></div>
                <div className="inv-sum-row"><span>SGST (9%)</span><span>₹{fmt(sgst)}</span></div>
                <div className="inv-sum-row inv-sum-row--gst-total">
                  <span>Total with GST</span><span>₹{fmt(totalWithGST)}</span>
                </div>
              </>
            )}

            <div className="inv-sum-divider" />
            <div className="inv-sum-row inv-sum-row--advance">
              <label className="inv-label">Advance Paid (₹)</label>
              <input
                className="inv-input inv-input--num inv-advance-input"
                type="number" inputMode="decimal"
                value={advance}
                onChange={handleAdvanceChange}
                placeholder="0" min="0"
              />
            </div>
            <div className="inv-sum-divider" />

            <div className="inv-sum-total">
              <span>Amount Payable</span>
              <span>₹{fmt(payable)}</span>
            </div>
            <div className="inv-sum-words">{numberToWords(Math.round(payable))} Only</div>
          </div>
        </section>

        {/* NOTE */}
        <div className="inv-note">
          Note: Final amount may vary based on drilling depth. Minimum 50% advance required before drilling begins.
        </div>

        {/* ACTIONS */}
        <div className="inv-actions no-print">
          <button className="inv-btn inv-btn--muted" onClick={resetAll}>Reset All</button>
          <button
            className={`inv-btn ${applyGST ? "inv-btn--gst-on" : "inv-btn--gst-off"}`}
            onClick={handleGstToggle}
            title={!gst ? "Fill Client GST first" : ""}
          >
            {applyGST ? "✓ GST Applied" : "Apply GST (18%)"}
          </button>
          <button className="inv-btn inv-btn--export" onClick={exportToPDF}>Export PDF</button>
        </div>

      </div>
    </div>
  );
};

export default InvoiceGenerator;