import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { InvoiceFull } from './types'

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
const qtyFmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

// Builds a clean one-page invoice PDF and returns the jsPDF doc.
export function buildInvoicePdf(
  invoice: InvoiceFull,
  productName: Map<string, string>,
): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth()
  const M = 48

  // Header
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('GRINDSTONE CONCRETE', M, 56)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text('INVOICE', pageW - M, 56, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  if (invoice.bill_number) doc.text(`Bill #${invoice.bill_number}`, pageW - M, 72, { align: 'right' })
  if (invoice.date_sent) doc.text(invoice.date_sent.slice(0, 10), pageW - M, 86, { align: 'right' })

  // Bill-to / job block
  let y = 118
  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text('JOB', M, y)
  doc.text('CLIENT', pageW / 2, y)
  y += 14
  doc.setTextColor(20)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text(invoice.job?.name ?? '—', M, y)
  doc.text(invoice.job?.client?.name ?? '—', pageW / 2, y)
  doc.setFont('helvetica', 'normal')

  // Line-item table
  const body = [...invoice.lines]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((l) => {
      const amt = l.amount != null ? Number(l.amount) : Number(l.quantity) * Number(l.rate)
      const desc = l.description ?? (l.product_id ? productName.get(l.product_id) : null) ?? 'Work'
      return [
        desc,
        l.unit ?? '',
        qtyFmt(Number(l.quantity)),
        money(Number(l.rate)),
        money(amt),
      ]
    })

  const total = invoice.lines.reduce(
    (s, l) => s + (l.amount != null ? Number(l.amount) : Number(l.quantity) * Number(l.rate)),
    0,
  )

  autoTable(doc, {
    startY: y + 22,
    head: [['Description', 'Unit', 'Qty', 'Rate', 'Amount']],
    body,
    foot: [['', '', '', 'Total', money(total)]],
    theme: 'striped',
    headStyles: { fillColor: [26, 26, 28], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
    styles: { fontSize: 10, cellPadding: 6 },
    columnStyles: {
      1: { halign: 'center', cellWidth: 50 },
      2: { halign: 'right', cellWidth: 70 },
      3: { halign: 'right', cellWidth: 80 },
      4: { halign: 'right', cellWidth: 90 },
    },
    margin: { left: M, right: M },
  })

  // Notes
  if (invoice.notes) {
    const afterY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text('NOTES', M, afterY)
    doc.setTextColor(40)
    doc.setFontSize(10)
    doc.text(doc.splitTextToSize(invoice.notes, pageW - M * 2), M, afterY + 14)
  }

  return doc
}

export function invoiceFileName(invoice: InvoiceFull): string {
  const job = (invoice.job?.name ?? 'invoice').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')
  const bill = invoice.bill_number ? `_Bill${invoice.bill_number}` : ''
  return `${job}${bill}.pdf`
}

export function downloadInvoicePdf(invoice: InvoiceFull, productName: Map<string, string>): void {
  buildInvoicePdf(invoice, productName).save(invoiceFileName(invoice))
}

// Opens the native share sheet with the PDF attached (so it can go straight into
// an iMessage thread). Falls back to a normal download when sharing files isn't
// supported. If the user cancels the share sheet, nothing else happens.
export async function shareInvoicePdf(
  invoice: InvoiceFull,
  productName: Map<string, string>,
): Promise<void> {
  const doc = buildInvoicePdf(invoice, productName)
  const fname = invoiceFileName(invoice)
  try {
    const file = new File([doc.output('blob')], fname, { type: 'application/pdf' })
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
    if (nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: fname })
      return
    }
  } catch (e) {
    // User cancelled the share sheet — don't also download.
    if (e instanceof Error && e.name === 'AbortError') return
    // Otherwise fall through to a plain download.
  }
  doc.save(fname)
}
