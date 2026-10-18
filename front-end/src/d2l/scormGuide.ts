export const SCORM_STEPS = [
  { title: 'Open your course', text: 'Sign in to SCSU D2L and open the course where you want the activity. In Content, select the unit or module that will contain it.' },
  { title: 'Upload the downloaded ZIP', text: 'Choose Add Existing, then SCORM/xAPI Object, then Bulk Upload. Select the ZIP you downloaded from CDK, keeping it zipped. Finish the upload, then select the uploaded package to add it to your unit or module.' },
  { title: 'Connect the gradebook', text: 'When D2L asks whether to create a grade item for this instance, choose Yes. Choose the Grade Calculation Method you want, such as Highest Attempt for the best score. Review the version and player options, then finish adding the activity. In Grades, check its points and grading settings.' },
  { title: 'Make it available', text: 'Set both the activity and its unit or module to Visible to students. In Classic Content, use the item menu and Make Visible to Users. Check any dates or release conditions that could prevent access.' },
  { title: 'Verify with a test student', text: 'In your sandbox course, use an enrolled test-student account, or impersonate it if you have permission. Complete the activity, then return to your instructor account and confirm its score in Grades. Try another attempt if you use Highest Attempt. Instructor preview and switching your role to Student do not prove that scores are saved.' },
] as const;

export const SCORM_LINKS = [
  { label: 'SCSU D2L sign-in', url: 'https://stcloudstate.learn.minnstate.edu/' },
  { label: 'D2L: upload SCORM and set up grades', url: 'https://community.d2l.com/brightspace/kb/articles/4971-import-and-manage-scorm' },
  { label: 'D2L: make content visible', url: 'https://community.d2l.com/brightspace/kb/articles/3382-hide-content-topics-modules-and-downloads' },
  { label: 'D2L: test the student experience', url: 'https://community.d2l.com/brightspace/kb/articles/35011' },
] as const;

export const SCORM_GUIDE_TEXT = 'Add a CDK SCORM activity to SCSU D2L\n\n' +
  SCORM_STEPS.map((step, index) => `${index + 1}. ${step.title}\n${step.text}`).join('\n\n') +
  '\n\nHelp links\n' + SCORM_LINKS.map(link => `${link.label}: ${link.url}`).join('\n') + '\n';
