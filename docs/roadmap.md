# Phase 3: File Menu Improvements

In this phase I would like to see the following improvements made:


### File/Export HTML (Investigation and improvements)
This feature exists, however it does not attach images as base64 like it says it does. This suggests that the export implementation as a whole may have multiple issues. Please investigate for any possible problems and fix them. If you need user testing then let me know so I can put in a testing order.

### File/Export PDF
This should export the file in a .pdf format with images included.

### File/Import (HTML, PDF, DOCX, RTF, TXT... etc)
Give users the ability to import other text files and translate them to markdown. Of course some features are not supported by markdown so in those cases there should be a dialog popup letting the users know that some formatting and/or features may be lost on import if that is the case.

### File/Help
The application will need a "help" page to help users learn all the features and how to use them. This should open an example page with a brief summary at the top follow by a table of contents linking to every feature example. In those examples it should show an example of a feature used in some text (like bold), how to use the feature (like typing "** text **" for bold) and what it's hotkey/s are.

### File/About
This should make a simple "About" dialog display with a summary of the application and a link to a way for users to support financially.

# Phase 4: Security Investigation
The application should be secure, not having memory leaks or interfering with other applications. Investigate the application for any issues and proceed with fixing them.

# Phase 5: Code improvement
In phase 5 I would like a full review of the codebase removing any unnecessary parts and improving performance. We would like the application to be lean and clean with as few dependencies as possible. Also consider replacing dependencies with smaller more efficient code if they have any unnecessary bulk. Furthermore we should aim to use as little memory as possible while still prioritizing application start up speed and runtime performance.

# Phase 6: Preparation for distribution
In phase 6 I would like you to do anything required for public distribution. This can include minification of the code to reduce build and memory size. Incrementing application to version 1.0.0. Preparing distribution formats for windows and linux. And anything else you think is a good idea to do before distribution.