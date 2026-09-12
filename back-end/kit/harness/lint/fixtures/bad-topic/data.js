/* Deliberately present under a generic name: topic/generic-sibling-filename
   should fire on this file. Its existence also means the <script src="data.js">
   reference in index.html actually resolves, so shared/missing-assets fires
   only on img/gone.png, not on this file too. */
window.BAD_TOPIC_DATA = {};
