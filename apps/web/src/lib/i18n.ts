export type Lang = 'en' | 'ml' | 'hi';
export const LANGS: { code: Lang; label: string }[] = [{ code: 'en', label: 'English' }, { code: 'ml', label: 'മലയാളം' }, { code: 'hi', label: 'हिन्दी' }];

const en = {
  add: 'Add your photo', change: 'Choose another photo', create: 'Create my frame', creating: 'Creating…',
  share: 'Share', download: 'Download', copyCaption: 'Copy caption', copied: 'Copied ✓',
  zoomIn: 'Zoom in', zoomOut: 'Zoom out', rotate: 'Rotate', move: 'Move',
  people: 'Frames created', privacy: 'Your photo stays on your phone. Only the text on your frame (like your name) is saved.',
  required: 'Please fill this in', pick: 'Choose…', hint: 'Drag to move. Pinch to zoom.',
  thanks: 'Thank you!', again: 'Make another', invite: 'Invite your friends', linkCopied: 'Link copied ✓',
  notStarted: 'This campaign has not started yet.', startsAt: 'Starts', paused: 'Back shortly.', ended: 'This campaign has ended. Thank you for taking part!',
  notFound: 'Campaign not found', notFoundHint: 'Check the link and try again.', preview: 'Preview mode. Nothing here is counted.',
  powered: 'Powered by InFrame', error: 'Something went wrong. Please try again.', noFrame: 'This campaign is not ready yet. Please check back soon.',
  yourFrame: 'Your frame is ready', tooMany: 'You have made many frames in the last hour. Please try again later.',
  about: 'About this campaign', shareLink: 'Share this campaign', copyLink: 'Copy link', moreFrom: 'More campaigns from', credit: 'Designed & developed by'
};
const ml: typeof en = {
  add: 'നിങ്ങളുടെ ഫോട്ടോ ചേർക്കൂ', change: 'മറ്റൊരു ഫോട്ടോ തിരഞ്ഞെടുക്കൂ', create: 'ഫ്രെയിം ഉണ്ടാക്കൂ', creating: 'ഉണ്ടാക്കുന്നു…',
  share: 'പങ്കിടൂ', download: 'ഡൗൺലോഡ്', copyCaption: 'ക്യാപ്ഷൻ കോപ്പി ചെയ്യൂ', copied: 'കോപ്പി ചെയ്തു ✓',
  zoomIn: 'വലുതാക്കൂ', zoomOut: 'ചെറുതാക്കൂ', rotate: 'തിരിക്കൂ', move: 'നീക്കൂ',
  people: 'ഉണ്ടാക്കിയ ഫ്രെയിമുകൾ', privacy: 'നിങ്ങളുടെ ഫോട്ടോ ഫോണിൽ തന്നെ തുടരും. ഫ്രെയിമിലെ എഴുത്ത് (പേര് പോലെ) മാത്രം സേവ് ചെയ്യും.',
  required: 'ഇത് പൂരിപ്പിക്കൂ', pick: 'തിരഞ്ഞെടുക്കൂ…', hint: 'വലിച്ച് നീക്കൂ. രണ്ട് വിരൽ കൊണ്ട് വലുതാക്കൂ.',
  thanks: 'നന്ദി!', again: 'മറ്റൊന്ന് ഉണ്ടാക്കൂ', invite: 'സുഹൃത്തുക്കളെ ക്ഷണിക്കൂ', linkCopied: 'ലിങ്ക് കോപ്പി ചെയ്തു ✓',
  notStarted: 'ഈ ക്യാമ്പയിൻ ഇതുവരെ തുടങ്ങിയിട്ടില്ല.', startsAt: 'തുടങ്ങുന്നത്', paused: 'ഉടൻ തിരിച്ചെത്തും.', ended: 'ഈ ക്യാമ്പയിൻ അവസാനിച്ചു. പങ്കെടുത്തതിന് നന്ദി!',
  notFound: 'ക്യാമ്പയിൻ കണ്ടെത്തിയില്ല', notFoundHint: 'ലിങ്ക് പരിശോധിച്ച് വീണ്ടും ശ്രമിക്കൂ.', preview: 'പ്രിവ്യൂ മോഡ്. ഇവിടെ ഒന്നും എണ്ണില്ല.',
  powered: 'Powered by InFrame', error: 'എന്തോ പിഴച്ചു. വീണ്ടും ശ്രമിക്കൂ.', noFrame: 'ഈ ക്യാമ്പയിൻ ഇതുവരെ തയ്യാറായിട്ടില്ല.',
  yourFrame: 'നിങ്ങളുടെ ഫ്രെയിം തയ്യാർ', tooMany: 'കഴിഞ്ഞ ഒരു മണിക്കൂറിൽ ഒരുപാട് ഫ്രെയിമുകൾ ഉണ്ടാക്കി. പിന്നീട് ശ്രമിക്കൂ.',
  about: 'ഈ ക്യാമ്പയിനെക്കുറിച്ച്', shareLink: 'ഈ ക്യാമ്പയിൻ പങ്കിടൂ', copyLink: 'ലിങ്ക് കോപ്പി ചെയ്യൂ', moreFrom: 'കൂടുതൽ ക്യാമ്പയിനുകൾ:', credit: 'രൂപകൽപ്പനയും വികസനവും'
};
const hi: typeof en = {
  add: 'अपनी फ़ोटो जोड़ें', change: 'दूसरी फ़ोटो चुनें', create: 'मेरा फ़्रेम बनाएँ', creating: 'बन रहा है…',
  share: 'शेयर करें', download: 'डाउनलोड', copyCaption: 'कैप्शन कॉपी करें', copied: 'कॉपी हो गया ✓',
  zoomIn: 'ज़ूम इन', zoomOut: 'ज़ूम आउट', rotate: 'घुमाएँ', move: 'खिसकाएँ',
  people: 'बने फ़्रेम', privacy: 'आपकी फ़ोटो आपके फ़ोन में ही रहती है। फ़्रेम पर लिखा टेक्स्ट (जैसे नाम) ही सेव होता है।',
  required: 'कृपया यह भरें', pick: 'चुनें…', hint: 'खींचकर खिसकाएँ। दो उँगलियों से ज़ूम करें।',
  thanks: 'धन्यवाद!', again: 'एक और बनाएँ', invite: 'दोस्तों को बुलाएँ', linkCopied: 'लिंक कॉपी हो गया ✓',
  notStarted: 'यह अभियान अभी शुरू नहीं हुआ है।', startsAt: 'शुरू', paused: 'जल्द वापस आएँगे।', ended: 'यह अभियान समाप्त हो गया। भाग लेने के लिए धन्यवाद!',
  notFound: 'अभियान नहीं मिला', notFoundHint: 'लिंक जाँचें और फिर कोशिश करें।', preview: 'प्रीव्यू मोड। यहाँ कुछ भी गिना नहीं जाता।',
  powered: 'Powered by InFrame', error: 'कुछ गड़बड़ हुई। फिर कोशिश करें।', noFrame: 'यह अभियान अभी तैयार नहीं है।',
  yourFrame: 'आपका फ़्रेम तैयार है', tooMany: 'पिछले एक घंटे में आपने बहुत फ़्रेम बनाए। बाद में कोशिश करें।',
  about: 'इस अभियान के बारे में', shareLink: 'यह अभियान शेयर करें', copyLink: 'लिंक कॉपी करें', moreFrom: 'और अभियान:', credit: 'डिज़ाइन और विकास'
};
export const dict = { en, ml, hi };
export type Key = keyof typeof en;

export function detectLang(fallback: Lang): Lang {
  try {
    const saved = localStorage.getItem('inframe_lang') as Lang | null;
    if (saved && saved in dict) return saved;
  } catch { /* storage may be blocked */ }
  const nav = (navigator.language || '').slice(0, 2);
  return nav === 'ml' || nav === 'hi' ? nav : fallback;
}
