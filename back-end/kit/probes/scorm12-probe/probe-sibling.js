/* Sibling file for the SCSU D2L tenant probe.
   Loaded three different ways by index.html so we can tell which
   loading mechanisms the tenant actually permits inside a SCORM package:
     1. a static <script src> tag
     2. a dynamically injected <script>
     3. fetch() + eval-free inspection

   Each mechanism stamps a distinct global so they can be told apart. */

window.SCSU_PROBE_SIBLING = {
  loaded: true,
  stamp: 'probe-sibling.js executed'
};

/* If a loader registered a callback before us, fire it. */
if (typeof window.SCSU_PROBE_SIBLING_ONLOAD === 'function') {
  try { window.SCSU_PROBE_SIBLING_ONLOAD(); } catch (e) {}
}
