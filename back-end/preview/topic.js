/* global D2LEmulator */
/* Installs the emulator in a previewed topic's own window, as the viewer the
   player chose, before the topic's scripts run. */
(function () {
  let launch;
  try {
    launch = window.parent !== window ? window.parent.cdkPreview : undefined;
  } catch {
    launch = undefined;
  }
  if (launch) D2LEmulator.install({ avenue: 'topic', profile: launch.profile, learner: launch.learner });
})();
