export const TOPIC_STEPS = [
  {
    title: 'Open your course',
    text: 'Sign in to SCSU D2L and open the course where you want the content topic. In Content, select the unit or module that will contain it.',
  },
  {
    title: 'Add the content topic',
    text: 'Choose Add Existing in the selected unit or module. Upload the downloaded Content Topic package from CDK and follow the D2L prompts to add the topic to the course.',
  },
  {
    title: 'Check the topic',
    text: 'Open the newly added topic and confirm that its pages, images, scripts, and other files load correctly.',
  },
  {
    title: 'Make it available',
    text: 'Make sure the topic and its unit or module are visible to students. Review any dates or release conditions that could prevent access.',
  },
  {
    title: 'Verify the student experience',
    text: 'Open the topic using an enrolled test-student account, or another approved student view, and confirm that the activity works as expected. If the topic changes its behavior by role, also check the instructor view.',
  },
] as const;

export const TOPIC_LINKS = [
  {
    label: 'SCSU D2L sign-in',
    url: 'https://stcloudstate.learn.minnstate.edu/',
  },
  {
    label: 'D2L: make content visible',
    url: 'https://community.d2l.com/brightspace/kb/articles/3382-hide-content-topics-modules-and-downloads',
  },
  {
    label: 'D2L: test the student experience',
    url: 'https://community.d2l.com/brightspace/kb/articles/35011',
  },
] as const;

export const TOPIC_GUIDE_TEXT =
  'Add a CDK Content Topic to SCSU D2L\n\n' +
  TOPIC_STEPS.map(
    (step, index) =>
      `${index + 1}. ${step.title}\n${step.text}`,
  ).join('\n\n') +
  '\n\nHelp links\n' +
  TOPIC_LINKS.map(
    link => `${link.label}: ${link.url}`,
  ).join('\n') +
  '\n';