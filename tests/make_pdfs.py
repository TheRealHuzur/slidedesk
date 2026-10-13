"""Erzeugt Beispiel-PDFs im Seitenformat 16:9 fuer die Tests (wie aus PowerPoint exportiert)."""
import os, sys
from reportlab.lib.pagesizes import landscape
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white, black

W, H = 960, 540
out = sys.argv[1] if len(sys.argv) > 1 else 'tests/ablage'

def deck(path, title, slides, accent='#0ea5e9'):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    c = canvas.Canvas(path, pagesize=(W, H))
    for i, (head, body) in enumerate(slides, 1):
        c.setFillColor(white); c.rect(0, 0, W, H, fill=1, stroke=0)
        c.setFillColor(HexColor(accent)); c.rect(0, H - 90, W, 90, fill=1, stroke=0)
        c.setFillColor(white); c.setFont('Helvetica-Bold', 34); c.drawString(50, H - 62, head)
        c.setFillColor(HexColor('#1e293b')); c.setFont('Helvetica', 24)
        y = H - 150
        for line in body:
            c.drawString(70, y, '• ' + line); y -= 42
        c.setFont('Helvetica', 12); c.setFillColor(HexColor('#64748b'))
        c.drawString(50, 24, f'{title}  |  Folie {i}')
        c.showPage()
    c.save()

def bpmn(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    c = canvas.Canvas(path, pagesize=(W, H))
    for i in range(1, 7):
        c.setFillColor(white); c.rect(0, 0, W, H, fill=1, stroke=0)
        c.setFillColor(HexColor('#0f172a')); c.setFont('Helvetica-Bold', 28)
        c.drawString(40, H - 50, f'BPMN Diagramm {i}: Antrag bearbeiten')
        x = 60
        for k in range(7):
            c.setStrokeColor(HexColor('#0ea5e9')); c.setLineWidth(2)
            c.roundRect(x, 240, 100, 60, 10, stroke=1, fill=0)
            c.setFont('Helvetica', 9); c.setFillColor(black)
            c.drawCentredString(x + 50, 266, f'Schritt {k + 1}')
            c.setFont('Helvetica', 4); c.drawCentredString(x + 50, 250, 'kleine Detailbeschriftung Ist-Prozess')
            if k < 6:
                c.line(x + 100, 270, x + 125, 270)
            x += 125
        c.setFont('Helvetica', 14); c.drawString(40, 120, 'Prozesslandkarte mit Verantwortlichkeiten und Schnittstellen')
        c.showPage()
    c.save()

deck(f'{out}/Seminarunterlagen/Duisburg/Einstieg Duisburg.pdf', 'Einstieg Duisburg', [
    ('Herzlich willkommen', ['Seminar Prozessmanagement', 'Stadt Duisburg', 'Ablauf des Tages']),
    ('Vorstellungsrunde', ['Name und Aufgabe', 'Erwartungen an heute']),
    ('Ich möchte gerne lernen', ['Flipchart-Abfrage', 'Wünsche sammeln']),
    ('Organisatorisches', ['Pausen', 'Unterlagen', 'Fotoprotokoll']),
], '#334155')
deck(f'{out}/Module/Prozessmanagement Grundlagen.pdf', 'Prozessmanagement Grundlagen', [
    (f'Grundlagen Teil {i}', [f'Prozessbegriff Abschnitt {i}', 'Kunden und Lieferanten', 'Messgrößen und Kennzahlen'])
    for i in range(1, 13)
] + [('Personalbedarfsermittlung', ['Analytische Verfahren', 'Schätzverfahren', 'Arbeitsplatzmethode'])])
bpmn(f'{out}/Module/BPMN Diagramme.pdf')
deck(f'{out}/Marketing/Pause Newsletter.pdf', 'Pause', [
    ('Kaffeepause', ['Newsletter abonnieren', 'QR-Code scannen']),
    ('Wissen und Werkzeug', ['Seminare und Beratung', 'wissen-und-werkzeug.de']),
], '#0ea5e9')
print('pdfs ok')
