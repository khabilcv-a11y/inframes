# InFrame — Product & Technical Specification (Draft v1)

Oct 31, 2026 · @Doshesh

> **Status: Draft v1.1** — decisions and build notes added 31 Oct 2026. Sections below are the original v1 text; the table here records what the owner decided and where the build differs, and wins where they disagree.

## 0. Decisions and changes since draft v1

| # | Topic | Decision / change |
| --- | --- | --- |
| 1 | Super admin | khabilcv@gmail.com |
| 2 | Drive account | Same account (khabilcv@gmail.com), **5 TB** storage. The 15 GB capacity plan and the 80% alert in section 8 are no longer a constraint; the per-campaign "save videos to Drive" switch stays as a convenience. Drive saving is built last (needs Google OAuth credentials). |
| 3 | Domain | Stay on **inframes.pages.dev** for now. A custom domain can be attached later with no code change. |
| 4 | Hosting | One Cloudflare **Pages** project serves the site *and* the API (`/api/*` handled in `hooks.server.ts`), so the `SameSite=Strict` session cookie works on a single origin. Auto-deploys from GitHub. A separate Worker is not used. |
| 5 | Password hashing | Cloudflare Workers caps PBKDF2 at **100,000** iterations (the draft asked for 310,000). 100,000 is used; the hash records its own iteration count so it can be raised later. |
| 6 | Scheduler | No per-minute cron (Pages has none). Scheduled/Live/Ended is **derived from the clock** (start, end, optional daily window in IST) every time a campaign is read, so it flips exactly on time. Only manual states (draft, paused, ended early, archived) are stored. |
| 7 | Admin invites | Email invites are **deferred**. The super admin creates an admin and is shown a one-time temporary password (with a copy button); the admin must change it at first sign-in. |
| 8 | Frame storage | Frames are re-encoded in the browser (WebP, under 1.5 MB) and stored in D1 (`assets` table) instead of R2/Drive. No extra account setup; the API can move to R2 later. |
| 9 | Output storage | Participants' finished frames are **not uploaded** yet: only the typed values and a serial number are recorded. Drive upload is the last step of the build. The original photo never leaves the phone. |
| 10 | Programme | The first campaign is the **Special Enrollment Drive** (DCIP Kozhikode). Participants represent their **college**: each frame has a *Your name* box and a *Your college* dropdown. |
| 11 | Participant counter | Wording is "N frames created" (no InFrame branding on participant outputs). |
| 12 | Home page | The hero is an interactive logo puzzle: the InFrame wordmark is made of loose characters that spring home, are pushed by the cursor, scatter on click, and four viewfinder corners can be dragged into place to "snap the frame" (flash). Reduced-motion visitors get the finished logo. |
| 14 | Frame sizes | Frames are accepted at **any resolution** in three shapes: square 1:1 (→1080×1080), portrait 4:5 (→1080×1350), story 9:16 (→1080×1920). They are resized in the browser and the photo area is detected after resizing. |
| 15 | Poster | A4 poster with QR code as **PDF or JPG**, made in the browser (so Malayalam/Hindi render correctly). Carries the organiser's wording plus a small InFrame mark in the footer (owner's choice; this replaces the earlier "no InFrame branding on posters" rule for posters only). Participants' exported pictures still carry no InFrame branding. |
| 16 | Bot check | Cloudflare Turnstile is wired into admin login and frame creation but stays **off** until `TURNSTILE_SITE_KEY` (variable) and `TURNSTILE_SECRET` (secret) are added in Pages settings. |
| 17 | Public presentation | Inspired by Twibbonize-style campaign discovery (own design): home page has search, campaign cards with frame thumbnail + organiser logo + supporter count, "making an impact" stories, organiser pages (`/o/<slug>`), and the campaign page has About, Share and "More campaigns from this organiser". No public photo gallery yet (needs participant consent and Drive storage). |
| 18 | Logos | Organisations and campaigns can each upload a logo (resized in the browser, stored in D1). A campaign without its own logo shows its organisation's. |
| 19 | Creator credit | Footer of public pages reads "Designed & developed by CV". |
| 20 | Collage frames | A frame can have up to 6 photo areas (found automatically as separate transparent regions, editable in Frame settings). The participant adds one photo per area, taps an area to adjust it, and cannot create the picture until every area has a photo. Older single-area frames keep working. |
| 21 | Deleting frames | A frame people have already used can be deleted: it leaves the campaign, while their results stay in the numbers and CSV (stored as `kind = 'archived'`). An unused frame is removed completely. |
| 22 | Google Drive saving | Per campaign: Off / Original photos / Finished pictures / Both. Instead of a Google Cloud/OAuth setup (too heavy for a personal account), the owner pastes a tiny **Apps Script** into their own Google account and deploys it as a Web app; they paste its URL into the admin Google Drive page. Participants' browsers send each picture to that script with a one-time ticket signed by this site (the secret is derived from `SESSION_SECRET`, so no extra setting); the script verifies it, saves the file to `InFrame / <organisation> / <code - title>` in the owner's Drive, named from what the participant typed (e.g. `MES College - Asha Menon - 000124.jpg`), and reports back so the participant sees "Saved ✓". Saving originals shows a clear notice at the Add-photo button (adding the photo is the consent); nothing more is asked afterwards. Limits: pictures up to 15 MB; Apps Script daily quotas apply. |
| 23 | Shared text | The text shared with a picture (and "Copy caption") = caption + hashtags + the campaign link tagged `?r=share`; Results shows how many visitors came from shares. |
| 24 | Thank-you screen | "Copy caption" is gone. **Invite your friends** copies the caption + hashtags + campaign link (`?r=share`). The campaign's external link (Instagram, website, WhatsApp group…) is its own button underneath, labelled from the site it points to (English/Malayalam/Hindi); clicks are counted in Results ("Followed your link"). |
| 25 | Editing details | The super admin can rename an organisation (page addresses must stay unique) and edit an admin's name, email (their sign-in), mobile, organisation and role. All changes are audited. |
| 13 | Admin UI | Sidebar console (Dashboard, Campaigns, Organisations, Admins, Activity log), campaign workspace with Overview / Frames & titles / Results tabs, mobile drawer menu. |

**Build status.** Done: foundation, auth and lockout, organisations, admins, campaigns and scheduling, frame upload with automatic photo-area detection, drag-to-draw title boxes with stress test, participant photo editor (drag, pinch, rotate, auto-fit text, English/Malayalam/Hindi), share/download/copy caption, anonymous funnel events, results dashboard, CSV export, activity log, interactive home page. **Not yet:** video (paths A/B/C), email invites, public wall / TV mode, "Remove my output" link, retention clean-up. Turnstile needs your keys to switch on.

## 1. Overview

InFrame is a free, in-house web platform where our admins schedule event campaigns with branded photo and video frames, and participants turn their own photo or clip into a framed, named, ready-to-post output in under 60 seconds.

**Brand.** Name: InFrame. Logo: the Viewfinder mark (coral corner brackets snapping around a person, blinking record dot). Tagline: "Be part of the picture." Primary colours: Coral #E8553D, Ink #16161A, Warm white #FAFAF7. Display font: Space Grotesk.

**Exports carry no InFrame branding.** The InFrame name, logo and colours appear only on the platform's own pages: the home page, the admin and super admin consoles, and a small "Powered by InFrame" link in the footer of participant pages. Everything a participant or admin takes away carries only the organiser's branding: no InFrame watermark, logo, URL or hashtag on exported photos and videos, default captions, QR posters, ZIP exports or file names. Participant pages lead with the organiser's logo and the campaign's own colours.

**Goals for v1**

- A participant goes from opening the link to sharing on WhatsApp in under 60 seconds for a photo and under 2 minutes for a video, on a mid-range Android phone over 4G.
- An admin can create, schedule and launch a campaign with two templates and title slots in under 15 minutes, with no designer or developer involved.
- The super admin can see, at any time, who is using the platform and how every campaign is performing.
- Running cost stays at zero for normal event volumes.

**In scope for v1**

- Super admin, admin and participant roles.
- Scheduled campaigns with photo frames, video frames and title text slots.
- Browser-side compositing, download, native share, and a copy saved to Google Drive.
- Metrics for campaigns and for admin activity.
- An energetic public home page.

**Not in v1**

- The event photo gallery with face search. This becomes a separate portal later.
- Public sign-up or creators outside our team.
- Payments, watermarks or ads.
- Native mobile apps. InFrame is a progressive web app that can be added to the home screen.

## 2. Roles and permissions

Three roles: one super admin (you) who creates admin logins, admins who run campaigns end to end, and participants who need no login at all.

- **Super admin.** Owns the platform. Creates organisations (for example DCIP Kozhikode, CGPC Devagiri), creates admin accounts, assigns each admin to an organisation, suspends or resets them, and sees all metrics.
- **Admin.** Belongs to one organisation. Creates, schedules, edits, pauses and archives that organisation's campaigns, designs templates and title slots, and sees that organisation's metrics. An admin can be marked "Campaign manager" (full rights) or "Viewer" (metrics only).
- **Participant.** Anyone with a campaign link. No account, no password, no OTP. Fastest possible path.

| Action | Super admin | Admin (manager) | Admin (viewer) | Participant |
| --- | --- | --- | --- | --- |
| Create organisations | Yes | No | No | No |
| Create, suspend, reset admin logins | Yes | No | No | No |
| Create and schedule campaigns | Yes, any organisation | Own organisation | No | No |
| Upload templates, set title slots | Yes | Own organisation | No | No |
| Pause, end early, archive a campaign | Yes | Own organisation | No | No |
| View campaign metrics | All | Own organisation | Own organisation | No |
| View admin activity log | All | Own actions | No | No |
| Export data (CSV) | Yes | Own organisation | Own organisation | No |
| Generate and share a framed output | Yes | Yes | Yes | Yes, while campaign is live |

**Admin login.** Email and password set by the super admin, with a forced password change at first login. Optional "Sign in with Google" restricted to the email the super admin registered. Sessions expire after 12 hours of inactivity. Five failed attempts lock the account for 15 minutes.

## 3. Participant flow

The participant sees one screen that changes state, never a multi-page wizard: open link, add photo, type name, tap share. Everything heavy happens on their own phone, so there is no upload wait.

**Campaign link format:** `inframe.<domain>/c/<short-code>` (6 characters, for example `/c/kz26vd`), plus a QR code generated automatically for posters and stage screens.

**Screen states, in order**

1. **Landing.** Campaign title, organiser logo, a live preview of the frame with a sample face, a participant counter ("1,284 people are InFrame") and one large button: "Add your photo" (or "Add your video" when the template is video-only). If more than one template exists, a horizontal strip of template thumbnails sits above the button.
2. **Pick.** The native file picker opens directly, offering camera or gallery. No intermediate screen.
3. **Position.** The photo appears inside the frame immediately. Pinch to zoom, drag to move, two-finger rotate. Auto-centre on the detected face if the browser supports face detection; otherwise centre crop.
4. **Title fields.** The template's fields (name, college and so on) sit directly under the preview. Text updates live in the frame as they type. Their last-used values are remembered on that device.
5. **Done.** Tap "Create". Result appears in about one second for photos.
6. **Share sheet.** Three buttons: "Share" (native share sheet with the file attached, so WhatsApp, Instagram and Status all work), "Download", and "Copy caption". The admin's caption and hashtag are pre-filled.
7. **After share.** A short thank-you with the campaign's call to action (for example "Invite your friends" with the link copied).

**Speed budget**

| Step | Target on mid-range Android, 4G |
| --- | --- |
| First page load (landing visible) | Under 1.5 s |
| Frame and fonts ready | Under 2.5 s |
| Photo appears in frame after pick | Under 0.5 s |
| Photo export at full resolution | Under 1 s |
| Video export, 30 s clip at 720p | Under 45 s on device; server fallback under 30 s |
| Total, link to WhatsApp, photo | Under 60 s including typing |

**Speed rules**

- The landing page ships under 120 KB of JavaScript. The editor code loads in the background while the participant reads the landing screen.
- The frame image is preloaded at display size first, then the full-resolution file loads in the background.
- Nothing is uploaded before "Create". The output upload to Drive happens after the share sheet is already open, in the background, and retries silently.
- Works on a 3G connection and on phones from 2019 onward. Huge camera photos (above 12 megapixels) are downscaled on the device before compositing.
- Malayalam, Hindi and English interface, picked from the phone's language with a switch at the top.

**Campaign states the participant may see:** Upcoming (countdown to the start time, with a "Remind me" calendar link), Live, Paused ("Back shortly"), Ended (thank-you message, final count, no editor).

## 4. Admin console

An admin builds a campaign in one five-step form with a live phone preview on the right, then publishes it on a schedule.

**Console navigation:** Campaigns, Templates library, Metrics, Settings (organisation logo, default caption, Drive folder).

**Campaign builder steps**

1. **Basics.** Title, short description, organiser logo, short code (auto-generated, editable), language of the participant page.
2. **Schedule.** Start date and time, end date and time (Asia/Kolkata by default), optional daily window (for example 9 am to 6 pm on drive days). States move automatically: Draft, Scheduled, Live, Paused, Ended, Archived. An admin can pause or end early at any time.
3. **Templates.** Upload one or more frames. For each: type (photo frame, photo background, video static overlay, video animated overlay), output size (1080×1080 square or 1080×1920 vertical), and the photo window (the transparent area where the participant's photo shows).
4. **Title slots.** Draw boxes on the template for text (details below).
5. **Sharing.** Caption text, hashtags, thank-you message, call-to-action link. Generates the link and a downloadable QR poster (A4 PDF).

Before publishing, a **Test as participant** button opens the real participant page in preview mode, which does not count in metrics.

**Template upload rules**

| Template type | File accepted | Size limit | Notes |
| --- | --- | --- | --- |
| Photo frame | PNG with transparency | 5 MB | Transparent area = photo window, detected automatically |
| Photo background | PNG or JPG | 5 MB | Participant photo sits on top; admin draws the photo window |
| Video static overlay | PNG with transparency | 5 MB | Same file as a photo frame works |
| Video animated overlay | Lottie JSON, or PNG sequence in a ZIP (max 60 frames) | 10 MB | Plays in a loop over the clip; Lottie preferred |
| Intro or outro card (optional) | MP4, up to 3 s | 15 MB | Stitched before or after the participant clip |

The upload step checks dimensions, transparency and file size, and shows a fix message ("Frame must be 1080×1080; yours is 1000×1000") rather than failing silently. A downloadable Canva and Photoshop starter kit with the safe zones marked is offered on the same screen.

**Title slot editor**

The admin drags a box onto the template preview. Each box has these settings:

| Setting | Options |
| --- | --- |
| Field label | Shown to the participant, for example "Your name" |
| Input type | Free text, dropdown (admin pastes a list, for example colleges), or fixed text |
| Required | Yes or no |
| Font | From a curated set with Malayalam and Devanagari coverage (Noto Sans, Noto Sans Malayalam, Manjari, Mukta, Poppins, Space Grotesk), or upload a font file |
| Size range | Maximum and minimum point size; text shrinks to fit the box |
| Lines | One line, or up to two with wrapping |
| Colour, weight, letter spacing | Free choice, with the template's own colours suggested |
| Alignment | Left, centre, right; top, middle, bottom inside the box |
| Case | As typed, Title Case, UPPER CASE |
| Character limit | Default 40 |
| Video behaviour | Static, or fade in over the first second |

The editor has a **stress test** toggle that fills every slot with the longest realistic value ("Muhammed Abdul Rahiman Kunhikannan") so overflow is caught before launch.

**Other admin features**

- Duplicate a past campaign as a starting point.
- Templates library per organisation, reusable across campaigns.
- Bulk-edit dropdown lists (paste from Excel).
- Download all outputs of a campaign as a ZIP link from Drive.

## 5. Super admin console

The super admin console has four screens: Overview, Organisations, Admins and Activity log.

- **Overview.** Platform-wide counters (live campaigns, outputs today, outputs all time, active admins this week), a list of campaigns live right now with their counts updating every 30 seconds, and storage used in Google Drive against the 15 GB limit with a warning at 80%.
- **Organisations.** Create, rename, set logo and Drive folder, deactivate. Each organisation shows its admins, campaigns and total outputs.
- **Admins.** Create an admin (name, email, mobile, organisation, role: manager or viewer). The system emails a one-time setup link valid for 48 hours. Actions: resend invite, reset password, suspend, reactivate, move to another organisation. Columns: last login, campaigns created, outputs generated by their campaigns.
- **Activity log.** Every admin action with time, admin, action and target ("Asha created campaign Special Enrolment Drive", "Rahul paused campaign Voter Day"). Filter by admin, organisation and date; export as CSV. Kept for 2 years.

The super admin can open any campaign in read-only "view as admin" mode, or take over editing if the owning admin is unavailable. Every such action is logged.

## 6. Home page

The home page behaves like a camera: it opens with a flash, the visitor's cursor is a spotlight that reveals the scene, and the hero snaps into the viewfinder.

**Opening sequence (first 2.2 seconds, first visit only)**

1. The screen starts dark (Ink #16161A) with only the four coral viewfinder corners at the edges of the screen.
2. The corners slide inward and lock around the headline area with a soft shutter sound (muted by default; a speaker toggle in the corner).
3. A white **camera flash** fills the screen for 120 ms and fades out over 400 ms.
4. As the flash fades, the hero is revealed as a "developed photo": a collage of framed participant photos that sharpens from blur to crisp.
5. The red record dot starts blinking beside the logo.

On repeat visits the sequence is skipped. A visitor with "reduce motion" set on their device sees no flash and no animation, only the final hero. The flash never repeats faster than three times a second, to stay safe for photosensitive visitors.

**Spotlight cursor (desktop)**

- The hero background is a dimmed wall of sample framed photos. A soft circular spotlight, about 280 px wide, follows the mouse and lights up the photos beneath it at full brightness.
- The light trails slightly behind the cursor (eased follow), which makes it feel physical.
- When the spotlight passes over a photo, that photo's frame corners snap in, as if the camera just focused on it.
- Clicking anywhere in the hero fires a small flash at the cursor point.
- On phones there is no cursor, so the spotlight sweeps slowly across the wall by itself, and tilting the phone nudges it (where motion permission is granted).

Implementation: one canvas or a CSS radial-gradient mask on a full-bleed layer, driven by `requestAnimationFrame`. No library needed. Target 60 frames per second; falls back to a static lit hero on low-end devices.

**Page sections and copy**

1. **Hero.** Headline: "Every supporter, in the picture." Subline: "Turn your event into a wave of branded photos and reels, made by your participants in seconds, all carrying your message." Buttons: "Join a live campaign" and "Admin login".
2. **Live now.** Cards of currently live campaigns with a ticking participant count and a "Get InFrame" button. Hidden when nothing is live.
3. **How it works.** Three steps that animate as they scroll into view, each inside viewfinder corners: "Open the link", "Add your photo and name", "Share it everywhere".
4. **Why it works.** Four short blocks:
   - "The campaign records itself." Every participant adds a moment, so the event documents itself as it happens.
   - "One look, everywhere." Same frame, colours and hashtag on every post, so scattered posts read as one coordinated campaign.
   - "Reach beyond the room." People share pictures of themselves far more than posters, and every share carries your message to a new network.
   - "On your schedule." Frames go live and close with your event, from launch hour to last call.
5. **Counter band.** Large animated numbers: frames created, campaigns run, organisations served. Numbers roll up when the band scrolls into view.
6. **Past campaigns wall.** A moving strip of past campaign frames (sample faces only, never real participant photos without consent).
7. **Footer.** Organisation logos, privacy notice, contact, admin login.

**Visual system**

| Element | Choice |
| --- | --- |
| Background | Ink #16161A in the hero, Warm white #FAFAF7 below |
| Accent | Coral #E8553D for corners, buttons, record dot |
| Display type | Space Grotesk 700, large and tight (hero headline 72 to 96 px desktop, 44 px phone) |
| Body type | Inter or Noto Sans, 17 px, with Noto Sans Malayalam and Mukta for other languages |
| Motion | Short and snappy: 200 to 400 ms, springy easing on the corner snaps |
| Recurring motif | Viewfinder corners around every key block |

## 7. Processing pipeline

All compositing runs in the participant's browser, so output is instant and the server never handles heavy work except as a fallback for video on weak phones.

**Photo pipeline (target under 1 s)**

1. Read the picked file with `createImageBitmap`, honouring EXIF orientation (`imageOrientation: 'from-image'`).
2. If larger than 4096 px on the long side, downscale once on an `OffscreenCanvas` in a Web Worker so the screen never freezes.
3. Live preview: a display-size canvas redraws on every pinch, drag or keystroke (photo layer, then frame layer, then text layers).
4. On "Create", render once at full output size (1080×1080 or 1080×1920): background (if any), participant photo with its transform, frame PNG, then each text slot using the auto-fit routine.
5. Encode as JPEG at quality 0.92 (about 400 to 700 KB), or PNG if the frame has fine text that JPEG would smear.
6. Hand the file to the share sheet (`navigator.share({ files })`) and to the download link. Start the background upload to Drive.

**Text auto-fit routine:** start at the slot's maximum size, measure with `measureText`, step down 2 px until it fits the box width (and the line count), stop at the minimum size, and truncate with an ellipsis only if still too long. Fonts are loaded with the `FontFace` API before the first draw so Malayalam text never flashes in a fallback font.

**Video pipeline**

1. The participant records in the browser (`MediaRecorder`, 30 s hard stop) or picks a clip. Clips longer than 30 s get a trim slider.
2. Preview: the video element plays under a canvas that draws the overlay and text live.
3. On "Create", the browser checks its own capability:
   - **Path A, fast native (most phones).** If the browser supports WebCodecs with H.264 encoding, frames are composited on a canvas and encoded straight to MP4 with the `mp4-muxer` library. Typical time is close to the clip length or faster.
   - **Path B, ffmpeg.wasm.** If WebCodecs is missing but the phone has at least 4 GB of memory, the clip is composited with ffmpeg.wasm (about 25 MB downloaded once and cached). Slower, but still free.
   - **Path C, server fallback.** Otherwise the raw clip (max 30 s, downscaled to 720p on the device first) uploads to the processing server, which composites with native ffmpeg and returns the MP4. The participant sees a progress bar and can leave the page; a link to the finished video is shown when ready.
4. Output: MP4, H.264 video, AAC audio, 720×1280 (vertical) or 720×720 (square), 30 frames per second, about 4 Mbps, so a 30 s clip is roughly 15 MB and WhatsApp accepts it.
5. Animated overlays: Lottie files render frame by frame onto the canvas with `lottie-web` in canvas mode; PNG sequences draw the matching frame index.

**Speed techniques summary**

- Editor code, fonts and the frame file are prefetched while the landing screen is shown.
- A service worker caches the campaign's frame, fonts and the editor for repeat use and poor networks.
- Heavy work runs in Web Workers; the main thread only handles touch.
- The Drive upload starts after sharing, never blocks the participant, and retries with backoff if the network drops.

## 8. Storage

Google Drive holds every template and every participant output, owned by one dedicated institutional Google account; Cloudflare R2 holds small display copies for fast loading.

**Drive account.** Create a new Google account used only for InFrame (for example `inframe.platform@…`). Connect it once from the super admin console with Google sign-in (OAuth, scope `drive.file`, which only touches files InFrame creates). The server stores the refresh token encrypted. Do not use a Google service account: service accounts have no storage of their own in a normal Drive.

**Folder structure**

```
InFrame/
  <Organisation>/
    <Campaign short code> - <Campaign title>/
      templates/
      outputs/
        photos/   2026-11-02_kz26vd_000124_Asha-Menon.jpg
        videos/   2026-11-02_kz26vd_000125_Rahul-K.mp4
      exports/    metrics CSV, ZIP links
```

**Upload route.** After the participant has shared, the browser asks the API for an upload slot. The server (holding the Drive token) opens a Drive resumable upload session and returns its URL; the browser sends the file straight to Google. If a phone's browser cannot reach that URL, the file goes through the API instead (Cloudflare Workers accept up to 100 MB per request on the free plan). The participant never sees a Google login.

**Capacity planning**

| Item | Typical size | 15 GB holds about |
| --- | --- | --- |
| Photo output (JPEG) | 0.5 MB | 30,000 photos |
| Video output (30 s, 720p) | 15 MB | 1,000 videos |

When Drive passes 80% full, the super admin gets an alert and can archive ended campaigns (download ZIP, then delete from Drive) or move to a Google Workspace or Google One plan. A per-campaign switch lets an admin turn off saving of video outputs to Drive if storage is tight.

**R2 display copies.** Template previews and the home page sample wall are stored in Cloudflare R2 (free up to 10 GB, no download fees), because Drive is slow and rate-limited when many people load the same file at once. Participant outputs are not copied to R2 in v1.

## 9. Metrics and analytics

InFrame records a small set of anonymous participant events and every admin action, and shows them as a live funnel per campaign plus platform-wide totals for the super admin.

**Participant events tracked (no login, no personal data beyond what they type into title slots)**

| Event | Recorded when | Extra fields |
| --- | --- | --- |
| `visit` | Landing page opens | Referrer type (WhatsApp, Instagram, QR, direct), device type, language, district from IP (approximate) |
| `pick` | Photo or clip chosen | Media type |
| `create` | Output generated | Template id, processing path (A, B, C), time taken in ms |
| `download` | Download tapped | None |
| `share` | Share sheet completed | Target if the browser reports it |
| `caption_copy` | Caption copied | None |
| `drive_saved` | Drive upload confirmed | File size |
| `error` | Any failure | Step, error code |

A visitor gets a random anonymous id stored on their device, so repeat visits are not double-counted. No cookies for tracking, no third-party analytics.

**Campaign dashboard (admin)**

- Funnel: Visits, then photos picked, then outputs created, then shared or downloaded, with the drop-off at each step.
- Outputs per hour and per day, with the campaign's live window shaded.
- Breakdown by title-slot dropdown values (for example outputs per college), by template, by referrer and by device.
- Median creation time and error rate, so slow phones or a broken template show up early.
- Live counter for the stage screen: a full-screen "TV mode" showing the count and the latest outputs (only if the campaign enables a public wall).
- Export everything as CSV.

**Platform dashboard (super admin)**

- Totals across all organisations, top campaigns, outputs per organisation per month.
- Admin activity: last login, actions this month, campaigns created.
- Health: error rate by processing path, server fallback usage, Drive storage used.

## 10. Architecture and tech stack

InFrame runs on Cloudflare's free tier for the site, API and database, Google Drive for files, and one free Oracle Cloud server only for the video fallback.

&#91;embedded content: InFrame architecture · 7 components\]

Outputs normally upload straight from the phone to Drive through a one-time session URL issued by the API; only video path C clips travel to the video worker.

| Layer | Choice | Free-tier limit that matters | Why |
| --- | --- | --- | --- |
| Front end | SvelteKit (or Next.js if the team prefers React), TypeScript, Tailwind CSS | n/a | Small bundles, fast on cheap phones |
| Hosting | Cloudflare Pages | Unlimited static requests | Fast in India, free SSL, custom domain |
| API | Cloudflare Workers (Hono framework) | 100,000 requests per day | No server to maintain |
| Database | Cloudflare D1 (SQLite) | 5 GB, 5 million reads per day | Enough for years of campaigns and metrics |
| Display copies | Cloudflare R2 | 10 GB, no download fees | Fast template previews |
| Files of record | Google Drive API v3 | 15 GB per account | Familiar, easy to hand over |
| Video fallback | Oracle Cloud Always Free ARM VM running Node.js and ffmpeg in Docker | 4 cores, 24 GB memory | Real video processing at zero cost |
| Email (admin invites) | Resend or Brevo free plan | About 100 to 300 emails per day | Only admin emails, low volume |
| Bot protection | Cloudflare Turnstile on the Create button and admin login | Free | Stops scripted abuse without a CAPTCHA puzzle |
| Error tracking | Sentry free plan | 5,000 errors per month | Catch failing phones early |

**Key libraries:** `mp4-muxer` (WebCodecs to MP4), `@ffmpeg/ffmpeg` (wasm fallback), `lottie-web` (animated overlays), `qrcode` (QR posters), `fabric.js` or plain canvas for the admin slot editor, `jose` (session tokens), `zod` (input validation).

**Domain.** A short domain helps sharing (for example `inframe.in` or a subdomain of an existing institutional domain). Short links look like `inframe.in/c/kz26vd`.

## 11. Data model

Eight tables in D1 cover the whole of v1. Ids are text ULIDs; times are stored as ISO strings in UTC and shown in Asia/Kolkata.

```sql
CREATE TABLE organisations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,
  drive_folder_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',          -- active | inactive
  created_at TEXT NOT NULL
);

CREATE TABLE users (                               -- super admin and admins
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organisations(id),        -- NULL for super admin
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  mobile TEXT,
  role TEXT NOT NULL,                              -- super_admin | manager | viewer
  password_hash TEXT,                              -- argon2id or PBKDF2
  status TEXT NOT NULL DEFAULT 'invited',          -- invited | active | suspended
  must_change_password INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  short_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  language TEXT NOT NULL DEFAULT 'en',             -- en | ml | hi
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  daily_window TEXT,                               -- JSON, e.g. {"from":"09:00","to":"18:00"}
  status TEXT NOT NULL DEFAULT 'draft',            -- draft | scheduled | live | paused | ended | archived
  caption TEXT,
  hashtags TEXT,
  thank_you TEXT,
  cta_url TEXT,
  save_videos_to_drive INTEGER NOT NULL DEFAULT 1,
  drive_folder_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,              -- photo_frame | photo_background | video_static | video_animated
  width INTEGER NOT NULL,          -- 1080
  height INTEGER NOT NULL,         -- 1080 or 1920
  asset_drive_id TEXT NOT NULL,
  asset_r2_key TEXT NOT NULL,      -- display copy
  overlay_kind TEXT,               -- png | lottie | png_sequence
  photo_window TEXT NOT NULL,      -- JSON {x,y,w,h} in output pixels
  intro_drive_id TEXT,
  outro_drive_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE text_slots (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id),
  label TEXT NOT NULL,
  input_type TEXT NOT NULL,        -- text | dropdown | fixed
  options TEXT,                    -- JSON array for dropdown
  fixed_value TEXT,
  required INTEGER NOT NULL DEFAULT 1,
  box TEXT NOT NULL,               -- JSON {x,y,w,h}
  style TEXT NOT NULL,             -- JSON {font,maxSize,minSize,lines,color,weight,tracking,align,valign,case}
  max_chars INTEGER NOT NULL DEFAULT 40,
  video_effect TEXT DEFAULT 'none',-- none | fade_in
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE outputs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  template_id TEXT NOT NULL REFERENCES templates(id),
  serial INTEGER NOT NULL,         -- 1, 2, 3 ... per campaign
  visitor_id TEXT NOT NULL,
  media_type TEXT NOT NULL,        -- photo | video
  slot_values TEXT,                -- JSON {slotId: value}
  path TEXT,                       -- A | B | C | photo
  drive_file_id TEXT,
  bytes INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  type TEXT NOT NULL,              -- visit | pick | create | download | share | caption_copy | drive_saved | error
  meta TEXT,                       -- JSON
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_campaign_time ON events(campaign_id, created_at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,            -- e.g. campaign.create, admin.suspend
  target_type TEXT,
  target_id TEXT,
  detail TEXT,                     -- JSON
  ip TEXT,
  created_at TEXT NOT NULL
);
```

A scheduled Worker (cron every minute) moves campaigns between scheduled, live and ended by comparing `starts_at` and `ends_at` with the current time. Hourly totals per campaign are rolled up into a summary table so dashboards stay fast as `events` grows.

## 12. API endpoints

One JSON API under `/api`, split into public (participant) routes with no login and admin routes protected by a session cookie (HttpOnly, Secure, SameSite=Strict).

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/c/:code` | Public | Campaign, templates, slots, state (cached at the edge for 60 s) |
| POST | `/api/c/:code/events` | Public | Batch of participant events |
| POST | `/api/c/:code/outputs` | Public (Turnstile token) | Register an output, get serial number and Drive upload URL |
| PUT | `/api/outputs/:id/file` | Public (signed, one-time) | Fallback upload through the API |
| POST | `/api/c/:code/video-jobs` | Public (Turnstile token) | Server-side video job (path C), returns job id |
| GET | `/api/video-jobs/:id` | Public (signed) | Job progress and result link |
| POST | `/api/auth/login` | Admins | Email and password login |
| POST | `/api/auth/logout` | Admins | End session |
| POST | `/api/auth/setup` | Invited admin | Set password from invite link |
| POST | `/api/auth/reset` | Admins | Password reset email |
| GET, POST | `/api/admin/campaigns` | Manager | List, create |
| GET, PATCH, DELETE | `/api/admin/campaigns/:id` | Manager | Read, edit, archive |
| POST | `/api/admin/campaigns/:id/state` | Manager | Publish, pause, resume, end |
| POST | `/api/admin/campaigns/:id/templates` | Manager | Upload template (multipart) |
| PATCH, DELETE | `/api/admin/templates/:id` | Manager | Edit photo window, delete |
| PUT | `/api/admin/templates/:id/slots` | Manager | Save all text slots for a template |
| GET | `/api/admin/campaigns/:id/metrics` | Manager, viewer | Funnel, time series, breakdowns |
| GET | `/api/admin/campaigns/:id/export.csv` | Manager, viewer | Outputs and events CSV |
| GET, POST | `/api/super/organisations` | Super admin | List, create organisations |
| GET, POST | `/api/super/admins` | Super admin | List, invite admins |
| PATCH | `/api/super/admins/:id` | Super admin | Suspend, reactivate, change role or organisation, reset |
| GET | `/api/super/overview` | Super admin | Platform totals and health |
| GET | `/api/super/audit` | Super admin | Activity log with filters |
| POST | `/api/super/drive/connect` | Super admin | Start Google OAuth for the Drive account |

Every admin write goes through one middleware that checks role and organisation, validates input with `zod`, and writes an `audit_log` row.

## 13. Security, privacy and accessibility

Participants' photos stay on their own phones until they choose to create an output, and only the finished output is stored, in our own Drive.

**Security**

- Admin passwords hashed (PBKDF2-SHA256, 310,000 rounds in Workers, or argon2id on the VM). Forced change at first login; lockout after 5 failures.
- Sessions are signed tokens in HttpOnly cookies, 12-hour idle expiry, revoked on suspend.
- Drive refresh token encrypted at rest with a key held in Workers secrets.
- Upload URLs are single-use and expire in 15 minutes. Uploaded files are checked by type and size; templates are re-encoded on upload to strip anything hidden in the file.
- Rate limits: 20 outputs per visitor per campaign per hour; Turnstile on Create and on admin login.
- Content Security Policy, HTTPS only, no third-party scripts on participant pages.
- Daily automatic export of the D1 database to R2 for backup.

**Privacy (Digital Personal Data Protection Act, 2023)**

- A short notice on every campaign page, before "Add your photo": what is saved (the final framed output and the typed fields), where (the organiser's Google Drive), for how long, and who to contact for removal.
- The original photo or video is never uploaded, except in video path C, where the raw clip is deleted from the server as soon as the output is made.
- Retention: outputs kept for 12 months after the campaign ends by default (admin can set a shorter period), then deleted automatically.
- A "Remove my output" link on the thank-you screen, valid on that device, lets a participant delete their own saved copy.
- For campaigns involving school students, the admin must tick a confirmation that consent has been arranged, and Drive saving of outputs can be turned off.

**Accessibility**

- All controls are real buttons and inputs with labels; works with TalkBack and VoiceOver.
- Large touch targets (at least 48 px), text contrast at least 4.5:1, interface scales with the phone's font size.
- Every animation respects "reduce motion"; the home page flash is skipped for those users.
- Pinch and drag in the editor also have button alternatives (zoom in, zoom out, move arrows) for users who cannot use gestures.

## 14. Build plan

Build in six milestones so that a working photo campaign exists after milestone 3; video and the full home page come after the core is proven at a real event.

1. **Foundation.** Repository, Cloudflare Pages and Workers project, D1 schema and migrations, super admin seed account, login, sessions, audit log middleware.
2. **Admin core.** Organisations, admin invites, campaign builder steps 1, 2 and 5, template upload for photo frames, Drive connection and folder creation, scheduler cron.
3. **Participant photo flow.** Campaign page, editor with pinch and drag, text slot rendering with auto-fit, export, share, download, background Drive upload, events. First real pilot campaign here.
4. **Title slot editor and metrics.** Drag-to-draw slot editor with stress test, dropdown slots, campaign dashboard, CSV export, super admin overview.
5. **Video.** Recording and picking, path A (WebCodecs), path B (ffmpeg.wasm), path C (Oracle VM job server), animated Lottie overlays, intro and outro cards.
6. **Home page and polish.** Flash intro, spotlight cursor, live campaigns strip, counters, Malayalam and Hindi interface, accessibility pass, load testing with 500 simultaneous participants.

**Repository structure**

```
inframe/
  apps/
    web/                     SvelteKit app (home, participant, admin, super admin)
      src/routes/
        +page.svelte         home page (flash + spotlight)
        c/[code]/            participant campaign page
        admin/               admin console
        super/               super admin console
      src/lib/
        compositor/          canvas photo renderer, text auto-fit, workers
        video/               webcodecs path, ffmpeg.wasm path, job client
        ui/                  viewfinder corners, buttons, sheets
        i18n/                en.json, ml.json, hi.json
    api/                     Cloudflare Worker (Hono)
      src/routes/            public, auth, admin, super
      src/lib/               drive.ts, auth.ts, audit.ts, ratelimit.ts
      migrations/            D1 SQL migrations
    video-worker/            Node + ffmpeg service for the Oracle VM (Docker)
  packages/
    shared/                  types, zod schemas, slot style model
  docs/
    template-starter-kit/    Canva and Photoshop safe-zone guides
```

**Definition of done for each milestone:** works on a 2019-era Android phone and on an iPhone, passes the speed budget in section 3, has no console errors, and every admin action appears in the audit log.

## 15. Open decisions

- [x] Domain name: stay on inframes.pages.dev for now; custom domain later.
- [x] Drive account: khabilcv@gmail.com (5 TB). Recovery details holder still to be named.
- [x] Capacity: 5 TB is ample for photo campaigns.
- [ ] Should each output carry a participant serial number ("InFrame No. 1,284"), as an optional text slot type?
- [ ] Should campaigns offer an optional public wall and stage TV mode in v1, or later?
- [x] Front-end framework: SvelteKit.
- [ ] Default retention period for outputs: 12 months, or different for government events?
