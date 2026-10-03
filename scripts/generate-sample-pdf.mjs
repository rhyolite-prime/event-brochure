/**
 * Generates a sample funeral service brochure PDF into public/brochure.pdf.
 * Replace public/brochure.pdf with the real brochure at any time —
 * the viewer picks it up automatically.
 *
 * Run with: npm run make:pdf
 */
import PDFDocument from 'pdfkit'
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = resolve(__dirname, '../public/brochure.pdf')
mkdirSync(dirname(outPath), { recursive: true })

const PAGE = { size: [432, 648], margins: { top: 64, bottom: 64, left: 56, right: 56 } } // 6x9 in
const doc = new PDFDocument({ ...PAGE, autoFirstPage: false, bufferPages: true, info: {
  Title: 'In Loving Memory — Eleanor Mae Whitfield',
  Author: 'Whitfield Family',
  Subject: 'Celebration of Life Service Brochure'
} })
doc.pipe(createWriteStream(outPath))

const INK = '#2b2b2b'
const ACCENT = '#8a6d3b'
const SOFT = '#6b6b6b'
const W = PAGE.size[0]
const CW = W - PAGE.margins.left - PAGE.margins.right

function rule (y = doc.y + 10) {
  const cx = W / 2
  doc.save()
  doc.moveTo(cx - 70, y).lineTo(cx + 70, y).lineWidth(0.7).strokeColor(ACCENT).stroke()
  doc.circle(cx, y, 2.2).fillColor(ACCENT).fill()
  doc.restore()
  doc.y = y + 18
}

function heading (text) {
  doc.moveDown(0.2)
  doc.font('Times-Bold').fontSize(20).fillColor(INK).text(text, { align: 'center' })
  rule()
}

function body (text, opts = {}) {
  doc.font('Times-Roman').fontSize(11.5).fillColor(INK)
    .text(text, { align: 'justify', lineGap: 3.5, ...opts })
}

function centered (text, opts = {}) {
  doc.font('Times-Roman').fontSize(11.5).fillColor(INK)
    .text(text, { align: 'center', lineGap: 3, ...opts })
}

function item (title, detail) {
  doc.moveDown(0.55)
  doc.font('Times-Bold').fontSize(12).fillColor(INK).text(title, { align: 'center' })
  if (detail) doc.font('Times-Italic').fontSize(10.5).fillColor(SOFT).text(detail, { align: 'center' })
}

/* ---------------------------------- Cover ---------------------------------- */
doc.addPage()
const cover = doc.outline.addItem('Cover')
doc.save()
doc.rect(18, 18, W - 36, 648 - 36).lineWidth(1.2).strokeColor(ACCENT).stroke()
doc.rect(24, 24, W - 48, 648 - 48).lineWidth(0.5).strokeColor(ACCENT).stroke()
doc.restore()
doc.moveDown(3)
doc.font('Times-Italic').fontSize(15).fillColor(ACCENT).text('In Loving Memory of', { align: 'center' })
doc.moveDown(1.2)
doc.font('Times-Bold').fontSize(30).fillColor(INK).text('Eleanor Mae', { align: 'center' })
doc.font('Times-Bold').fontSize(30).text('Whitfield', { align: 'center' })
rule(doc.y + 16)
doc.moveDown(0.4)
doc.font('Times-Roman').fontSize(13).fillColor(SOFT).text('March 14, 1941  —  September 21, 2025', { align: 'center' })
doc.moveDown(5)
doc.font('Times-Italic').fontSize(12).fillColor(INK)
  .text('“To live in hearts we leave behind\nis not to die.”', { align: 'center', lineGap: 4 })
doc.font('Times-Roman').fontSize(10).fillColor(SOFT).moveDown(0.4).text('— Thomas Campbell', { align: 'center' })
doc.moveDown(4)
centered('Celebration of Life')
centered('Saturday, October 4, 2025  ·  11:00 AM')
centered('Grace Chapel  ·  412 Linden Avenue  ·  Maplewood')

/* ----------------------------- Order of Service ----------------------------- */
doc.addPage()
doc.outline.addItem('Order of Service')
heading('Order of Service')
item('Prelude', '“Clair de Lune” — performed by the Grace Chapel Quartet')
item('Processional', 'Officiant and Family')
item('Opening Prayer', 'Reverend Daniel Okafor')
item('Hymn', '“Amazing Grace” — Congregation')
item('Scripture Reading', 'Psalm 23 — read by Marcus Whitfield, son')
item('Remembrances', 'Family and Friends')
item('Musical Tribute', '“What a Wonderful World” — Ada Whitfield, granddaughter')
item('Eulogy', 'Delivered by Claire Whitfield-Reyes, daughter')
item('Hymn', '“It Is Well with My Soul” — Congregation')
item('Words of Comfort', 'Reverend Daniel Okafor')
item('Benediction and Recessional', '“Ode to Joy”')
doc.moveDown(1.2)
rule()
doc.font('Times-Italic').fontSize(10.5).fillColor(SOFT)
  .text('Interment to follow at Maplewood Memorial Gardens.', { align: 'center' })

/* --------------------------------- Obituary --------------------------------- */
doc.addPage()
doc.outline.addItem('A Life Remembered')
heading('A Life Remembered')
body('Eleanor Mae Whitfield was born on March 14, 1941, in Savannah, Georgia, the second of four children of Harold and Ruth Caldwell. From her earliest days she was known for a quick laugh, an unshakable sense of fairness, and a gift for making every guest at her table feel like family.')
doc.moveDown(0.6)
body('Eleanor graduated from Spelman College in 1963 with a degree in education, and for thirty-four years she taught English literature at Maplewood High School, where generations of students remember her habit of reciting poetry from memory and her insistence that every voice in the classroom mattered. She was named Teacher of the Year three times, an honor she accepted each time, in her words, “on behalf of the semicolon.”')
doc.moveDown(0.6)
body('In 1965 she married the love of her life, James Whitfield, a union of sixty years marked by Sunday drives, crossword puzzles done in ink, and a garden that was the envy of Linden Avenue. Together they raised two children, Claire and Marcus, and delighted in five grandchildren and two great-grandchildren.')
doc.moveDown(0.6)
body('Eleanor was a devoted member of Grace Chapel, where she sang alto in the choir for four decades and organized the annual harvest food drive. She loved peach cobbler, Ella Fitzgerald records, long letters written by hand, and the first cool morning of autumn.')
doc.moveDown(0.6)
body('She is survived by her husband James; her children Claire Whitfield-Reyes (Antonio) and Marcus Whitfield (Dana); grandchildren Ada, Simone, Elijah, Rosa, and June; great-grandchildren Theo and Maya; and her sister, Lillian Caldwell Brooks. She was preceded in death by her parents and her brothers, Harold Jr. and Thomas.')

/* ----------------------------- Hymns & Readings ----------------------------- */
doc.addPage()
doc.outline.addItem('Hymns & Readings')
heading('Hymns & Readings')
doc.font('Times-Bold').fontSize(13).fillColor(INK).text('Amazing Grace', { align: 'center' })
doc.moveDown(0.3)
centered('Amazing grace! How sweet the sound\nThat saved a wretch like me!\nI once was lost, but now am found;\nWas blind, but now I see.')
doc.moveDown(0.4)
centered('’Twas grace that taught my heart to fear,\nAnd grace my fears relieved;\nHow precious did that grace appear\nThe hour I first believed.')
doc.moveDown(1)
rule()
doc.font('Times-Bold').fontSize(13).fillColor(INK).text('Psalm 23', { align: 'center' })
doc.moveDown(0.3)
centered('The Lord is my shepherd; I shall not want.\nHe maketh me to lie down in green pastures:\nhe leadeth me beside the still waters.\nHe restoreth my soul.')
doc.moveDown(0.4)
centered('Yea, though I walk through the valley of the shadow of death,\nI will fear no evil: for thou art with me;\nthy rod and thy staff they comfort me.\nSurely goodness and mercy shall follow me all the days of my life:\nand I will dwell in the house of the Lord for ever.')

/* ------------------------------ It Is Well hymn ------------------------------ */
doc.addPage()
doc.outline.addItem('It Is Well with My Soul')
heading('It Is Well with My Soul')
centered('When peace like a river attendeth my way,\nWhen sorrows like sea billows roll;\nWhatever my lot, Thou hast taught me to say,\nIt is well, it is well with my soul.')
doc.moveDown(0.5)
centered('It is well with my soul,\nIt is well, it is well with my soul.')
doc.moveDown(1)
rule()
doc.font('Times-Bold').fontSize(13).fillColor(INK).text('Remembering Grandma Ellie', { align: 'center' })
doc.moveDown(0.3)
doc.font('Times-Italic').fontSize(11.5).fillColor(INK)
  .text('“She kept a tin of butter cookies on the second shelf, and a poem for every occasion. She taught us that kindness is a habit, not a mood — and that no one leaves her kitchen hungry.”', { align: 'center', lineGap: 3.5 })
doc.moveDown(0.3)
doc.font('Times-Roman').fontSize(10.5).fillColor(SOFT).text('— The grandchildren', { align: 'center' })

/* ------------------------------ Acknowledgements ------------------------------ */
doc.addPage()
doc.outline.addItem('Acknowledgements')
heading('Acknowledgements')
body('The family of Eleanor Mae Whitfield wishes to express heartfelt gratitude for the outpouring of love, prayers, phone calls, flowers, and every act of kindness shown during this time of loss. Your compassion has been a source of great comfort.')
doc.moveDown(0.6)
body('Special thanks to the congregation of Grace Chapel, the Maplewood High School alumni community, and the caring staff of Riverside Hospice for their gentle devotion in Eleanor’s final months.')
doc.moveDown(1)
rule()
doc.font('Times-Bold').fontSize(12.5).fillColor(INK).text('Pallbearers', { align: 'center' })
doc.moveDown(0.2)
centered('Marcus Whitfield  ·  Antonio Reyes  ·  Elijah Whitfield\nDavid Brooks  ·  Samuel Okafor  ·  Gerald Mason')
doc.moveDown(0.8)
doc.font('Times-Bold').fontSize(12.5).fillColor(INK).text('Repast', { align: 'center' })
doc.moveDown(0.2)
centered('Immediately following the interment,\nthe family invites you to the Grace Chapel Fellowship Hall\nfor a meal and the sharing of memories.')
doc.moveDown(0.8)
doc.font('Times-Bold').fontSize(12.5).fillColor(INK).text('In Lieu of Flowers', { align: 'center' })
doc.moveDown(0.2)
centered('Donations may be made to the\nEleanor M. Whitfield Scholarship for Future Teachers\nc/o Maplewood High School.')

/* --------------------------------- Back cover --------------------------------- */
doc.addPage()
doc.outline.addItem('Back Cover')
doc.save()
doc.rect(18, 18, W - 36, 648 - 36).lineWidth(1.2).strokeColor(ACCENT).stroke()
doc.restore()
doc.moveDown(6)
doc.font('Times-Italic').fontSize(14).fillColor(INK)
  .text('“And now these three remain:\nfaith, hope and love.\nBut the greatest of these is love.”', { align: 'center', lineGap: 5 })
doc.moveDown(0.5)
doc.font('Times-Roman').fontSize(10.5).fillColor(SOFT).text('— 1 Corinthians 13:13', { align: 'center' })
doc.moveDown(6)
rule()
centered('Services entrusted to')
doc.font('Times-Bold').fontSize(12).fillColor(INK).text('Harmony Rest Funeral Home', { align: 'center' })
doc.font('Times-Roman').fontSize(10.5).fillColor(SOFT)
  .text('88 Willow Lane, Maplewood  ·  (555) 014-2210', { align: 'center' })

void cover
doc.end()
console.log('Wrote', outPath)
