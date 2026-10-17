// Frei benannte Links eines Seminars, gemeinsam fuer Verwaltung und Referentenansicht.
import { h, uid } from './util.js';

export function webUrl(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^https?:\/\//i.test(text) || /\s/.test(text)) return null;
  try {
    const url = new URL(text);
    return url.hostname ? text : null;
  } catch { return null; }
}

export function linksPanel(doc, seminar, onChange) {
  const button = (label, onclick, cls = 'small ghost', attrs = {}) =>
    h(doc, 'button.btn' + (cls ? '.' + cls.split(' ').join('.') : ''), { type: 'button', onclick, ...attrs }, label);
  const list = h(doc, 'div.link-list');
  const name = h(doc, 'input.input', { type: 'text', autocomplete: 'off', required: true });
  const url = h(doc, 'input.input', { type: 'url', placeholder: 'https://…', autocomplete: 'off', spellcheck: false, required: true });
  const error = h(doc, 'p.error.small', { role: 'alert', hidden: true });
  const save = h(doc, 'button.btn.primary.small', { type: 'submit' }, 'Speichern');
  let editing = null;
  const add = button('+ Link hinzufügen', () => edit(), 'small');
  const form = h(doc, 'form.link-editor', { hidden: true, noValidate: true, onsubmit: submit },
    h(doc, 'label.field', h(doc, 'span', 'Name'), name),
    h(doc, 'label.field', h(doc, 'span', 'Link'), url),
    error,
    h(doc, 'div.link-editor-actions', button('Abbrechen', () => close()), save));
  const root = h(doc, 'section.card.seminar-links', { 'aria-label': 'Links' },
    h(doc, 'div.card-head', h(doc, 'h3', 'Links'), h(doc, 'span.spacer'), add), list, form);

  // Texteingabe und Linkbedienung duerfen keine Folientasten ausloesen.
  root.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' && !form.hidden) { e.preventDefault(); close(); }
  });

  const entries = () => Array.isArray(seminar.links) ? seminar.links : [];
  function changed() { onChange(); render(); }
  function close() {
    editing = null;
    form.hidden = true;
    error.hidden = true;
    add.hidden = false;
    add.focus();
  }
  function edit(link = null) {
    editing = link;
    name.value = typeof link?.name === 'string' ? link.name : '';
    url.value = typeof link?.url === 'string' ? link.url : '';
    save.textContent = link ? 'Änderungen speichern' : 'Speichern';
    error.hidden = true;
    form.hidden = false;
    add.hidden = true;
    name.focus();
  }
  function submit(e) {
    e.preventDefault();
    const label = name.value.trim();
    const address = webUrl(url.value);
    if (!label || !address) {
      error.textContent = !label ? 'Bitte einen Namen eingeben.' : 'Bitte einen vollständigen Link mit https:// oder http:// eingeben.';
      error.hidden = false;
      (!label ? name : url).focus();
      return;
    }
    const links = entries();
    const index = editing ? links.indexOf(editing) : -1;
    const link = { ...(editing || {}), id: editing?.id || uid(), name: label, url: address };
    seminar.links = index >= 0 ? links.map((item, i) => i === index ? link : item) : [...links, link];
    close();
    changed();
  }
  function move(index, step) {
    const links = [...entries()];
    const target = index + step;
    if (target < 0 || target >= links.length) return;
    [links[index], links[target]] = [links[target], links[index]];
    seminar.links = links;
    changed();
  }
  function render() {
    const links = entries();
    list.replaceChildren(...(links.length ? links.map((link, index) => {
      const label = typeof link?.name === 'string' && link.name.trim() ? link.name : 'Unbenannter Link';
      const address = webUrl(link?.url);
      const text = [h(doc, 'span.link-name', label), h(doc, 'span.link-url', typeof link?.url === 'string' ? link.url : '')];
      const target = address
        ? h(doc, 'a.link-target', { href: address, target: '_blank', rel: 'noopener noreferrer', title: 'In neuem Tab öffnen: ' + address }, ...text)
        : h(doc, 'div.link-target.invalid', ...text, h(doc, 'span.error.small', 'Ungültiger Link – bitte bearbeiten.'));
      return h(doc, 'div.link-row', target,
        h(doc, 'div.link-actions',
          button('↑', () => move(index, -1), 'small ghost icon', { disabled: index === 0, 'aria-label': 'Nach oben: ' + label }),
          button('↓', () => move(index, 1), 'small ghost icon', { disabled: index === links.length - 1, 'aria-label': 'Nach unten: ' + label }),
          button('Bearbeiten', () => edit(link)),
          button('Löschen', () => {
            seminar.links = entries().filter((item) => item !== link);
            if (editing === link) close();
            changed();
          }, 'small ghost danger-text', { 'aria-label': 'Löschen: ' + label })));
    }) : [h(doc, 'p.muted.small', 'Noch keine Links. Füge die Links hinzu, die du im Seminar nutzen möchtest.')]));
  }
  render();
  return root;
}
