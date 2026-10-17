# SlideDESK

Seminar-PDFs aus PowerPoint komfortabel präsentieren. Läuft im Browser (Edge oder Chrome unter Windows), offline, ohne Account und ohne Server. Teil der DESK Suite.

App: https://therealhuzur.github.io/slidedesk/ · Anleitung: https://therealhuzur.github.io/slidedesk/hilfe.html

Masterplan: Storage `50_coding/slidedesk/SlideDESK-Masterplan.md`

## Erste Schritte

1. SlideDESK in Edge oder Chrome öffnen.
2. **Ablage freigeben:** den Oberordner wählen, in dem die Seminarunterlagen liegen, z. B. „Operatives Geschäft“ im Google Drive. Beim Nachfragen „Bei jedem Besuch zulassen“ wählen.
3. **Seminar anlegen** und PDFs hinzufügen, gern aus verschiedenen Unterordnern.
4. **Präsentieren:** Modus wählen und auf „Präsentieren“ klicken.

SlideDESK legt in der Ablage einen Ordner `SlideDESK/slidedesk.json` an. Darin stehen Seminare, Schnelltasten, Pausenfolien, Einstellungen und Protokolle. Liegt die Ablage im Google Drive für Desktop, ist alles auf PC und Laptop gleich. PDFs werden nur gelesen, nie verändert.

## Links für das Seminar

Im Bereich **Links** über **+ Link hinzufügen** einen eigenen Namen und die vollständige Webadresse eintragen. Die Einträge lassen sich bearbeiten, löschen und mit den Pfeilen sortieren. Für das nächste Webinar einfach die benötigten Links austauschen.

Ein Klick auf den Namen öffnet die Website in einem neuen Browser-Tab bzw. gemäß Browsereinstellung. Die Präsentation bleibt geöffnet; zurück geht es über die normale Tab- oder Fensterauswahl. In der Referentenansicht ist dieselbe Linkliste verfügbar und bearbeitbar. Die Links werden mit dem Seminar gespeichert und über die vorhandene Ablage synchronisiert. Anmeldung und Navigation erfolgen normal auf der geöffneten Website. Eine Browser-Erweiterung ist nicht nötig.

## Präsentationsmodi

- **Gespiegelt:** Windows dupliziert das Bild (Win + P, „Duplizieren“). Alles läuft im Vollbild auf beiden Bildschirmen.
- **Zwei Bildschirme:** Windows auf „Erweitern“ stellen (Win + P). Beim ersten Mal fragt der Browser nach der Fensterverwaltung, eventuell auch nach Pop-ups. Dann legt SlideDESK die Folie selbst auf den Beamer und die Referentenansicht auf den Laptop. Ohne diese Erlaubnis öffnet sich ein Beamerfenster, das man auf den Beamer zieht und dort auf „Vollbild“ klickt.

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
npm test                        # Browsertests (Playwright, headless Chromium)
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
