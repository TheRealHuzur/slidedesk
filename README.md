# SlideDESK

Seminar-PDFs aus PowerPoint komfortabel präsentieren. Läuft im Browser (Edge oder Chrome unter Windows), offline, ohne Account und ohne Server. Teil der DESK Suite.

App: https://slidedesk.wissen-und-werkzeug.de/ · Anleitung: https://slidedesk.wissen-und-werkzeug.de/hilfe.html (alt: https://therealhuzur.github.io/slidedesk/)

Masterplan: Storage `50_coding/slidedesk/SlideDESK-Masterplan.md`

## Erste Schritte

1. SlideDESK in Edge oder Chrome öffnen.
2. **Ablage freigeben:** den Oberordner wählen, in dem die Seminarunterlagen liegen, z. B. „Operatives Geschäft“ im Google Drive. Beim Nachfragen „Bei jedem Besuch zulassen“ wählen.
3. **Seminar anlegen** und PDFs hinzufügen, gern aus verschiedenen Unterordnern.
4. **Präsentieren:** Modus wählen und auf „Präsentieren“ klicken.

SlideDESK legt in der Ablage einen Ordner `SlideDESK/slidedesk.json` an. Darin stehen Seminare, Schnelltasten, Pausenfolien, Einstellungen und Protokolle. Liegt die Ablage im Google Drive für Desktop, ist alles auf PC und Laptop gleich. PDFs werden nur gelesen, nie verändert.

## Links für das Seminar

Im Bereich **Links** über **+ Link hinzufügen** einen eigenen Namen und die vollständige Webadresse eintragen. Die Einträge lassen sich bearbeiten, löschen und mit den Pfeilen sortieren. Für das nächste Webinar einfach die benötigten Links austauschen.

In der Seminarverwaltung öffnet ein Klick auf den Namen die Website in einem neuen Browser-Tab bzw. gemäß Browsereinstellung. Während einer Zwei-Bildschirm-Präsentation öffnet die Website **auf dem Laptop** in einem eigenen Fenster und wird dort bedient; der Beamer zeigt ein Live-Bild des Laptop-Bildschirms (Bildschirmübertragung des Browsers) und bleibt im Vollbild. Beim ersten Link je Präsentation fragt der Browser, was geteilt wird: „Gesamter Bildschirm“ und den Laptop wählen.

Kommt die Referentenansicht nach vorn (anklicken, Alt + Tab, **Zurück zu Folien**), zeigt der Beamer sofort wieder dieselbe Folie; eine vorgehörte Folie bleibt erhalten. Ein erneuter Linkklick holt das noch offene Website-Fenster samt Navigation nach vorn; Website-Fenster behalten dafür die Verbindung zu SlideDesk (Opener). Schließen des Website-Fensters oder „Freigabe beenden“ in der Browserleiste schalten ebenfalls auf die Folie zurück. In der Referentenansicht ist dieselbe Linkliste verfügbar und bearbeitbar. Die Links werden mit dem Seminar gespeichert und über die vorhandene Ablage synchronisiert. Eine Browser-Erweiterung ist nicht nötig. Pop-ups müssen für SlideDesk erlaubt sein. Die Zeit mit einer externen Website wird nicht als zusätzlich gezeigte PDF-Zeit protokolliert. Bei einem Online-Webinar den Präsentationsbildschirm teilen.

## Präsentationsmodi

- **Gespiegelt:** Windows dupliziert das Bild (Win + P, „Duplizieren“). Alles läuft im Vollbild auf beiden Bildschirmen.
- **Zwei Bildschirme:** Windows auf „Erweitern“ stellen (Win + P). Beim ersten Mal fragt der Browser nach der Fensterverwaltung, eventuell auch nach Pop-ups. Dann legt SlideDESK die Folie selbst auf den Beamer und die Referentenansicht auf den Laptop. Liegt das SlideDesk-Fenster beim Start schon auf dem Beamer, bleibt es dort als Präsentationsfenster (Folien und Website-Tabs in einem Fenster). Ohne diese Erlaubnis öffnet sich ein Beamerfenster, das man auf den Beamer zieht und dort auf „Vollbild“ klickt.

**Vorhören:** Im Zwei-Bildschirm-Modus landen Übersicht, Suche, Gehe zu und Filmstreifen erst in der Vorschau auf dem Laptop. Der Beamer zeigt weiter die aktuelle Folie. Enter schickt die vorgehörte Folie auf den Beamer, Esc verwirft sie.

## Tasten

| Taste | Wirkung |
|---|---|
| → Leertaste Bild ↓ / ← Bild ↑ | nächste / vorherige Folie, über PDF-Grenzen hinweg |
| Umschalt + → / ← | nächstes / vorheriges PDF |
| O | Übersicht aller Folien |
| S oder Strg + F | Volltextsuche über alle PDFs des Seminars |
| G | gehe zu Foliennummer |
| 1 bis 9 | Schnelltaste anspringen |
| Umschalt + 1 bis 9 | aktuelle Folie auf Schnelltaste legen |
| Rücktaste | zurück zur Stelle vor dem letzten Sprung |
| P | Pause mit Pausenfolien an und aus |
| + / − / 0, Mausrad, Ziehen | zoomen, zurücksetzen, verschieben |
| Enter / Esc | vorgehörte Folie zeigen / verwerfen |
| Alt + → / ← | vorgehörte Folie weiterblättern |
| F | zurück ins Vollbild |
| H oder ? | Tastenhilfe |
| X | Präsentation beenden |

## Gezeigt-Protokoll

Eine Folie zählt als gezeigt, wenn sie mindestens die eingestellte Zeit (Standard 5 Sekunden) auf dem Beamer stand. Schnelles Durchblättern, Pausenfolien und geöffnete Übersichten zählen nicht. Die letzten 30 Sitzungen je Seminar werden gespeichert.

## Neue PDF-Version

Einfach aus PowerPoint an dieselbe Stelle exportieren. SlideDESK erkennt die geänderte Datei beim nächsten Start der Präsentation oder wenn man ins Fenster zurückkehrt. Verschobene Dateien werden als „fehlt“ markiert und lassen sich über „Ersetzen“ neu zuordnen.

## Technik

- Reines HTML, CSS und JavaScript ohne Build-Schritt, PDF.js (Legacy-Build) und Inter liegen in `vendor/`
- Datei-Zugriff über die File System Access API, Bildschirme über die Window Management API
- Service Worker für den Offline-Betrieb, Dateiliste in `assets.json`

```
npm install && npm run vendor   # PDF.js und Schrift nach vendor/ kopieren
npm run build                   # assets.json neu erzeugen (nach jeder Änderung)
npm start                       # lokal unter http://localhost:8080
npm test                        # Browsertests (Playwright, headless Chromium, acht Suiten)
```

Für die Browsertests werden Python mit ReportLab (`python3 -m pip install reportlab`) und Chromium (`npx playwright install chromium`) benötigt. Playwright wird über die Entwicklungsabhängigkeiten installiert.

Zum Ausprobieren ohne eigene Ablage: `?ablage=demo` an die Adresse hängen, dann arbeitet SlideDESK in einem Speicher im Browser.

Veröffentlichung: Bei jedem Push auf `main` baut GitHub Actions die Seite (`.github/workflows/pages.yml`). Einmalig unter Settings > Pages die Quelle „GitHub Actions“ wählen.

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/main.js` | Verwaltung: Ablage, Seminare, Ablauf, Schnelltasten, Pausenfolien, Protokoll, Einstellungen |
| `js/store.js` | Ordnerfreigabe, Pfade, Speicherdatei |
| `js/pdfs.js` | PDFs laden, rendern, Miniaturen, Volltext, Vorab-Rendern |
| `js/show.js` | Ablauf einer Präsentation: Position, Vorhören, Pause, Zoom, Schnelltasten, Protokoll, Tasten |
| `js/views.js` | Bühne und Referentenansicht |
| `js/overlays.js` | Übersicht, Suche, Gehe zu, Hilfe, Beenden |
| `js/present.js` | Vollbild, Bildschirmerkennung, Zusatzfenster |
