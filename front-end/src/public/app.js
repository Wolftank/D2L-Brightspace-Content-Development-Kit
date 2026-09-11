const form = document.querySelector('#config-form');
const preview = document.querySelector('#preview');
const status = document.querySelector('#status');
const emptyPreview = preview.cloneNode(true);
const typeDescriptions = {
  'content-topic': 'A standalone lesson page for your course.',
  'homepage-widget': 'A compact block for your course homepage.',
  'scorm-package': 'A packaged learning activity for your course.',
};
let hasPreview = false;

// This is a frontend draft model, not an agreed backend request schema.
function readConfiguration() {
  const data = new FormData(form);
  return {
    contentType: data.get('contentType'),
    targetCourse: data.get('targetCourse').trim(),
    title: data.get('title').trim(),
    sourceMaterial: data.get('sourceMaterial').trim(),
    tiltEnabled: data.has('tiltEnabled'),
    udlEnabled: data.has('udlEnabled'),
  };
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderSample(config) {
  const type = form.elements.contentType.selectedOptions[0].textContent;
  preview.replaceChildren(
    element('p', `${config.targetCourse} / ${type}`, 'eyebrow'),
    element('h3', config.title),
    element('p', 'Sample layout · Your notes are shown as entered.'),
    element('h4', config.contentType === 'homepage-widget' ? 'Widget content' : config.contentType === 'scorm-package' ? 'Activity source notes' : 'Lesson source notes'),
    element('p', config.sourceMaterial, 'sample-notes'),
  );
  if (config.tiltEnabled) {
    preview.append(element('h4', 'Requested TILT structure'));
    const list = element('ul', '');
    ['Purpose: why learners are doing this activity.', 'Tasks: what learners will do.', 'Criteria: what successful work looks like.'].forEach(text => list.append(element('li', text)));
    preview.append(list);
  }
  if (config.udlEnabled) preview.append(element('p', 'UDL review requested. No review has been run.'));
  hasPreview = true;
  status.textContent = 'Sample preview updated. No build or quality checks have been run.';
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  for (const name of ['targetCourse', 'title', 'sourceMaterial']) {
    const input = form.elements[name];
    input.setCustomValidity(input.value.trim() ? '' : 'Enter a value, not just spaces.');
  }
  if (form.reportValidity()) renderSample(readConfiguration());
});
form.addEventListener('input', (event) => {
  event.target.setCustomValidity?.('');
  if (hasPreview) status.textContent = 'Configuration changed. Select Preview sample to update the preview.';
});
form.elements.contentType.addEventListener('change', () => {
  document.querySelector('#type-hint').textContent = typeDescriptions[form.elements.contentType.value];
});
document.querySelector('#example').addEventListener('click', () => {
  form.elements.targetCourse.value = 'BIO 101';
  form.elements.title.value = 'Introduction to cells';
  form.elements.sourceMaterial.value = 'Learning objective: Compare plant and animal cells.\n\nIntroduce the cell membrane, nucleus, and cytoplasm. Explain how chloroplasts and cell walls support plant cells.\n\nActivity: Label a diagram of each cell and describe two similarities and two differences.';
  for (const input of form.elements) input.setCustomValidity?.('');
  status.textContent = 'Example notes added. Select Preview sample to see the layout.';
});
form.addEventListener('reset', () => {
  for (const input of form.elements) input.setCustomValidity?.('');
  preview.replaceChildren(...Array.from(emptyPreview.childNodes, node => node.cloneNode(true)));
  document.querySelector('#type-hint').textContent = typeDescriptions['content-topic'];
  hasPreview = false;
  status.textContent = 'Configuration reset. Start with your notes or use an example.';
});
